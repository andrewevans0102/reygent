import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import { rootCertificates, getCACertificates } from "node:tls";
import { loadEnvFile } from "./env.js";
import type { BranchType as CanonicalBranchType } from "./branch-type.js";
import type { SpecPayload } from "./spec.js";
import type { PRCreateOutput, TaskContext } from "./task.js";
import { TaskError } from "./task.js";
import { getChesstrace } from "./chesstrace/index.js";
import { Events } from "./chesstrace/events.js";
import { isDebug } from "./debug.js";

function exec(
  cmd: string,
  args: string[],
  opts?: { timeout?: number },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { timeout: opts?.timeout, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new TaskError(
              `pr-create: command failed: ${cmd} ${args.join(" ")}\n${stderr || error.message}`,
            ),
          );
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}

export type Platform = "github" | "gitlab";

export interface RemoteInfo {
  platform: Platform;
  host: string;
  owner: string;
  repo: string;
}

export async function resolveToken(host: string): Promise<string> {
  const { execFile: execFileCb } = await import("node:child_process");
  return new Promise((resolve, reject) => {
    const child = execFileCb(
      "git",
      ["credential", "fill"],
      { maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(
            new TaskError(
              `pr-create: failed to retrieve credentials for ${host} via git credential fill.\n` +
                "Configure a credential helper: https://git-scm.com/doc/credential-helpers",
            ),
          );
          return;
        }
        const passwordLine = stdout
          .split("\n")
          .find((l) => l.startsWith("password="));
        if (!passwordLine) {
          reject(
            new TaskError(
              `pr-create: no password/token found from git credential fill for ${host}.`,
            ),
          );
          return;
        }
        resolve(passwordLine.slice("password=".length).trim());
      },
    );
    child.stdin?.write(`protocol=https\nhost=${host}\n\n`);
    child.stdin?.end();
  });
}

function splitOwnerAndRepo(host: string, path: string): RemoteInfo | null {
  // Owner can span multiple segments (GitLab subgroups: group/subgroup/repo).
  // Repo is always the last segment.
  let p = path.replace(/\/+$/, "");
  if (p.endsWith(".git")) p = p.slice(0, -4);
  const idx = p.lastIndexOf("/");
  if (idx <= 0 || idx === p.length - 1) return null;
  const owner = p.slice(0, idx);
  const repo = p.slice(idx + 1);
  if (!owner || !repo) return null;
  // Platform detection is heuristic-based: hostname containing "gitlab" → GitLab,
  // otherwise GitHub. This could theoretically misidentify a GitHub Enterprise
  // instance with "gitlab" in its hostname, but this is unlikely in practice.
  const platform: Platform = host.includes("gitlab") ? "gitlab" : "github";
  return { platform, host, owner, repo };
}

export function parseRemote(remoteUrl: string): RemoteInfo {
  const url = remoteUrl.trim();

  // SSH: git@host:path/to/repo[.git]
  const sshMatch = url.match(/^git@([^:]+):(.+)$/);
  if (sshMatch) {
    const result = splitOwnerAndRepo(sshMatch[1], sshMatch[2]);
    if (result) return result;
  }

  // HTTPS: https://host/path/to/repo[.git]
  const httpsMatch = url.match(/^https?:\/\/([^/]+)\/(.+)$/);
  if (httpsMatch) {
    const result = splitOwnerAndRepo(httpsMatch[1], httpsMatch[2]);
    if (result) return result;
  }

  throw new TaskError(`pr-create: cannot parse remote URL: ${url}`);
}

/**
 * Result from GitLab MR detection.
 * - found: MR exists with the given IID
 * - none: No MR found for the branch
 * - error: API call failed (network error, auth error, etc.)
 */
export type GitLabMRResult =
  | { kind: "found"; iid: number }
  | { kind: "none" }
  | { kind: "error"; reason: string };

/**
 * Detects an open GitLab MR for the given branch.
 * Returns a structured result instead of throwing, allowing callers to handle
 * different failure modes appropriately (network errors vs. no MR found).
 *
 * @param remote - Parsed remote info
 * @param token - GitLab API token
 * @param branch - Branch name to search for
 * @param insecure - Whether to skip SSL verification
 * @returns Structured result indicating found/none/error
 */
