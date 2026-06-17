import { getAgents } from "./config.js";
import { isDebug } from "./debug.js";
import { extractJSON, repairJSON } from "./planner.js";
import type { ActivityEvent } from "./providers/types.js";
import { spawnAgentStream, formatExitDetail } from "./spawn.js";
import { TaskError } from "./task.js";
import { getChesstrace } from "./chesstrace/index.js";
import { Events } from "./chesstrace/events.js";
import { emitErrorTask } from "./telemetry-helpers.js";

export interface ClarificationResult {
  needsClarification: true;
  questions: string[];
}

export interface ReadyResult {
  ready: true;
}

export type ClarificationResponse = ClarificationResult | ReadyResult;

export type DetailLevel = 1 | 2 | 3 | 4 | 5;

export const DEFAULT_DETAIL_LEVEL: DetailLevel = 3;

export function isValidDetailLevel(value: number): value is DetailLevel {
  return Number.isInteger(value) && value >= 1 && value <= 5;
}

interface DetailSpec {
  guidance: string;
  sections: string;
}

function detailSpecFor(level: DetailLevel): DetailSpec {
  switch (level) {
    case 1:
      return {
        guidance:
          "Keep the spec brief and high-level. Cover only the broadest requirements — a few sentences per section, no implementation details, no edge cases. Aim for a one-page outline a stakeholder could skim.",
        sections: `- A top-level heading (\`# Title\`)
- An **Overview** section (2-3 sentences)
- A **Requirements** section with 3-5 high-level bullets`,
      };
    case 2:
      return {
        guidance:
          "Keep the spec focused and concise. Cover the main requirements with light acceptance criteria. Avoid implementation details.",
        sections: `- A top-level heading (\`# Title\`)
- An **Overview** section explaining the feature
- A **Requirements** section with a bulleted list
- An **Acceptance Criteria** section with 3-5 bullets`,
      };
    case 3:
      return {
        guidance:
          "Be specific and actionable. Expand the description into concrete requirements that a development team could implement without further clarification.",
        sections: `- A top-level heading (\`# Title\`)
- An **Overview** section explaining the feature
- A **Requirements** section with a bulleted list
- An **Acceptance Criteria** section with a bulleted list
- A **Constraints** section noting any technical or process constraints`,
      };
    case 4:
      return {
        guidance:
          "Be thorough and precise. Expand each requirement with concrete details, enumerate acceptance criteria for both happy paths and common edge cases, and call out non-functional requirements (performance, security, observability) where relevant.",
        sections: `- A top-level heading (\`# Title\`)
- An **Overview** section explaining the feature and its motivation
- A **Requirements** section with a detailed bulleted list (group by capability if helpful)
- An **Acceptance Criteria** section covering happy paths and key edge cases
- A **Non-Functional Requirements** section (performance, security, observability, etc.)
- A **Constraints** section noting any technical or process constraints`,
      };
    case 5:
      return {
        guidance:
          "Be exhaustive. Cover every requirement in depth, enumerate acceptance criteria for happy paths, edge cases, and failure modes, document non-functional requirements, and include implementation hints (suggested data models, API shapes, integration points). The spec should leave a development team with no open questions.",
        sections: `- A top-level heading (\`# Title\`)
- An **Overview** section explaining the feature, motivation, and target users
- A **Requirements** section with a detailed bulleted list, grouped by capability
- An **Acceptance Criteria** section covering happy paths, edge cases, and failure modes
- A **Non-Functional Requirements** section (performance, security, observability, accessibility)
- An **Implementation Notes** section with suggested data models, API shapes, and integration points
- A **Constraints** section noting any technical or process constraints
- An **Open Questions** section (or "None" if fully resolved)`,
      };
  }
}

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

function buildGeneratePrompt(
  description: string,
  clarificationAnswers?: string,
  detail: DetailLevel = DEFAULT_DETAIL_LEVEL,
): string {
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

  const { guidance, sections } = detailSpecFor(detail);

  return `${systemPrompt}

---

You are generating a markdown spec from a short description at detail level ${detail} of 5 (1 = broadest, 5 = most exhaustive). Output ONLY the raw markdown content (no fences, no wrapper). The spec must include:

${sections}

${guidance}

---

**Description:** ${description}${answersContext}`;
}

export async function runClarification(
  description: string,
  previousAnswers?: string,
  onActivity?: (event: ActivityEvent) => void,
): Promise<ClarificationResponse> {
  const agents = getAgents();
  const plannerAgent = agents.find((a) => a.name === "planner");
  const prompt = buildClarificationPrompt(description, previousAnswers);
  const clarifyResult = await spawnAgentStream("generate-spec", prompt, 120_000, { quiet: true, onActivity });
  const { stdout: raw, exitCode, errorMessage, apiErrorStatus } = clarifyResult;

  if (exitCode !== 0) {
    const detail = formatExitDetail(clarifyResult, plannerAgent?.model);
    emitErrorTask(
      `generate-spec: agent exited with code ${exitCode}${detail}`,
      "clarification",
      { agent: "generate-spec", errorMessage, apiErrorStatus },
    );
    throw new TaskError(`generate-spec: agent exited with code ${exitCode}${detail}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(repairJSON(extractJSON(raw)));
  } catch {
    throw new TaskError("generate-spec: failed to parse clarification response as JSON");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    if (isDebug()) {
      console.error("Clarification response malformed (not an object), falling back to ready. Raw:", raw);
    }
    return { ready: true };
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
  if (isDebug()) {
    console.error("Clarification response didn't match expected shape, falling back to ready. Parsed:", parsed);
  }
  return { ready: true };
}

export async function generateSpec(
  description: string,
  clarificationAnswers?: string,
  onActivity?: (event: ActivityEvent) => void,
  detail: DetailLevel = DEFAULT_DETAIL_LEVEL,
): Promise<string> {
  const agents = getAgents();
  const plannerAgent = agents.find((a) => a.name === "planner");
  const prompt = buildGeneratePrompt(description, clarificationAnswers, detail);
  const specResult = await spawnAgentStream("generate-spec", prompt, 120_000, { onActivity });
  const { stdout, exitCode, errorMessage, apiErrorStatus } = specResult;

  if (exitCode !== 0) {
    const detail = formatExitDetail(specResult, plannerAgent?.model);
    emitErrorTask(
      `generate-spec: agent exited with code ${exitCode}${detail}`,
      "generate",
      { agent: "generate-spec", errorMessage, apiErrorStatus },
    );
    throw new TaskError(`generate-spec: agent exited with code ${exitCode}${detail}`);
  }

  if (!stdout) {
    throw new TaskError("generate-spec: empty result from agent");
  }

  return stdout;
}
