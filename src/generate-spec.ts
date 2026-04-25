import { getAgents } from "./config.js";
import { extractJSON } from "./planner.js";
import { spawnAgentStream } from "./spawn.js";
import { TaskError } from "./task.js";

export interface ClarificationResult {
  needsClarification: true;
  questions: string[];
}

export interface ReadyResult {
  ready: true;
}

export type ClarificationResponse = ClarificationResult | ReadyResult;

function buildClarificationPrompt(description: string, previousAnswers?: string): string {
  const agents = getAgents();
  const plannerAgent = agents.find((a) => a.name === "planner");
  const systemPrompt = plannerAgent?.systemPrompt ?? "";

  let answersContext = "";
  if (previousAnswers) {
    answersContext = `

## Previous Clarifications

${previousAnswers}

Consider these answers. If you still have unresolved questions, ask them. Otherwise return ready.`;
  }

  return `${systemPrompt}

---

You are preparing to generate a detailed markdown spec from a short description. Before generating, decide if you need clarifying questions.

Return ONLY valid JSON matching one of two shapes:

**No questions needed (description is clear enough):**
\`\`\`json
{ "ready": true }
\`\`\`

**Need more information:**
\`\`\`json
{ "needsClarification": true, "questions": ["What authentication method?", "Should it support pagination?"] }
\`\`\`

Ask about things like:
- Target users and use cases
- Technical constraints or preferences
- Integration points with existing systems
- Scale and performance requirements
- Authentication/authorization needs
- Error handling expectations

Keep questions specific and actionable (max 5). Do not include any text outside the JSON object.

---

**Description:** ${description}${answersContext}`;
}

function buildGeneratePrompt(description: string, clarificationAnswers?: string): string {
  const agents = getAgents();
  const plannerAgent = agents.find((a) => a.name === "planner");
  const systemPrompt = plannerAgent?.systemPrompt ?? "";

  let answersContext = "";
  if (clarificationAnswers) {
    answersContext = `

## Clarification Answers

${clarificationAnswers}

Use these answers to make the spec more precise and targeted.`;
  }

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

**Description:** ${description}${answersContext}`;
}

export async function runClarification(
  description: string,
  previousAnswers?: string,
): Promise<ClarificationResponse> {
  const prompt = buildClarificationPrompt(description, previousAnswers);
  const { stdout: raw, exitCode } = await spawnAgentStream("generate-spec", prompt, 120_000, { quiet: true });

  if (exitCode !== 0) {
    throw new TaskError(`generate-spec: claude CLI exited with code ${exitCode}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJSON(raw));
  } catch {
    throw new TaskError("generate-spec: failed to parse clarification response as JSON");
  }

  const obj = parsed as Record<string, unknown>;

  if (obj.ready === true) {
    return { ready: true };
  }

  if (obj.needsClarification === true && Array.isArray(obj.questions)) {
    const questions = (obj.questions as unknown[]).filter(
      (q) => typeof q === "string" && q.trim().length > 0,
    ) as string[];

    if (questions.length > 0) {
      return { needsClarification: true, questions };
    }
  }

  // Default to ready if response doesn't match expected shapes
  return { ready: true };
}

export async function generateSpec(description: string, clarificationAnswers?: string): Promise<string> {
  const prompt = buildGeneratePrompt(description, clarificationAnswers);
  const { stdout, exitCode } = await spawnAgentStream("generate-spec", prompt, 120_000);

  if (exitCode !== 0) {
    throw new TaskError(`generate-spec: claude CLI exited with code ${exitCode}`);
  }

  if (!stdout) {
    throw new TaskError("generate-spec: empty result from claude CLI");
  }

  return stdout;
}