export async function detectGitLabMR(
  remote: RemoteInfo,
  token: string,
  branch: string,
  insecure?: boolean,
): Promise<GitLabMRResult> {
  const projectPath = encodeURIComponent(`${remote.owner}/${remote.repo}`);
  const encodedBranch = encodeURIComponent(branch);
  const baseUrl = `https://${remote.host}/api/v4/projects/${projectPath}/merge_requests`;
  const url = `${baseUrl}?source_branch=${encodedBranch}&state=opened`;
  const tlsOpts: TlsOptions = insecure
    ? { rejectUnauthorized: false }
    : await resolveTlsOptions(remote.host);
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  if (isDebug()) {
    console.error(`[debug] GET ${url}`);
  }

  let res: { status: number; text: string };
  try {
    res = await doHttpsGet(url, headers, tlsOpts);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { kind: "error", reason: `network error: ${msg}` };
  }

  if (res.status < 200 || res.status >= 300) {
    const snippet = res.text.slice(0, 200).replace(/\s+/g, " ").trim();
    return {
      kind: "error",
      reason: `GitLab API returned HTTP ${res.status} for ${baseUrl}${snippet ? ` — ${snippet}` : ""}`,
    };
  }

  let mrs: Array<{ iid: number }>;
  try {
    mrs = JSON.parse(res.text) as Array<{ iid: number }>;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { kind: "error", reason: `could not parse GitLab response: ${msg}` };
  }

  if (mrs.length > 0) return { kind: "found", iid: mrs[0].iid };

  // Fallback: list all open MRs and match branch case-insensitively, in case
  // the source_branch filter misses (e.g., MR exists from a fork).
  //
  // LIMITATION: Only fetches first 100 MRs (per_page=100). Repos with >100 open
  // MRs may miss the target. This is acceptable for most use cases, but consider
  // adding pagination if this becomes a problem.
  if (isDebug()) {
    console.error(`[debug] No MR found via source_branch filter, listing all open MRs`);
  }
  try {
    const fallback = await doHttpsGet(`${baseUrl}?state=opened&per_page=100`, headers, tlsOpts);
    if (fallback.status >= 200 && fallback.status < 300) {
      const all = JSON.parse(fallback.text) as Array<{ iid: number; source_branch?: string }>;
      const match = all.find(
        (m) => typeof m.source_branch === "string" && m.source_branch.toLowerCase() === branch.toLowerCase(),
      );
      if (match) return { kind: "found", iid: match.iid };
    }
  } catch {
    // ignore fallback errors — original "none" result is still meaningful
  }

  return { kind: "none" };
}

export async function createPR(opts: {
  remote: RemoteInfo;
  title: string;
  body: string;
  head: string;
  base: string;
  token: string;
  insecure?: boolean;
}): Promise<{ prUrl: string; prNumber: number }> {
  if (opts.remote.platform === "gitlab") {
    return createGitLabMR(opts);
  }
  return createGitHubPR(opts);
}

/**
 * TLS options for HTTPS requests, including certificate verification settings.
 * Used by pr-review.ts and other modules that need to make authenticated HTTPS requests.
 */
export interface TlsOptions {
  /** Whether to reject unauthorized certificates. Set to false to skip verification. */
  rejectUnauthorized?: boolean;
  /** Custom certificate authority bundle. Combines with Node's default CAs when provided. */
  ca?: string[];
}

/**
 * Resolves TLS options for HTTPS requests based on git configuration and environment variables.
 * Respects GIT_SSL_NO_VERIFY, NODE_TLS_REJECT_UNAUTHORIZED, git config http.sslVerify,
 * and git config http.sslCAInfo to match git's behavior for corporate/self-signed certificates.
 *
 * @param hostname - Optional hostname to check for URL-specific git config overrides
 * @returns TLS options object for use with Node's https.request
 */
/**
 * Returns the OS trust store CAs (macOS Keychain, Windows cert store,
 * Linux ca-certificates). Always returns an array (empty on failure or
 * older Node). This is how `git` effectively trusts corporate CAs on
 * macOS — Node ignores them by default.
 */
function getSystemCaCerts(): string[] {
  try {
    return getCACertificates("system");
  } catch {
    return [];
  }
}

