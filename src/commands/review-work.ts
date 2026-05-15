import { execFile } from "node:child_process";
import { request as httpsRequest } from "node:https";
import chalk from "chalk";
import ora from "ora";
import { getAgents } from "../config.js";
import { spawnAgent } from "../implement.js";
import { loadEnvFile } from "../env.js";
import { isDebug } from "../debug.js";
import { createLiveStatus } from "../live-status.js";
import type { ActivityEvent } from "../providers/types.js";
import { loadSpec, SpecError } from "../spec.js";
import { parseRemote, resolveToken } from "../pr-create.js";
import type { RemoteInfo } from "../pr-create.js";
import {
  runPRReview,
  postPRReviewComment,
  extractPRReviewOutput,
  formatPRReviewTerminal,
  formatPRReviewOutput,
} from "../pr-review.js";
import type { PRReviewOutput, TaskContext } from "../task.js";
import { TaskError } from "../task.js";
import { parseSpecWithPrefix, SpecPrefixError } from "../spec-prefix.js";
import {
  splitDiffByFile,
  selectDiffsWithinBudget,
  estimateTokens,
  MAX_REVIEW_TOKENS,
  RESERVED_PROMPT_TOKENS,
} from "../diff-split.js";
import { getChesstrace } from "../chesstrace/index.js";
import { Events } from "../chesstrace/events.js";

interface ReviewWorkOptions {
  spec?: string;
  /**
   * Skip SSL certificate verification for API calls.
   * Note: Only applies to GitLab MR detection/posting via HTTPS API.
   * Does not affect gh CLI operations (GitHub PR workflow).
   */
  insecure?: boolean;
}

function exec(
  cmd: string,
  args: string[],
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { maxBuffer: 50 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new TaskError(
              `review-work: command failed: ${cmd} ${args.join(" ")}\n${stderr || error.message}`,
            ),
          );
          return;
        }
        resolve(stdout);
      },
    );
  });
}

async function getCurrentBranch(): Promise<string> {
  const branch = (await exec("git", ["branch", "--show-current"])).trim();
  if (!branch || !branch.trim()) {
    throw new TaskError("review-work: not on a branch (detached HEAD?)");
  }
  return branch;
}

async function getDefaultBranch(): Promise<string> {
  try {
    const ref = (
      await exec("git", ["symbolic-ref", "refs/remotes/origin/HEAD"])
    ).trim();
    return ref.replace("refs/remotes/origin/", "");
  } catch {
    // Fallback: check for common defaults
    try {
      const branches = (
        await exec("git", ["branch", "-r", "--list", "origin/main", "origin/master"])
      ).trim();
      const match = branches.match(/origin\/(main|master)/);
      if (match) return match[1];
    } catch {
      // ignore
    }
    return "main";
  }
}

async function detectGitHubPR(): Promise<number | null> {
  try {
    const json = await exec("gh", [
      "pr",
      "view",
      "--json",
      "number",
      "--jq",
      ".number",
    ]);
    const num = parseInt(json.trim(), 10);
    return isNaN(num) || num <= 0 ? null : num;
  } catch {
    return null;
  }
}

interface TlsOptions {
  rejectUnauthorized?: boolean;
}

