import { builtinAgents } from "./agents.js";
import { spawnAgentStream } from "./spawn.js";
import type { SpecPayload } from "./spec.js";
import type { PlannerOutput, PlannerClarification, PlannerResult } from "./task.js";
import { TaskError } from "./task.js";

export function extractJSON(text: string): string {
  const trimmed = text.trim();

  // Try exact match: entire string is a fenced block
  const exact = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/);
  if (exact) return exact[1];

  // Try embedded fence: find last ```json ... ``` block in output
  const fences = [...trimmed.matchAll(/```(?:json)?\s*\n([\s\S]*?)\n```/g)];
  if (fences.length > 0) return fences[fences.length - 1][1];

  // Try raw JSON object: find last { ... } block
  const lastBrace = trimmed.lastIndexOf("}");
  if (lastBrace !== -1) {
    // Walk backwards to find matching opening brace
    let depth = 0;
    for (let i = lastBrace; i >= 0; i--) {
      if (trimmed[i] === "}") depth++;
      if (trimmed[i] === "{") depth--;
      if (depth === 0) return trimmed.slice(i, lastBrace + 1);
    }
  }

  return trimmed;
}

function buildPrompt(spec: SpecPayload, previousAnswers?: string): string {
  const plannerAgent = builtinAgents.find((a) => a.name === "planner");
  const systemPrompt = plannerAgent?.systemPrompt ?? "";

  let clarificationContext = "";
  if (previousAnswers) {
    clarificationContext = `

## Previous Clarifications

${previousAnswers}

Use these clarifications to inform your plan.`;
  }

  return `${systemPrompt}

---

Below is the raw spec to analyse. Return ONLY valid JSON matching one of three shapes:

**Valid spec (can create plan):**
\`\`\`json
{ "valid": true, "goals": ["..."], "tasks": ["..."], "constraints": ["..."], "dod": ["..."] }
\`\`\`

**Needs clarification (spec ambiguous or missing design decisions):**
\`\`\`json
{ "valid": false, "needsClarification": true, "questions": ["What auth method?", "Support pagination?"] }
\`\`\`

**Invalid spec (fundamental issues, cannot proceed):**
\`\`\`json
{ "valid": false, "errors": ["..."] }
\`\`\`

IMPORTANT: If spec is ambiguous or missing key design decisions, prefer "needsClarification" over hard failure. Ask specific questions about:
- Authentication/authorization approach
- Data storage/persistence strategy
- API design decisions (REST vs GraphQL, pagination, filtering)
- Error handling patterns
- Scalability/performance requirements
- Integration points with existing systems

Each array must contain at least one non-empty string. Do not include any text outside the JSON object.

---

**Spec title:** ${spec.title}

**Spec content:**
${spec.content}${clarificationContext}`;
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === "string" && item.trim().length > 0)
  );
}

export async function runPlanner(
  spec: SpecPayload,
  previousAnswers?: string,
): Promise<PlannerResult> {
  const prompt = buildPrompt(spec, previousAnswers);
  const { stdout: raw, exitCode } = await spawnAgentStream("planner", prompt, 120_000, { quiet: true });

  if (exitCode !== 0) {
    throw new TaskError(`Planner: claude CLI exited with code ${exitCode}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJSON(raw));
  } catch {
    throw new TaskError("Planner: failed to parse result as JSON");
  }

  const obj = parsed as Record<string, unknown>;

  if (obj.valid === false) {
    // Check if needs clarification
    if (obj.needsClarification === true && Array.isArray(obj.questions)) {
      const questions = (obj.questions as unknown[]).filter(
        (q) => typeof q === "string" && q.trim().length > 0,
      ) as string[];

      if (questions.length > 0) {
        return { needsClarification: true, questions };
      }
    }

    // Hard failure
    const errors = Array.isArray(obj.errors)
      ? (obj.errors as string[]).join("\n  - ")
      : "unknown validation error";
    throw new TaskError(
      `Planner: spec validation failed:\n  - ${errors}`,
    );
  }

  if (obj.valid !== true) {
    throw new TaskError(
      "Planner: unexpected response — missing 'valid' field",
    );
  }

  const { goals, tasks, constraints, dod } = obj;

  if (!isNonEmptyStringArray(goals)) {
    throw new TaskError("Planner: 'goals' must be a non-empty string array");
  }
  if (!isNonEmptyStringArray(tasks)) {
    throw new TaskError("Planner: 'tasks' must be a non-empty string array");
  }
  if (!isNonEmptyStringArray(constraints)) {
    throw new TaskError(
      "Planner: 'constraints' must be a non-empty string array",
    );
  }
  if (!isNonEmptyStringArray(dod)) {
    throw new TaskError("Planner: 'dod' must be a non-empty string array");
  }

  return { goals, tasks, constraints, dod };
}
