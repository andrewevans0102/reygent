import chalk from "chalk";
import ora from "ora";
import { isDebug } from "../debug.js";
import { createPR, parseRemote, resolveToken } from "../pr-create.js";
import { loadSpec } from "../spec.js";
import type { TaskContext } from "../task.js";
import { TaskError } from "../task.js";
import { execFile } from "node:child_process";
import { loadEnvFile } from "../env.js";

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

async function getDefaultBranch(): Promise<string> {
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
  return baseBranch;
}

interface PRCreateOptions {
  title?: string;
  body?: string;
  spec?: string;
  base?: string;
  push: boolean;
  insecure: boolean;
}

export async function prCreateCommand(options: PRCreateOptions): Promise<void> {
  try {
    loadEnvFile();

    // Resolve remote and credentials first
    const { stdout: remoteUrlEarly } = await exec("git", [
      "remote",
      "get-url",
      "origin",
    ]);
    const remoteEarly = parseRemote(remoteUrlEarly);
    const token = await resolveToken(remoteEarly.host);

    // Get current branch
    const { stdout: currentBranch } = await exec("git", [
      "branch",
      "--show-current",
    ]);
    const branch = currentBranch.trim();

    if (!branch) {
      throw new TaskError("pr-create: not on a branch (detached HEAD)");
    }

    // Get base branch
    const baseBranch = options.base || (await getDefaultBranch());

    // Check if current branch is same as base
    if (branch === baseBranch) {
      throw new TaskError(
        `pr-create: cannot create PR from ${branch} to ${baseBranch} (same branch).\n` +
        `Create a feature branch first: git checkout -b <branch-name>`
      );
    }

    // Check for uncommitted changes
    const { stdout: status } = await exec("git", ["status", "--porcelain"]);
    const hasUncommitted = status.trim().length > 0;

    // Determine PR title and body
    let prTitle: string;
    let prBody: string;

    if (options.spec) {
      // Load spec and build from context
      const spec = await loadSpec(options.spec);
      prTitle = options.title || spec.title;

      const sections: string[] = [];
      sections.push("## Summary");
      sections.push("");
      sections.push(spec.title);
      sections.push("");
      sections.push("---");
      sections.push("*Created by [reygent](https://github.com/andrewevans0102/reygent)*");

      prBody = options.body || sections.join("\n");
    } else if (options.title) {
      // Use provided title/body
      prTitle = options.title;
      prBody = options.body || "";
    } else {
      // Fallback: use last commit message
      const { stdout: lastCommit } = await exec("git", [
        "log",
        "-1",
        "--pretty=%s",
      ]);
      prTitle = lastCommit.trim() || "Update from reygent";
      prBody = options.body || "";
    }

    // Commit uncommitted changes if present
    if (hasUncommitted) {
      const spinner = ora(chalk.blue("committing changes...")).start();
      await exec("git", ["add", "-A"]);
      await exec("git", ["commit", "-m", prTitle]);
      spinner.succeed(chalk.green("Changes committed"));
    }

    // Push if requested
    if (options.push) {
      // Validate branch name (paranoid check)
      if (!branch || branch.includes(":") || branch.startsWith("-")) {
        throw new TaskError(
          `pr-create: invalid branch name "${branch}"`
        );
      }

      const spinner = ora(chalk.blue(`pushing ${branch} to origin...`)).start();
      console.log(chalk.gray(`exact command: git push -u origin ${branch}`));
      await exec("git", ["push", "-u", "origin", branch], { timeout: 60_000 });
      spinner.succeed(chalk.green("Branch pushed"));
    }

    // Create PR via platform API
    const spinner = ora(chalk.blue("creating pull request...")).start();
    const { prUrl, prNumber } = await createPR({
      remote: remoteEarly,
      title: prTitle,
      body: prBody,
      head: branch,
      base: baseBranch,
      token,
      insecure: options.insecure,
    });
    spinner.succeed(chalk.green("PR created"));

    console.log(chalk.gray("branch:"), chalk.cyan(branch));
    console.log(chalk.gray("base:"), chalk.cyan(baseBranch));
    console.log(chalk.gray(`PR #${prNumber}:`), chalk.blue(prUrl));
  } catch (err) {
    if (err instanceof TaskError) {
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
