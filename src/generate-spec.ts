import { builtinAgents } from "./agents.js";
import { spawnAgentStream } from "./spawn.js";
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

export async function generateSpec(description: string): Promise<string> {
  const prompt = buildGeneratePrompt(description);
  const { stdout, exitCode } = await spawnAgentStream("generate-spec", prompt, 120_000);

  if (exitCode !== 0) {
    throw new TaskError(`generate-spec: claude CLI exited with code ${exitCode}`);
  }

  if (!stdout) {
    throw new TaskError("generate-spec: empty result from claude CLI");
  }

  return stdout;
}
