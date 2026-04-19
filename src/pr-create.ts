import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import { rootCertificates } from "node:tls";
import { loadEnvFile } from "./env.js";
import type { SpecPayload } from "./spec.js";
import type { PRCreateOutput, TaskContext } from "./task.js";
import { TaskError } from "./task.js";

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

export function parseRemote(remoteUrl: string): RemoteInfo {
  const url = remoteUrl.trim();

  // SSH: git@github.com:owner/repo.git
  const sshMatch = url.match(/^git@([^:]+):([^/]+)\/([^/.]+?)(\.git)?$/);
  if (sshMatch) {
    const host = sshMatch[1];
    const platform: Platform = host.includes("gitlab") ? "gitlab" : "github";
    return { platform, host, owner: sshMatch[2], repo: sshMatch[3] };
  }

  // HTTPS: https://github.com/owner/repo.git
  const httpsMatch = url.match(/^https?:\/\/([^/]+)\/([^/]+)\/([^/.]+?)(\.git)?$/);
  if (httpsMatch) {
    const host = httpsMatch[1];
    const platform: Platform = host.includes("gitlab") ? "gitlab" : "github";
    return { platform, host, owner: httpsMatch[2], repo: httpsMatch[3] };
  }

  throw new TaskError(`pr-create: cannot parse remote URL: ${url}`);
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

interface TlsOptions {
  rejectUnauthorized?: boolean;
  ca?: string[];
}

async function resolveTlsOptions(hostname?: string): Promise<TlsOptions> {
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

  if (caPath) {
    try {
      const customCa = readFileSync(caPath, "utf-8");
      // Combine Node's default CAs with the custom bundle so both are trusted
      return { ca: [...rootCertificates, customCa] };
    } catch {
      // CA file unreadable — fall through to defaults
    }
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

function isSslError(err: unknown): boolean {
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

async function httpsPost(
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

export function deriveBranchName(spec: SpecPayload): string {
  switch (spec.source) {
    case "jira":
      return `reygent/${spec.issueKey}`;
    case "linear":
      return `reygent/${spec.issueId}`;
    case "markdown": {
      const slug = spec.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 60);
      return `reygent/${slug}`;
    }
  }
}

export function buildCommitMessage(context: TaskContext): string {
  const spec = context.spec;
  const plan = context.plan;

  let prefix: string;
  switch (spec.source) {
    case "jira":
      prefix = `[${spec.issueKey}]`;
      break;
    case "linear":
      prefix = `[${spec.issueId}]`;
      break;
    case "markdown":
      prefix = "[reygent]";
      break;
  }

  const subject = `${prefix} ${spec.title}`;

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

  if (security) {
    sections.push("## Security Review");
    sections.push("");
    if (security.findings.length === 0) {
      sections.push("No findings.");
    } else {
      sections.push(
        `${security.findings.length} finding(s) — highest severity: **${security.severity}**`,
      );
      sections.push("");
      for (const f of security.findings) {
        const loc = f.location
          ? ` (\`${f.location.file}${f.location.line ? `:${f.location.line}` : ""}\`)`
          : "";
        sections.push(`- **${f.severity}**: ${f.description}${loc}`);
      }
    }
    sections.push("");
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
  opts?: { insecure?: boolean },
): Promise<PRCreateOutput> {
  loadEnvFile();

  const { stdout: remoteUrlForToken } = await exec("git", [
    "remote",
    "get-url",
    "origin",
  ]);
  const remoteForToken = parseRemote(remoteUrlForToken);
  const token = await resolveToken(remoteForToken.host);

  const branch = deriveBranchName(context.spec);
  const commitMessage = buildCommitMessage(context);
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
  await exec("git", ["checkout", "-b", branch]);
  await exec("git", ["commit", "-m", commitMessage]);

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
  await exec("git", ["push", "-u", "origin", branch], { timeout: 60_000 });

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
