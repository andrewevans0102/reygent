import { execFile } from "node:child_process";
import { request as httpsRequest } from "node:https";
import chalk from "chalk";
import { getAgents } from "./config.js";
import { wrapText } from "./format.js";
import { spawnAgent, type AgentSpawnOptions } from "./implement.js";
import { extractJSON } from "./planner.js";
import {
  parseRemote,
  resolveToken,
  resolveTlsOptions,
  httpsPost,
  type RemoteInfo,
  type Platform,
  type TlsOptions,
} from "./pr-create.js";
import type { PRReviewComment, PRReviewOutput, TaskContext } from "./task.js";
import { TaskError } from "./task.js";
import type { UsageInfo } from "./usage.js";
import {
  splitDiffByFile,
  selectDiffsWithinBudget,
  estimateTokens,
  MAX_REVIEW_TOKENS,
} from "./diff-split.js";

interface PRReviewPromptInput {
  stat: string;
  log: string;
  includedDiffs: { file: string; diff: string }[];
  excludedFiles: string[];
}

function buildPRReviewPrompt(
  systemPrompt: string,
  context: TaskContext,
  input: PRReviewPromptInput,
): string {
  const goals = context.plan?.goals ?? [];
  const tasks = context.plan?.tasks ?? [];

  let prompt = `${systemPrompt}

---

## Spec

**Title:** ${context.spec.title}

${context.spec.content}

---

## Planner Output

**Goals:**
${goals.length > 0 ? goals.map((g) => `- ${g}`).join("\n") : "- (none)"}

**Tasks:**
${tasks.length > 0 ? tasks.map((t) => `- ${t}`).join("\n") : "- (none)"}

---

## Branch Summary

### Changed Files

\`\`\`
${input.stat}
\`\`\`

### Commits

\`\`\`
${input.log}
\`\`\``;

  if (input.includedDiffs.length > 0) {
    prompt += `

## File Diffs

`;
    for (const f of input.includedDiffs) {
      prompt += `\`\`\`diff
${f.diff}
\`\`\`

`;
    }
  }

  if (input.excludedFiles.length > 0) {
    prompt += `
### Files not shown (too large for context)

${input.excludedFiles.map((f) => `- ${f}`).join("\n")}
`;
  }

  prompt += `

---

## Instructions

1. Review the changes above in the context of the spec and planner goals.
2. Check for correctness, potential bugs, style issues, and whether the implementation meets the spec.
3. For files not shown, note any concerns based on the stat summary and commit messages.
4. When you are finished, output a single JSON block with your review:

\`\`\`json
{
  "summary": "Brief overall assessment of the PR",
  "comments": [
    {
      "file": "src/example.ts",
      "line": 42,
      "comment": "Description of the issue or suggestion"
    }
  ],
  "recommendedActions": [
    "Action item 1",
    "Action item 2"
  ]
}
\`\`\`

- \`summary\` is a brief overall assessment of the PR.
- \`comments\` is an array of inline review comments. \`line\` may be null if the comment applies to the whole file.
- \`recommendedActions\` is a list of suggested follow-up actions.
- Do NOT output any text after the JSON block.`;

  return prompt;
}