export async function resolveTlsOptions(hostname?: string): Promise<TlsOptions> {
  // Respect GIT_SSL_NO_VERIFY env var
  if (process.env.GIT_SSL_NO_VERIFY) return { rejectUnauthorized: false };
  // Respect NODE_TLS_REJECT_UNAUTHORIZED if explicitly set
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") return { rejectUnauthorized: false };

  const { execFile: ef } = await import("node:child_process");
  const gitConfig = (args: string[]): Promise<string> =>
    new Promise((res, rej) => {
      ef("git", args, {}, (err, stdout) => {
        if (err) rej(err);
        else res(stdout.trim());
      });
    });

  // Check if sslVerify is explicitly disabled
  const sslVerifyDisabled = await (async () => {
    if (hostname) {
      try {
        const v = await gitConfig([
          "config", "--bool", "--get-urlmatch", "http.sslVerify", `https://${hostname}/`,
        ]);
        if (v === "false") return true;
      } catch { /* fall through */ }
    }
    try {
      const v = await gitConfig(["config", "--bool", "http.sslVerify"]);
      if (v === "false") return true;
    } catch { /* not set */ }
    return false;
  })();

  if (sslVerifyDisabled) return { rejectUnauthorized: false };

  // Load custom CA bundle from git config (http.sslCAInfo)
  // This is how git trusts corporate/internal CAs
  const caPath = await (async () => {
    if (hostname) {
      try {
        return await gitConfig([
          "config", "--get-urlmatch", "http.sslCAInfo", `https://${hostname}/`,
        ]);
      } catch { /* fall through */ }
    }
    try {
      return await gitConfig(["config", "http.sslCAInfo"]);
    } catch { /* not set */ }
    return null;
  })();

  // Always trust the OS trust store (macOS Keychain etc.) in addition to
  // Node's bundled CAs — corporate certs typically live there.
  const systemCa = getSystemCaCerts();

  if (caPath) {
    try {
      const customCa = readFileSync(caPath, "utf-8");
      return { ca: [...rootCertificates, ...systemCa, customCa] };
    } catch (err) {
      // CA file unreadable — fall through to default trust store.
      // Log in debug mode to help troubleshoot TLS issues.
      if (isDebug()) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[debug] Could not read custom CA bundle from git config (http.sslCAInfo=${caPath}): ${msg}`);
      }
    }
  }

  if (systemCa.length > 0) {
    return { ca: [...rootCertificates, ...systemCa] };
  }

  return {};
}

function doHttpsPost(
  url: string,
  headers: Record<string, string>,
  body: string,
  tlsOpts: TlsOptions,
): Promise<{ status: number; text: string }> {
  const parsed = new URL(url);
  return new Promise((resolve, reject) => {
    const bodyBuf = Buffer.from(body, "utf-8");
    const req = httpsRequest(
      {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        method: "POST",
        headers: { ...headers, "Content-Length": bodyBuf.byteLength },
        ...tlsOpts,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            text: Buffer.concat(chunks).toString("utf-8"),
          }),
        );
      },
    );
    req.on("error", reject);
    req.write(bodyBuf);
    req.end();
  });
}

export function isSslError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as NodeJS.ErrnoException).code ?? "";
  return (
    code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
    code === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
    code === "SELF_SIGNED_CERT_IN_CHAIN" ||
    code === "ERR_TLS_CERT_ALTNAME_INVALID" ||
    code === "CERT_HAS_EXPIRED" ||
    err.message.includes("self-signed") ||
    err.message.includes("certificate")
  );
}

/**
 * Makes an HTTPS POST request with automatic TLS configuration and SSL error retry.
 * Resolves TLS options from git config, respecting corporate CA bundles and SSL verification settings.
 * On SSL errors, retries once with verification disabled as a fallback (unless already insecure).
 *
 * Used by pr-review.ts for posting review comments to GitHub/GitLab APIs.
 *
 * @param url - Full HTTPS URL to POST to
 * @param headers - HTTP headers to send
 * @param body - Request body as string (typically JSON)
 * @param opts - Options: insecure skips all TLS verification
 * @returns Promise with HTTP status code and response text
 */
export async function httpsPost(
  url: string,
  headers: Record<string, string>,
  body: string,
  opts?: { insecure?: boolean },
): Promise<{ status: number; text: string }> {
  const parsed = new URL(url);
  const tlsOpts: TlsOptions = opts?.insecure
    ? { rejectUnauthorized: false }
    : await resolveTlsOptions(parsed.hostname);

  try {
    return await doHttpsPost(url, headers, body, tlsOpts);
  } catch (err) {
    if (!opts?.insecure && isSslError(err)) {
      return doHttpsPost(url, headers, body, { rejectUnauthorized: false });
    }
    throw err;
  }
}

function doHttpsGet(
  url: string,
  headers: Record<string, string>,
  tlsOpts: TlsOptions,
): Promise<{ status: number; text: string }> {
  const parsed = new URL(url);
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        method: "GET",
        headers,
        ...tlsOpts,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            text: Buffer.concat(chunks).toString("utf-8"),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

/**
 * Makes an HTTPS GET request with automatic TLS configuration and SSL error retry.
 * Mirrors httpsPost's behavior: respects git config CA bundles and sslVerify,
 * and retries once with verification disabled on SSL errors.
 */
export async function httpsGet(
  url: string,
  headers: Record<string, string>,
  opts?: { insecure?: boolean },
): Promise<{ status: number; text: string }> {
  const parsed = new URL(url);
  const tlsOpts: TlsOptions = opts?.insecure
    ? { rejectUnauthorized: false }
    : await resolveTlsOptions(parsed.hostname);

  try {
    return await doHttpsGet(url, headers, tlsOpts);
  } catch (err) {
    if (!opts?.insecure && isSslError(err)) {
      return doHttpsGet(url, headers, { rejectUnauthorized: false });
    }
    throw err;
  }
}

async function createGitHubPR(opts: {
  remote: RemoteInfo;
  title: string;
  body: string;
  head: string;
  base: string;
  token: string;
  insecure?: boolean;
}): Promise<{ prUrl: string; prNumber: number }> {
  const { host, owner, repo } = opts.remote;
  const apiBase =
    host === "github.com"
      ? "https://api.github.com"
      : `https://${host}/api/v3`;
  const body = JSON.stringify({
    title: opts.title,
    body: opts.body,
    head: opts.head,
    base: opts.base,
  });
  const { status, text } = await httpsPost(
    `${apiBase}/repos/${owner}/${repo}/pulls`,
    {
      Authorization: `Bearer ${opts.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "reygent",
    },
    body,
    { insecure: opts.insecure },
  );
  if (status < 200 || status >= 300) {
    throw new TaskError(`pr-create: GitHub API error ${status}: ${text}`);
  }
  const data = JSON.parse(text) as { html_url: string; number: number };
  return { prUrl: data.html_url, prNumber: data.number };
}

async function createGitLabMR(opts: {
  remote: RemoteInfo;
  title: string;
  body: string;
  head: string;
  base: string;
  token: string;
  insecure?: boolean;
}): Promise<{ prUrl: string; prNumber: number }> {
  const { host, owner, repo } = opts.remote;
  const projectPath = encodeURIComponent(`${owner}/${repo}`);
  const body = JSON.stringify({
    title: opts.title,
    description: opts.body,
    source_branch: opts.head,
    target_branch: opts.base,
  });
  const { status, text } = await httpsPost(
    `https://${host}/api/v4/projects/${projectPath}/merge_requests`,
    {
      Authorization: `Bearer ${opts.token}`,
      "Content-Type": "application/json",
    },
    body,
    { insecure: opts.insecure },
  );
  if (status < 200 || status >= 300) {
    throw new TaskError(`pr-create: GitLab API error ${status}: ${text}`);
  }
  const data = JSON.parse(text) as { web_url: string; iid: number };
  return { prUrl: data.web_url, prNumber: data.iid };
}

/**
 * @deprecated Import BranchType from branch-type.ts instead
 */
export type BranchType = "feat" | "fix" | "chore" | "refactor" | "docs" | "test" | "style" | "perf";

/**
 * @deprecated Use detectTypeFromJiraIssueType or detectTypeFromLinearLabels from branch-type.ts instead
 */
export function mapIssueTypeToBranchType(issueType?: string): BranchType | null {
  if (!issueType) return null;

  const normalized = issueType.toLowerCase();

  // Map common issue type names to conventional prefixes
  if (normalized.includes("bug") || normalized.includes("fix")) return "fix";
  if (normalized.includes("feature") || normalized.includes("story") || normalized.includes("enhancement")) return "feat";
  if (normalized.includes("chore") || normalized.includes("task")) return "chore";
  if (normalized.includes("refactor")) return "refactor";
  if (normalized.includes("doc")) return "docs";
  if (normalized.includes("test")) return "test";
  if (normalized.includes("style")) return "style";
  if (normalized.includes("perf") || normalized.includes("performance")) return "perf";

  return null;
}

/**
 * @deprecated Use deriveBranchNameWithType from branch-type.ts instead
 */
export function deriveBranchName(spec: SpecPayload, branchType: BranchType): string {
  switch (spec.source) {
    case "jira":
      return `${branchType}/${spec.issueKey}`;
    case "linear":
      return `${branchType}/${spec.issueId}`;
    case "markdown": {
      const slug = spec.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 60);
      return `${branchType}/${slug}`;
    }
  }
}

export function buildCommitMessage(context: TaskContext, branchType: CanonicalBranchType): string {
  const spec = context.spec;
  const plan = context.plan;

  let scope: string | null = null;
  switch (spec.source) {
    case "jira":
      scope = spec.issueKey;
      break;
    case "linear":
      scope = spec.issueId;
      break;
    case "markdown":
      scope = null;
      break;
  }

  // Normalize title: lowercase first character for commitlint subject-case rule
  let title = spec.title;
  if (title.length > 0) {
    title = title[0].toLowerCase() + title.slice(1);
  }

  // Build prefix and check total length against commitlint header-max-length (100)
  const prefix = scope ? `${branchType}(${scope}): ` : `${branchType}: `;
  const maxLen = 100;

  // Truncate title if needed to fit in 100 chars
  if (prefix.length + title.length > maxLen) {
    const availableLen = maxLen - prefix.length - 3; // reserve 3 for "..."
    title = title.slice(0, availableLen) + "...";
  }

  const subject = prefix + title;

  if (!plan) return subject;

  const lines = [subject, ""];
  if (plan.goals.length > 0) {
    lines.push("Goals:");
    for (const g of plan.goals) lines.push(`- ${g}`);
    lines.push("");
  }
  if (plan.tasks.length > 0) {
    lines.push("Tasks:");
    for (const t of plan.tasks) lines.push(`- ${t}`);
  }

  return lines.join("\n");
}

export function buildPRBody(context: TaskContext): string {
  const plan = context.plan;
  const impl = context.implement;
  const security = context.securityReview;

  const sections: string[] = [];

  sections.push("## Summary");
  sections.push("");
  sections.push(context.spec.title);
  sections.push("");

  if (plan) {
    if (plan.goals.length > 0) {
      sections.push("## Goals");
      sections.push("");
      for (const g of plan.goals) sections.push(`- ${g}`);
      sections.push("");
    }
    if (plan.tasks.length > 0) {
      sections.push("## Tasks");
      sections.push("");
      for (const t of plan.tasks) sections.push(`- [x] ${t}`);
      sections.push("");
    }
  }

  if (impl) {
    const devFiles = impl.dev?.files ?? [];
    if (devFiles.length > 0) {
      sections.push("## Files Changed");
      sections.push("");
      for (const f of devFiles) sections.push(`- \`${f}\``);
      sections.push("");
    }

    const testFiles = impl.qe?.testFiles ?? [];
    if (testFiles.length > 0) {
      sections.push("## Test Files");
      sections.push("");
      for (const f of testFiles) sections.push(`- \`${f}\``);
      sections.push("");
    }
  }


  const prReview = context.prReview;
  if (prReview) {
    sections.push("## PR Review");
    sections.push("");
    sections.push(prReview.summary);
    sections.push("");

    if (prReview.comments.length > 0) {
      sections.push("### Review Comments");
      sections.push("");

      const byFile = new Map<string, typeof prReview.comments>();
      for (const c of prReview.comments) {
        const group = byFile.get(c.file) ?? [];
        group.push(c);
        byFile.set(c.file, group);
      }

      for (const [file, comments] of byFile) {
        sections.push(`**${file}**`);
        for (const c of comments) {
          const lineRef = c.line !== null ? `:${c.line}` : "";
          sections.push(`- \`${file}${lineRef}\`: ${c.comment}`);
        }
        sections.push("");
      }
    }

    if (prReview.recommendedActions.length > 0) {
      sections.push("### Recommended Actions");
      sections.push("");
      for (const action of prReview.recommendedActions) {
        sections.push(`- ${action}`);
      }
      sections.push("");
    }
  }

  sections.push("---");
  sections.push("*Created by [reygent](https://github.com/andrewevans0102/reygent)*");

  return sections.join("\n");
}

export async function runPRCreate(
  context: TaskContext,
  opts?: { insecure?: boolean; branchType?: BranchType },
): Promise<PRCreateOutput> {
  loadEnvFile();

  const { stdout: remoteUrlForToken } = await exec("git", [
    "remote",
    "get-url",
    "origin",
  ]);
  const remoteForToken = parseRemote(remoteUrlForToken);
  const token = await resolveToken(remoteForToken.host);

  if (!opts?.branchType) {
    throw new TaskError("pr-create: branchType is required");
  }

  const branch = deriveBranchName(context.spec, opts.branchType);
  const commitMessage = buildCommitMessage(context, opts.branchType);
  const prBody = buildPRBody(context);
  const prTitle = context.spec.title;

  // Get default branch
  let baseBranch: string;
  try {
    const { stdout: defaultBranch } = await exec("git", [
      "symbolic-ref",
      "refs/remotes/origin/HEAD",
    ]);
    baseBranch = defaultBranch.trim().replace("refs/remotes/origin/", "");
  } catch {
    // Fallback: auto-set origin/HEAD and retry
    try {
      await exec("git", ["remote", "set-head", "origin", "-a"]);
      const { stdout: defaultBranch } = await exec("git", [
        "symbolic-ref",
        "refs/remotes/origin/HEAD",
      ]);
      baseBranch = defaultBranch.trim().replace("refs/remotes/origin/", "");
    } catch {
      // Final fallback: try common default branches
      const { stdout: branches } = await exec("git", [
        "branch",
        "-r",
        "--list",
        "origin/main",
        "origin/master",
      ]);
      const match = branches.trim().match(/origin\/(main|master)/);
      if (match) {
        baseBranch = match[1];
      } else {
        throw new TaskError(
          "pr-create: cannot determine default branch. Set with: git remote set-head origin <branch>",
        );
      }
    }
  }

  // Stage all changes
  await exec("git", ["add", "-A"]);

  // Verify there's something to commit
  const { stdout: status } = await exec("git", ["status", "--porcelain"]);
  if (!status.trim()) {
    throw new TaskError("pr-create: no changes to commit");
  }

  // Check if branch exists locally
  const { stdout: localBranches } = await exec("git", ["branch", "--list", branch]);
  const branchExists = localBranches.trim().length > 0;

  if (branchExists) {
    // Delete existing local branch
    try {
      await exec("git", ["branch", "-D", branch]);
    } catch {
      // If deletion fails, branch might be current branch - ignore
    }
  }

  // Create branch and commit
  const trace = getChesstrace();
  await exec("git", ["checkout", "-b", branch]);
  try { trace.emit(Events.GIT_BRANCH_CREATE, { branch }); } catch { /* swallow */ }
  await exec("git", ["commit", "-m", commitMessage]);
  try { trace.emit(Events.GIT_COMMIT, { branch, messageSubject: commitMessage.split('\n')[0] }); } catch { /* swallow */ }

  // Check if branch exists remotely and delete it
  try {
    const { stdout: remoteBranches } = await exec("git", [
      "ls-remote",
      "--heads",
      "origin",
      branch,
    ]);
    if (remoteBranches.trim().length > 0) {
      // Remote branch exists - delete it
      await exec("git", ["push", "origin", "--delete", branch]);
    }
  } catch {
    // Remote branch doesn't exist or delete failed - continue
  }

  // Push with timeout
  try {
    await exec("git", ["push", "-u", "origin", branch], { timeout: 60_000 });
    try { trace.emit(Events.GIT_PUSH, { branch }); } catch { /* swallow */ }
  } catch (pushErr) {
    try { trace.emit(Events.GIT_ERROR, { operation: "push", error: pushErr instanceof Error ? pushErr.message : String(pushErr) }); } catch { /* swallow */ }
    throw pushErr;
  }

  const { prUrl, prNumber } = await createPR({
    remote: remoteForToken,
    title: prTitle,
    body: prBody,
    head: branch,
    base: baseBranch,
    token,
    insecure: opts?.insecure,
  });

  return { branch, commitMessage, prUrl, prNumber };
}
