import { execFile } from "node:child_process";
import { builtinAgents } from "./agents.js";
import { spawnAgent, type AgentSpawnOptions } from "./implement.js";
import { extractJSON } from "./planner.js";
import type { PRReviewComment, PRReviewOutput, TaskContext } from "./task.js";
import { TaskError } from "./task.js";

function buildPRReviewPrompt(
  systemPrompt: string,
  context: TaskContext,
  diff: string,
): string {
  const goals = context.plan?.goals ?? [];
  const tasks = context.plan?.tasks ?? [];

  return `${systemPrompt}

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

## PR Diff

\`\`\`diff
${diff}
\`\`\`

---

## Instructions

1. Review the PR diff above in the context of the spec and planner goals.
2. Check for correctness, potential bugs, style issues, and whether the implementation meets the spec.
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

function getDiff(prNumber: number): Promise<string> {
  return exec("gh", ["pr", "diff", String(prNumber)]);
}

/**
 * Detect PR number from current git branch via GitHub CLI.
 * Returns the PR number or throws if no PR is found.
 */
async function detectPRFromBranch(): Promise<{ prNumber: number; branch: string }> {
  const branch = (await exec("git", ["branch", "--show-current"])).trim();
  if (!branch) {
    throw new TaskError(
      "pr-review: not on a branch — cannot auto-detect PR number",
    );
  }

  let prJson: string;
  try {
    prJson = await exec("gh", ["pr", "view", "--json", "number", "--jq", ".number"]);
  } catch {
    throw new TaskError(
      `pr-review: no open PR found for branch "${branch}". Create a PR first or provide a PR number.`,
    );
  }

  const prNumber = parseInt(prJson.trim(), 10);
  if (isNaN(prNumber) || prNumber <= 0) {
    throw new TaskError(
      `pr-review: could not parse PR number from branch "${branch}"`,
    );
  }

  return { prNumber, branch };
}

export async function runPRReview(
  context: TaskContext,
  options?: AgentSpawnOptions,
): Promise<PRReviewOutput> {
  let prNumber: number;

  if (context.prCreate) {
    prNumber = context.prCreate.prNumber;
  } else {
    console.log("[pr-review] no PR number provided — detecting from current branch...");
    const detected = await detectPRFromBranch();
    prNumber = detected.prNumber;
    console.log(`[pr-review] found PR #${prNumber} on branch "${detected.branch}"`);
  }

  const agent = builtinAgents.find((a) => a.name === "pr-reviewer");
  if (!agent) {
    throw new TaskError("pr-review: missing pr-reviewer agent config");
  }

  const diff = await getDiff(prNumber);
  const prompt = buildPRReviewPrompt(agent.systemPrompt, context, diff);
  const result = await spawnAgent("pr-review", prompt, options);

  if (result.exitCode !== 0) {
    throw new TaskError(
      `pr-review: agent exited with code ${result.exitCode}`,
    );
  }

  return extractPRReviewOutput(result.stdout);
}
