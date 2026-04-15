import { execFile } from "node:child_process";
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

export async function assertGhInstalled(): Promise<void> {
  try {
    await exec("gh", ["--version"]);
  } catch {
    throw new TaskError(
      "pr-create: GitHub CLI (gh) is not installed.\n\n" +
        "Install it:\n" +
        "  macOS:  brew install gh\n" +
        "  Linux:  https://github.com/cli/cli/blob/trunk/docs/install_linux.md\n" +
        "  Windows: winget install --id GitHub.cli",
    );
  }
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
  await assertGhInstalled();

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

  // Create PR
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

  // Parse PR URL from last non-empty line
  const prUrl = prOut.trim().split("\n").pop()?.trim() ?? "";
  if (!prUrl.startsWith("https://")) {
    throw new TaskError(`pr-create: unexpected gh output: ${prOut}`);
  }

  const prNumberMatch = prUrl.match(/\/pull\/(\d+)/);
  const prNumber = prNumberMatch ? parseInt(prNumberMatch[1], 10) : 0;

  return { branch, commitMessage, prUrl, prNumber };
}
