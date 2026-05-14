import { execFile } from "node:child_process";
import { request as httpsRequest } from "node:https";
import chalk from "chalk";
import ora from "ora";
import { confirm } from "@inquirer/prompts";
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
import { withTelemetry } from "../telemetry-lifecycle.js";
import {
  estimateTokens,
  MAX_DIFF_TOKENS,
  splitDiffByFile,
  mergePRReviews,
  formatFileList,
  estimateCostMultiplier,
} from "../diff-split.js";
import { SingleBar, Presets } from "cli-progress";

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

function buildReviewPrompt(
  systemPrompt: string,
  diff: string,
  spec?: { title: string; content: string },
): string {
  let prompt = systemPrompt;

  if (spec) {
    prompt += `

---

## Spec

**Title:** ${spec.title}

${spec.content}

---`;
  }

  prompt += `

## PR Diff

\`\`\`diff
${diff}
\`\`\`

---

## Instructions

1. Review the PR diff above${spec ? " in the context of the spec" : ""}.
2. Check for correctness, potential bugs, style issues${spec ? ", and whether the implementation meets the spec" : ""}.
3. When you are finished, output a single JSON block with your review:

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
  diff: string,
  spec?: { title: string; content: string },
  onActivity?: (event: ActivityEvent) => void,
): Promise<PRReviewOutput> {
  const agents = getAgents();
  const agent = agents.find((a) => a.role === "reviewer");
  if (!agent) {
    throw new TaskError("review-work: no agent with role 'reviewer' found in config");
  }

  const prompt = buildReviewPrompt(agent.systemPrompt, diff, spec);
  const result = await spawnAgent("pr-review", prompt, { quiet: true, onActivity, provider: agent.provider, model: agent.model });

  if (result.exitCode !== 0) {
    throw new TaskError(
      `review-work: agent exited with code ${result.exitCode}`,
    );
  }

  return extractPRReviewOutput(result.stdout);
}

/**
 * Run review file-by-file for large diffs.
 * Each file reviewed independently, then results merged.
 */
async function runFileByFileReview(
  diff: string,
  spec?: { title: string; content: string },
): Promise<PRReviewOutput> {
  const agents = getAgents();
  const agent = agents.find((a) => a.role === "reviewer");
  if (!agent) {
    throw new TaskError("review-work: no agent with role 'reviewer' found in config");
  }

  const fileDiffs = splitDiffByFile(diff);
  const reviews: PRReviewOutput[] = [];

  console.log();
  const progressBar = new SingleBar({
    format: "Reviewing {bar} {percentage}% | {value}/{total} files | {file}",
    barCompleteChar: "█",
    barIncompleteChar: "░",
    hideCursor: true,
  }, Presets.shades_classic);

  progressBar.start(fileDiffs.length, 0, { file: "" });

  for (let i = 0; i < fileDiffs.length; i++) {
    const fileDiff = fileDiffs[i];
    progressBar.update(i, { file: fileDiff.file });

    const prompt = buildReviewPrompt(agent.systemPrompt, fileDiff.diff, spec);
    const result = await spawnAgent("pr-review", prompt, {
      quiet: true,
      provider: agent.provider,
      model: agent.model
    });

    if (result.exitCode !== 0) {
      progressBar.stop();
      throw new TaskError(
        `review-work: agent exited with code ${result.exitCode} while reviewing ${fileDiff.file}`,
      );
    }

    reviews.push(extractPRReviewOutput(result.stdout));
    progressBar.update(i + 1, { file: fileDiff.file });
  }

  progressBar.stop();
  console.log();

  return mergePRReviews(reviews);
}

export async function reviewWorkCommand(
  options: ReviewWorkOptions,
): Promise<void> {
  return withTelemetry('review-work', async () => {
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

        // Run review via agent with git diff
        const diff = await getGitDiff(defaultBranch);
        if (!diff.trim()) {
          console.log(chalk.yellow("No changes found against"), chalk.bold(defaultBranch));
          return;
        }

        // Check if diff is too large
        const tokens = estimateTokens(diff);
        const isTooLarge = tokens > MAX_DIFF_TOKENS;

        let output: PRReviewOutput;

        if (isTooLarge) {
          const fileDiffs = splitDiffByFile(diff);
          const costMultiplier = estimateCostMultiplier(fileDiffs.length);

          console.log(chalk.yellow.bold("⚠ Large diff detected"));
          console.log(chalk.gray(`  Estimated tokens: ${tokens.toLocaleString()} (threshold: ${MAX_DIFF_TOKENS.toLocaleString()})`));
          console.log(chalk.gray(`  Files changed: ${fileDiffs.length}`));
          console.log();
          console.log(chalk.yellow("Files to review:"));
          console.log(formatFileList(fileDiffs.map((f) => f.file)));
          console.log();
          console.log(chalk.yellow(`File-by-file review will make ~${fileDiffs.length} API calls.`));
          console.log(chalk.yellow(`Estimated cost increase: ${costMultiplier.toFixed(1)}x vs single review.`));
          console.log();

          const proceed = await confirm({
            message: "Proceed with file-by-file review?",
            default: true,
          });

          if (!proceed) {
            console.log(chalk.gray("Review cancelled."));
            return;
          }

          output = await runFileByFileReview(diff, spec);
        } else {
          const reviewStatus = createLiveStatus("Running review...");
          output = await runAgentReview(diff, spec, reviewStatus.onActivity);
          reviewStatus.succeed(chalk.green("Review complete"));
        }

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

      const diff = await getGitDiff(defaultBranch);
      if (!diff.trim()) {
        spinner.info(chalk.yellow("No changes found against ") + chalk.bold(defaultBranch));
        return;
      }

      if (mrIid !== null) {
        spinner.succeed(chalk.green(`Found MR !${mrIid}`));
      } else {
        spinner.info(chalk.yellow("No open MR found for this branch"));
      }

      console.log();

      // Check if diff is too large
      const tokens = estimateTokens(diff);
      const isTooLarge = tokens > MAX_DIFF_TOKENS;

      let output: PRReviewOutput;

      if (isTooLarge) {
        const fileDiffs = splitDiffByFile(diff);
        const costMultiplier = estimateCostMultiplier(fileDiffs.length);

        console.log(chalk.yellow.bold("⚠ Large diff detected"));
        console.log(chalk.gray(`  Estimated tokens: ${tokens.toLocaleString()} (threshold: ${MAX_DIFF_TOKENS.toLocaleString()})`));
        console.log(chalk.gray(`  Files changed: ${fileDiffs.length}`));
        console.log();
        console.log(chalk.yellow("Files to review:"));
        console.log(formatFileList(fileDiffs.map((f) => f.file)));
        console.log();
        console.log(chalk.yellow(`File-by-file review will make ~${fileDiffs.length} API calls.`));
        console.log(chalk.yellow(`Estimated cost increase: ${costMultiplier.toFixed(1)}x vs single review.`));
        console.log();

        const proceed = await confirm({
          message: "Proceed with file-by-file review?",
          default: true,
        });

        if (!proceed) {
          console.log(chalk.gray("Review cancelled."));
          return;
        }

        output = await runFileByFileReview(diff, spec);
      } else {
        const glReviewStatus = createLiveStatus("Running review...");
        output = await runAgentReview(diff, spec, glReviewStatus.onActivity);
        glReviewStatus.succeed(chalk.green("Review complete"));
      }

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
  });
}
