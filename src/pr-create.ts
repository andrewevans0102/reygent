import { execFile } from "node:child_process";
import { request as httpsRequest } from "node:https";
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
}): Promise<{ prUrl: string; prNumber: number }> {
  if (opts.remote.platform === "gitlab") {
    return createGitLabMR(opts);
  }
  return createGitHubPR(opts);
}

async function shouldRejectUnauthorized(): Promise<boolean> {
  // Respect GIT_SSL_NO_VERIFY env var (standard git convention)
  if (process.env.GIT_SSL_NO_VERIFY) return false;
  // Respect NODE_TLS_REJECT_UNAUTHORIZED if explicitly set
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") return false;
  // Respect git config http.sslVerify = false
  try {
    const { execFile: ef } = await import("node:child_process");
    const value = await new Promise<string>((res, rej) => {
      ef("git", ["config", "--bool", "http.sslVerify"], {}, (err, stdout) => {
        if (err) rej(err);
        else res(stdout.trim());
      });
    });
    if (value === "false") return false;
  } catch {
    // git config not set — proceed with verification
  }
  return true;
}

async function httpsPost(
  url: string,
  headers: Record<string, string>,
  body: string,
): Promise<{ status: number; text: string }> {
  const rejectUnauthorized = await shouldRejectUnauthorized();
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const bodyBuf = Buffer.from(body, "utf-8");
    const req = httpsRequest(
      {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        method: "POST",
        headers: { ...headers, "Content-Length": bodyBuf.byteLength },
        rejectUnauthorized,
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

async function createGitHubPR(opts: {
  remote: RemoteInfo;
  title: string;
  body: string;
  head: string;
  base: string;
  token: string;
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
    },
    body,
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
  sections.push("*Created by [reygent](https://github.com/andrewevans/reygent)*");

  return sections.join("\n");
}

export async function runPRCreate(
  context: TaskContext,
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

  // Create branch and commit
  await exec("git", ["checkout", "-b", branch]);
  await exec("git", ["commit", "-m", commitMessage]);

  // Push with timeout
  await exec("git", ["push", "-u", "origin", branch], { timeout: 60_000 });

  const { prUrl, prNumber } = await createPR({
    remote: remoteForToken,
    title: prTitle,
    body: prBody,
    head: branch,
    base: baseBranch,
    token,
  });

  return { branch, commitMessage, prUrl, prNumber };
}