function httpsGet(
  url: string,
  headers: Record<string, string>,
  tlsOpts?: TlsOptions,
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

function httpsPost(
  url: string,
  headers: Record<string, string>,
  body: string,
  tlsOpts?: TlsOptions,
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

async function detectGitLabMR(
  remote: RemoteInfo,
  token: string,
  branch: string,
  insecure?: boolean,
): Promise<number | null> {
  const projectPath = encodeURIComponent(`${remote.owner}/${remote.repo}`);
  const encodedBranch = encodeURIComponent(branch);
  const url = `https://${remote.host}/api/v4/projects/${projectPath}/merge_requests?source_branch=${encodedBranch}&state=opened`;
  const tlsOpts: TlsOptions = insecure ? { rejectUnauthorized: false } : {};

  try {
    const { status, text } = await httpsGet(
      url,
      { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      tlsOpts,
    );
    if (status < 200 || status >= 300) return null;
    const mrs = JSON.parse(text) as Array<{ iid: number }>;
    return mrs.length > 0 ? mrs[0].iid : null;
  } catch {
    return null;
  }
}

async function getGitDiff(baseBranch: string): Promise<string> {
  return exec("git", ["diff", `${baseBranch}...HEAD`]);
}

async function getGitStat(baseBranch: string): Promise<string> {
  return exec("git", ["diff", "--stat", `${baseBranch}...HEAD`]);
}

async function getGitLog(baseBranch: string): Promise<string> {
  return exec("git", ["log", `${baseBranch}..HEAD`, "--oneline"]);
}

async function postGitLabComment(
  remote: RemoteInfo,
  token: string,
  mrIid: number,
  body: string,
  insecure?: boolean,
): Promise<void> {
  const projectPath = encodeURIComponent(`${remote.owner}/${remote.repo}`);
  const url = `https://${remote.host}/api/v4/projects/${projectPath}/merge_requests/${mrIid}/notes`;
  const tlsOpts: TlsOptions = insecure ? { rejectUnauthorized: false } : {};

  const { status, text } = await httpsPost(
    url,
    { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    JSON.stringify({ body }),
    tlsOpts,
  );
  if (status < 200 || status >= 300) {
    throw new TaskError(`review-work: GitLab API error ${status}: ${text}`);
  }
}

interface ReviewPromptInput {
  stat: string;
  log: string;
  includedDiffs: { file: string; diff: string }[];
  excludedFiles: string[];
  spec?: { title: string; content: string };
}

function buildReviewPrompt(
  systemPrompt: string,
  input: ReviewPromptInput,
): string {
  let prompt = systemPrompt;

  if (input.spec) {
    prompt += `

---

## Spec

**Title:** ${input.spec.title}

${input.spec.content}

---`;
  }

  prompt += `

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
### Files not shown (${input.excludedFiles.length} excluded due to size)

${input.excludedFiles.map((f) => `- ${f}`).join("\n")}
`;
  }

  prompt += `

---

## Instructions

1. Review the changes above${input.spec ? " in the context of the spec" : ""}.
2. Check for correctness, potential bugs, style issues${input.spec ? ", and whether the implementation meets the spec" : ""}.
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

async function runAgentReview(
  baseBranch: string,
  spec?: { title: string; content: string },
  onActivity?: (event: ActivityEvent) => void,
): Promise<PRReviewOutput> {
  const agents = getAgents();
  const agent = agents.find((a) => a.role === "reviewer");
  if (!agent) {
    throw new TaskError("review-work: no agent with role 'reviewer' found in config");
  }

  const [diff, stat, log] = await Promise.all([
    getGitDiff(baseBranch),
    getGitStat(baseBranch),
    getGitLog(baseBranch),
  ]);

  if (!diff.trim()) {
    throw new TaskError("review-work: no changes found");
  }

  // Split diff by file and select within budget
  const fileDiffs = splitDiffByFile(diff);
  const reservedTokens = estimateTokens(agent.systemPrompt) + estimateTokens(stat) + estimateTokens(log) + RESERVED_PROMPT_TOKENS;
  const { included, excluded } = selectDiffsWithinBudget(fileDiffs, MAX_REVIEW_TOKENS, reservedTokens);

  // Debug logging and telemetry for diff budget decisions
  const totalDiffTokens = included.reduce((sum, f) => sum + f.tokens, 0);
  const excludedTokens = fileDiffs.filter(f => excluded.includes(f.file)).reduce((sum, f) => sum + f.tokens, 0);
  const availableTokens = MAX_REVIEW_TOKENS - reservedTokens;

  if (isDebug()) {
    console.log(
      `[DEBUG] Diff budget: ${totalDiffTokens}/${availableTokens} tokens used ` +
      `(${included.length}/${fileDiffs.length} files included, ${excluded.length} excluded for ${excludedTokens} tokens)`
    );
    if (excluded.length > 0) {
      console.log(`[DEBUG] Excluded files: ${excluded.join(", ")}`);
    }
  }

  // Emit telemetry event
  const chesstrace = getChesstrace();
  if (chesstrace) {
    try {
      chesstrace.emit(Events.REVIEW_DIFF_BUDGET, {
        filesIncluded: included.length,
        filesExcluded: excluded.length,
        tokensUsed: totalDiffTokens,
        tokensAvailable: availableTokens,
        excludedFilesList: excluded,
      });
    } catch {
      // Swallow emit errors
    }
  }

  const prompt = buildReviewPrompt(agent.systemPrompt, {
    stat: stat.trim(),
    log: log.trim(),
    includedDiffs: included,
    excludedFiles: excluded,
    spec,
  });
  const result = await spawnAgent("pr-review", prompt, { quiet: true, onActivity, provider: agent.provider, model: agent.model, allowedTools: [] });

  if (result.exitCode !== 0) {
    throw new TaskError(
      `review-work: agent exited with code ${result.exitCode}`,
    );
  }

  return extractPRReviewOutput(result.stdout);
}

export async function reviewWorkCommand(
  options: ReviewWorkOptions,
): Promise<void> {
  try {
    // Verify we're in a git repo
    try {
      await exec("git", ["rev-parse", "--is-inside-work-tree"]);
    } catch {
      console.log(chalk.red.bold("Error:"), "Not inside a git repository.");
      process.exit(1);
    }

    loadEnvFile();

    // Load spec if provided
    let spec: { title: string; content: string } | undefined;
    if (options.spec) {
      const spinner = ora("Loading spec...").start();
      try {
        const parsed = parseSpecWithPrefix(options.spec);
        const loaded = await loadSpec(parsed.identifier, parsed.provider);
        spec = { title: loaded.title, content: loaded.content };
        spinner.succeed(chalk.green(`Spec loaded: ${loaded.title}`));
      } catch (err) {
        spinner.fail(chalk.red("Failed to load spec"));
        throw err;
      }
    }

    // Detect platform
    const remoteUrl = (
      await exec("git", ["remote", "get-url", "origin"])
    ).trim();
    const remote = parseRemote(remoteUrl);
    const branch = await getCurrentBranch();
    const defaultBranch = await getDefaultBranch();

    console.log(
      chalk.gray(`  Platform: ${remote.platform}`) +
        chalk.gray(` | Branch: ${branch}`) +
        chalk.gray(` | Base: ${defaultBranch}`),
    );
    console.log();

    if (remote.platform === "github") {
      // GitHub path
      const spinner = ora("Checking for open PR...").start();
      const prNumber = await detectGitHubPR();

      if (prNumber !== null) {
        spinner.succeed(chalk.green(`Found PR #${prNumber}`));

        // Build minimal TaskContext for runPRReview
        const context: TaskContext = {
          spec: spec
            ? { source: "markdown" as const, title: spec.title, content: spec.content }
            : { source: "markdown" as const, title: "Review", content: "" },
          prCreate: {
            branch,
            commitMessage: "",
            prUrl: "",
            prNumber,
          },
          results: [],
        };

        console.log();
        const prReviewStatus = createLiveStatus("Running PR review...");
        const { output } = await runPRReview(context, { quiet: true, onActivity: prReviewStatus.onActivity });
        prReviewStatus.succeed(chalk.green("Review complete"));

        console.log(formatPRReviewTerminal(output));
        console.log();

        const postSpinner = ora("Posting review comment to PR...").start();
        try {
          await postPRReviewComment(context, output);
          postSpinner.succeed(chalk.green(`Review posted to PR #${prNumber}`));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          postSpinner.fail(chalk.red(`Failed to post comment: ${msg}`));
        }
      } else {
        spinner.info(chalk.yellow("No open PR found for this branch"));
        console.log();

        const reviewStatus = createLiveStatus("Running review...");
        let output: PRReviewOutput;
        try {
          output = await runAgentReview(defaultBranch, spec, reviewStatus.onActivity);
        } catch (err) {
          if (err instanceof TaskError && err.message.includes("no changes found")) {
            reviewStatus.stop();
            console.log(chalk.yellow("No changes found against"), chalk.bold(defaultBranch));
            return;
          }
          throw err;
        }
        reviewStatus.succeed(chalk.green("Review complete"));

        console.log(formatPRReviewTerminal(output));
        console.log();
        console.log(chalk.gray("No PR found — review printed to console only."));
      }
    } else {
      // GitLab path
      const spinner = ora("Checking for open MR...").start();
      let token: string;
      try {
        token = await resolveToken(remote.host);
      } catch (err) {
        if (isDebug()) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(chalk.gray(`[debug] Token resolution failed: ${msg}`));
        }
        spinner.info(chalk.yellow("Could not resolve GitLab token — skipping MR detection"));
        token = "";
      }

      const mrIid = token
        ? await detectGitLabMR(remote, token, branch, options.insecure)
        : null;

      if (mrIid !== null) {
        spinner.succeed(chalk.green(`Found MR !${mrIid}`));
      } else {
        spinner.info(chalk.yellow("No open MR found for this branch"));
      }

      console.log();
      const glReviewStatus = createLiveStatus("Running review...");
      let output: PRReviewOutput;
      try {
        output = await runAgentReview(defaultBranch, spec, glReviewStatus.onActivity);
      } catch (err) {
        if (err instanceof TaskError && err.message.includes("no changes found")) {
          glReviewStatus.stop();
          console.log(chalk.yellow("No changes found against"), chalk.bold(defaultBranch));
          return;
        }
        throw err;
      }
      glReviewStatus.succeed(chalk.green("Review complete"));

      console.log(formatPRReviewTerminal(output));
      console.log();

      if (mrIid !== null && token) {
        const postSpinner = ora("Posting review comment to MR...").start();
        try {
          const body =
            formatPRReviewOutput(output) +
            "\n\n---\n*Review by [reygent](https://github.com/andrewevans0102/reygent)*";
          await postGitLabComment(remote, token, mrIid, body, options.insecure);
          postSpinner.succeed(chalk.green(`Review posted to MR !${mrIid}`));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          postSpinner.fail(chalk.red(`Failed to post comment: ${msg}`));
        }
      } else {
        console.log(chalk.gray("No MR found — review printed to console only."));
      }
    }
  } catch (err) {
    if (err instanceof Error && err.name === "ExitPromptError") {
      process.exit(0);
    }
    if (err instanceof SpecError || err instanceof SpecPrefixError || err instanceof TaskError) {
      console.log(chalk.red.bold("Error:"), err.message);
      if (isDebug()) console.error(err.stack);
      process.exit(1);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.log(chalk.red.bold("Internal error:"), message);
    if (isDebug()) console.error(err instanceof Error ? err.stack : err);
    process.exit(2);
  }
}
