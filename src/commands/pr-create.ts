import { assertGhInstalled } from "../pr-create.js";
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
}

export async function prCreateCommand(options: PRCreateOptions): Promise<void> {
  try {
    loadEnvFile();
    await assertGhInstalled();

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
      sections.push("*Created by [reygent](https://github.com/andrewevans/reygent)*");

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
      console.log(`[pr-create] committing changes...`);
      await exec("git", ["add", "-A"]);
      await exec("git", ["commit", "-m", prTitle]);
    }

    // Push if requested
    if (options.push) {
      // Validate branch name (paranoid check)
      if (!branch || branch.includes(":") || branch.startsWith("-")) {
        throw new TaskError(
          `pr-create: invalid branch name "${branch}"`
        );
      }

      console.log(`[pr-create] pushing ${branch} to origin...`);
      console.log(`[pr-create] exact command: git push -u origin ${branch}`);
      await exec("git", ["push", "-u", "origin", branch], { timeout: 60_000 });
    }

    // Create PR
    console.log(`[pr-create] creating pull request...`);
    const { stdout: prOut } = await exec("gh", [
      "pr",
      "create",
      "--title",
      prTitle,
      "--body",
      prBody,
      "--base",
      baseBranch,
    ]);

    // Parse PR URL
    const prUrl = prOut.trim().split("\n").pop()?.trim() ?? "";
    if (!prUrl.startsWith("https://")) {
      throw new TaskError(`pr-create: unexpected gh output: ${prOut}`);
    }

    const prNumberMatch = prUrl.match(/\/pull\/(\d+)/);
    const prNumber = prNumberMatch ? parseInt(prNumberMatch[1], 10) : 0;

    console.log(`[pr-create] branch: ${branch}`);
    console.log(`[pr-create] base: ${baseBranch}`);
    console.log(`[pr-create] PR #${prNumber}: ${prUrl}`);
  } catch (err) {
    if (err instanceof TaskError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}
