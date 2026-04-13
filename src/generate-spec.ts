import { execFile } from "node:child_process";
import { builtinAgents } from "./agents.js";
import { TaskError } from "./task.js";

function buildGeneratePrompt(description: string): string {
  const plannerAgent = builtinAgents.find((a) => a.name === "planner");
  const systemPrompt = plannerAgent?.systemPrompt ?? "";

  return `${systemPrompt}

---

You are generating a full markdown spec from a short description. Output ONLY the raw markdown content (no fences, no wrapper). The spec must include:

- A top-level heading (\`# Title\`)
- An **Overview** section explaining the feature
- A **Requirements** section with a bulleted list
- An **Acceptance Criteria** section with a bulleted list
- A **Constraints** section noting any technical or process constraints

Be specific and actionable. Expand the description into concrete requirements that a development team could implement without further clarification.

---

**Description:** ${description}`;
}

function spawnClaude(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "claude",
      ["-p", prompt, "--output-format", "json"],
      { timeout: 120_000, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(
            new TaskError(
              `generate-spec: claude CLI failed — ${error.message}`,
            ),
          );
          return;
        }
        resolve(stdout);
      },
    );
  });
}

export async function generateSpec(description: string): Promise<string> {
  const prompt = buildGeneratePrompt(description);
  const raw = await spawnClaude(prompt);

  let cliOutput: unknown;
  try {
    cliOutput = JSON.parse(raw);
  } catch {
    throw new TaskError(
      "generate-spec: failed to parse claude CLI output as JSON",
    );
  }

  const result = (cliOutput as { result?: unknown }).result;
  if (result === undefined) {
    throw new TaskError(
      "generate-spec: claude CLI output missing 'result' field",
    );
  }

  if (typeof result !== "string") {
    throw new TaskError(
      "generate-spec: expected 'result' to be a markdown string",
    );
  }

  return result;
}