export function extractPRReviewOutput(stdout: string): PRReviewOutput {
  const cleaned = extractJSON(stdout);
  const match = cleaned.match(
    /\{\s*"summary"\s*:\s*"[^"]*"[\s\S]*?"recommendedActions"\s*:\s*\[[\s\S]*?\]\s*\}/,
  );
  if (!match) {
    throw new TaskError(
      "pr-review: failed to extract JSON output from agent response",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    throw new TaskError("pr-review: extracted block is not valid JSON");
  }

  const obj = parsed as Record<string, unknown>;

  if (typeof obj.summary !== "string") {
    throw new TaskError("pr-review: 'summary' must be a string");
  }

  if (!Array.isArray(obj.comments)) {
    throw new TaskError("pr-review: 'comments' must be an array");
  }

  if (!Array.isArray(obj.recommendedActions)) {
    throw new TaskError("pr-review: 'recommendedActions' must be an array");
  }

  const comments: PRReviewComment[] = (obj.comments as unknown[]).map(
    (c, i) => {
      const comment = c as Record<string, unknown>;
      if (typeof comment.file !== "string") {
        throw new TaskError(`pr-review: comments[${i}] missing 'file'`);
      }
      if (typeof comment.comment !== "string") {
        throw new TaskError(`pr-review: comments[${i}] missing 'comment'`);
      }
      return {
        file: comment.file,
        line: typeof comment.line === "number" ? comment.line : null,
        comment: comment.comment,
      };
    },
  );

  const recommendedActions = (obj.recommendedActions as unknown[]).map(
    (a, i) => {
      if (typeof a !== "string") {
        throw new TaskError(
          `pr-review: recommendedActions[${i}] must be a string`,
        );
      }
      return a;
    },
  );

  return { summary: obj.summary, comments, recommendedActions };
}

export function formatPRReviewOutput(output: PRReviewOutput): string {
  const lines: string[] = [];

  lines.push("# 🐱 Reygent PR Review");
  lines.push("");
  lines.push("## Summary");
  lines.push(output.summary);
  lines.push("");

  if (output.comments.length > 0) {
    lines.push("## Comments");

    const byFile = new Map<string, PRReviewComment[]>();
    for (const c of output.comments) {
      const group = byFile.get(c.file) ?? [];
      group.push(c);
      byFile.set(c.file, group);
    }

    for (const [file, comments] of byFile) {
      lines.push(`\n### ${file}`);
      for (const c of comments) {
        const lineRef = c.line !== null ? `:${c.line}` : "";
        lines.push(`  - ${file}${lineRef}: ${c.comment}`);
      }
    }
    lines.push("");
  }

  if (output.recommendedActions.length > 0) {
    lines.push("## Recommended Actions");
    for (const action of output.recommendedActions) {
      lines.push(`  - ${action}`);
    }
  }

  return lines.join("\n");
}


export function formatPRReviewTerminal(output: PRReviewOutput): string {
  const lines: string[] = [];
  const cols = process.stdout.columns || 80;

  lines.push("");
  lines.push(chalk.cyan.bold("Summary"));
  //  summary indent = 2
  lines.push(`  ${wrapText(output.summary, 2, cols)}`);
  lines.push("");

  if (output.comments.length > 0) {
    lines.push(chalk.cyan.bold(`Comments (${output.comments.length}):`));

    const byFile = new Map<string, PRReviewComment[]>();
    for (const c of output.comments) {
      const group = byFile.get(c.file) ?? [];
      group.push(c);
      byFile.set(c.file, group);
    }

    // comment text indent = 6 (4 spaces + bullet + space)
    const commentIndent = 6;
    for (const [file, comments] of byFile) {
      lines.push("");
      lines.push(`  ${chalk.bold(file)}`);
      for (const c of comments) {
        const lineRef = c.line !== null ? `:${c.line}` : "";
        const prefix = lineRef ? `${lineRef} ` : "";
        const wrapped = wrapText(prefix + c.comment, commentIndent, cols);
        // Re-apply chalk to the line ref portion of first line
        const display = c.line !== null
          ? chalk.gray(`:${c.line}`) + " " + wrapped.slice(prefix.length)
          : wrapped;
        lines.push(`    ${chalk.yellow("•")} ${display}`);
      }
    }
    lines.push("");
  }

  if (output.recommendedActions.length > 0) {
    lines.push(chalk.cyan.bold("Recommended Actions:"));
    lines.push("");
    // action indent = 4 (2 spaces + dash + space)
    for (const action of output.recommendedActions) {
      lines.push(`  ${chalk.gray("-")} ${wrapText(action, 4, cols)}`);
    }
  }

  return lines.join("\n");
}

function exec(
  cmd: string,
  args: string[],
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new TaskError(
              `pr-review: command failed: ${cmd} ${args.join(" ")}\n${stderr || error.message}`,
            ),
          );
          return;
        }
        resolve(stdout);
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Platform-aware HTTP helpers
// ---------------------------------------------------------------------------

async function httpsGet(
  url: string,
  headers: Record<string, string>,
  opts?: { insecure?: boolean },
): Promise<{ status: number; text: string }> {
  const parsed = new URL(url);
  const tlsOpts: TlsOptions = opts?.insecure
    ? { rejectUnauthorized: false }
    : await resolveTlsOptions(parsed.hostname);

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

function getApiBase(remote: RemoteInfo): string {
  if (remote.platform === "gitlab") {
    const projectPath = encodeURIComponent(`${remote.owner}/${remote.repo}`);
    return `https://${remote.host}/api/v4/projects/${projectPath}`;
  }
  const apiHost =
    remote.host === "github.com"
      ? "https://api.github.com"
      : `https://${remote.host}/api/v3`;
  return `${apiHost}/repos/${remote.owner}/${remote.repo}`;
}

function getAuthHeaders(remote: RemoteInfo, token: string): Record<string, string> {
  if (remote.platform === "gitlab") {
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
    "User-Agent": "reygent",
  };
}

// ---------------------------------------------------------------------------
// Platform-aware PR/MR operations (replace gh CLI callsites)
// ---------------------------------------------------------------------------

async function getRemoteAndToken(): Promise<{ remote: RemoteInfo; token: string }> {
  const remoteUrl = (await exec("git", ["remote", "get-url", "origin"])).trim();
  const remote = parseRemote(remoteUrl);
  const token = await resolveToken(remote.host);
  return { remote, token };
}

/**
 * Get the base branch of a PR/MR.
 * Consolidates the duplicate baseRefName queries from getPRDiffStat + getPRCommitLog.
 */
async function getBaseBranch(
  prNumber: number,
  remote: RemoteInfo,
  token: string,
  insecure?: boolean,
): Promise<string> {
  const apiBase = getApiBase(remote);
  const headers = getAuthHeaders(remote, token);

  if (remote.platform === "gitlab") {
    const { status, text } = await httpsGet(
      `${apiBase}/merge_requests/${prNumber}`,
      headers,
      { insecure },
    );
    if (status < 200 || status >= 300) {
      throw new TaskError(`pr-review: GitLab API error ${status}: ${text}`);
    }
    const data = JSON.parse(text) as { target_branch: string };
    return data.target_branch;
  }

  // GitHub
  const { status, text } = await httpsGet(
    `${apiBase}/pulls/${prNumber}`,
    headers,
    { insecure },
  );
  if (status < 200 || status >= 300) {
    throw new TaskError(`pr-review: GitHub API error ${status}: ${text}`);
  }
  const data = JSON.parse(text) as { base: { ref: string } };
  return data.base.ref;
}

/**
 * Get the unified diff for a PR/MR.
 */
async function getDiff(
  prNumber: number,
  remote: RemoteInfo,
  token: string,
  insecure?: boolean,
): Promise<string> {
  const apiBase = getApiBase(remote);

  if (remote.platform === "gitlab") {
    const headers = getAuthHeaders(remote, token);
    const { status, text } = await httpsGet(
      `${apiBase}/merge_requests/${prNumber}/changes`,
      headers,
      { insecure },
    );
    if (status < 200 || status >= 300) {
      throw new TaskError(`pr-review: GitLab API error ${status}: ${text}`);
    }
    const data = JSON.parse(text) as {
      changes: Array<{ old_path: string; new_path: string; diff: string }>;
    };
    // Reconstruct unified diff from GitLab changes
    return data.changes
      .map((c) => {
        const header =
          c.old_path === c.new_path
            ? `diff --git a/${c.old_path} b/${c.new_path}`
            : `diff --git a/${c.old_path} b/${c.new_path}\nrename from ${c.old_path}\nrename to ${c.new_path}`;
        return `${header}\n${c.diff}`;
      })
      .join("\n");
  }

  // GitHub: request diff format directly
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github.v3.diff",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "reygent",
  };
  const { status, text } = await httpsGet(
    `${apiBase}/pulls/${prNumber}`,
    headers,
    { insecure },
  );
  if (status < 200 || status >= 300) {
    throw new TaskError(`pr-review: GitHub API error ${status}: ${text}`);
  }
  return text;
}

/** Get diff stat for a PR by diffing against the PR base branch */
async function getPRDiffStat(
  prNumber: number,
  remote: RemoteInfo,
  token: string,
  insecure?: boolean,
): Promise<string> {
  try {
    const baseBranch = await getBaseBranch(prNumber, remote, token, insecure);
    return (await exec("git", ["diff", "--stat", `origin/${baseBranch}...HEAD`])).trim();
  } catch (err) {
    if (process.env.DEBUG) {
      console.warn("getPRDiffStat failed:", err instanceof Error ? err.message : String(err));
    }
    return "";
  }
}

/** Get commit log for a PR by logging against the PR base branch */
async function getPRCommitLog(
  prNumber: number,
  remote: RemoteInfo,
  token: string,
  insecure?: boolean,
): Promise<string> {
  try {
    const baseBranch = await getBaseBranch(prNumber, remote, token, insecure);
    return (await exec("git", ["log", `origin/${baseBranch}..HEAD`, "--oneline"])).trim();
  } catch (err) {
    if (process.env.DEBUG) {
      console.warn("getPRCommitLog failed:", err instanceof Error ? err.message : String(err));
    }
    return "";
  }
}

/**
 * Detect PR/MR number from current git branch.
 * Uses platform-aware REST API instead of gh CLI.
 */
async function detectPRFromBranch(
  remote: RemoteInfo,
  token: string,
  insecure?: boolean,
): Promise<{ prNumber: number; branch: string }> {
  const branch = (await exec("git", ["branch", "--show-current"])).trim();
  if (!branch) {
    throw new TaskError(
      "pr-review: not on a branch — cannot auto-detect PR number",
    );
  }

  const apiBase = getApiBase(remote);
  const headers = getAuthHeaders(remote, token);

  if (remote.platform === "gitlab") {
    const encodedBranch = encodeURIComponent(branch);
    const { status, text } = await httpsGet(
      `${apiBase}/merge_requests?source_branch=${encodedBranch}&state=opened`,
      headers,
      { insecure },
    );
    if (status < 200 || status >= 300) {
      throw new TaskError(
        `pr-review: no open MR found for branch "${branch}". Create an MR first or provide a number.`,
      );
    }
    const mrs = JSON.parse(text) as Array<{ iid: number }>;
    if (mrs.length === 0) {
      throw new TaskError(
        `pr-review: no open MR found for branch "${branch}". Create an MR first or provide a number.`,
      );
    }
    return { prNumber: mrs[0].iid, branch };
  }

  // GitHub: search PRs by head branch
  const encodedHead = encodeURIComponent(`${remote.owner}:${branch}`);
  const { status, text } = await httpsGet(
    `${apiBase}/pulls?head=${encodedHead}&state=open`,
    headers,
    { insecure },
  );
  if (status < 200 || status >= 300) {
    throw new TaskError(
      `pr-review: no open PR found for branch "${branch}". Create a PR first or provide a PR number.`,
    );
  }
  const prs = JSON.parse(text) as Array<{ number: number }>;
  if (prs.length === 0) {
    throw new TaskError(
      `pr-review: no open PR found for branch "${branch}". Create a PR first or provide a PR number.`,
    );
  }
  return { prNumber: prs[0].number, branch };
}

/**
 * Resolve the PR number from context or by detecting from the current branch.
 */
async function resolvePRNumber(
  context: TaskContext,
  remote: RemoteInfo,
  token: string,
  insecure?: boolean,
): Promise<number> {
  if (context.prCreate) {
    return context.prCreate.prNumber;
  }
  console.log(chalk.blue("No PR number provided — detecting from current branch..."));
  const detected = await detectPRFromBranch(remote, token, insecure);
  console.log(chalk.green(`Found PR #${detected.prNumber} on branch "${detected.branch}"`));
  return detected.prNumber;
}

export async function runPRReview(
  context: TaskContext,
  options?: AgentSpawnOptions,
): Promise<{ output: PRReviewOutput; usage?: UsageInfo }> {
  const { remote, token } = await getRemoteAndToken();
  const prNumber = await resolvePRNumber(context, remote, token);

  const agents = getAgents();
  const agent = agents.find((a) => a.name === "pr-reviewer");
  if (!agent) {
    throw new TaskError("pr-review: missing pr-reviewer agent config");
  }

  const [diff, stat, log] = await Promise.all([
    getDiff(prNumber, remote, token),
    getPRDiffStat(prNumber, remote, token),
    getPRCommitLog(prNumber, remote, token),
  ]);

  // Split diff by file and select within budget
  const fileDiffs = splitDiffByFile(diff);
  const reservedTokens = estimateTokens(agent.systemPrompt) + estimateTokens(stat) + estimateTokens(log) + 2000;
  const { included, excluded } = selectDiffsWithinBudget(fileDiffs, MAX_REVIEW_TOKENS, reservedTokens);

  const prompt = buildPRReviewPrompt(agent.systemPrompt, context, {
    stat,
    log,
    includedDiffs: included,
    excludedFiles: excluded,
  });
  const result = await spawnAgent("pr-review", prompt, { ...options, quiet: true, provider: agent.provider, model: agent.model, allowedTools: [] });

  if (result.exitCode !== 0) {
    throw new TaskError(
      `pr-review: agent exited with code ${result.exitCode}`,
    );
  }

  return { output: extractPRReviewOutput(result.stdout), usage: result.usage };
}

/**
 * Post a formatted PR review as a comment on the pull request.
 * Supports both GitHub PRs and GitLab MRs.
 */
export async function postPRReviewComment(
  context: TaskContext,
  review: PRReviewOutput,
): Promise<void> {
  const { remote, token } = await getRemoteAndToken();
  const prNumber = await resolvePRNumber(context, remote, token);
  const body = formatPRReviewOutput(review) +
    "\n\n---\n*Review by [reygent](https://github.com/andrewevans0102/reygent)*";

  const apiBase = getApiBase(remote);

  if (remote.platform === "gitlab") {
    const headers = getAuthHeaders(remote, token);
    const { status, text } = await httpsPost(
      `${apiBase}/merge_requests/${prNumber}/notes`,
      headers,
      JSON.stringify({ body }),
    );
    if (status < 200 || status >= 300) {
      throw new TaskError(`pr-review: GitLab API error ${status}: ${text}`);
    }
    return;
  }

  // GitHub: post as issue comment
  const headers = getAuthHeaders(remote, token);
  const { status, text } = await httpsPost(
    `${apiBase}/issues/${prNumber}/comments`,
    headers,
    JSON.stringify({ body }),
  );
  if (status < 200 || status >= 300) {
    throw new TaskError(`pr-review: GitHub API error ${status}: ${text}`);
  }
}
