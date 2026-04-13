import { execFile } from "node:child_process";
import { builtinAgents } from "./agents.js";
import type { SpecPayload } from "./spec.js";
import type { PlannerOutput } from "./task.js";
import { TaskError } from "./task.js";

function buildPrompt(spec: SpecPayload): string {
  const plannerAgent = builtinAgents.find((a) => a.name === "planner");
  const systemPrompt = plannerAgent?.systemPrompt ?? "";

  return `${systemPrompt}

---

Below is the raw spec to analyse. Return ONLY valid JSON matching one of two shapes:

**Valid spec:**
\`\`\`json
{ "valid": true, "goals": ["..."], "tasks": ["..."], "constraints": ["..."], "dod": ["..."] }
\`\`\`

**Invalid spec:**
\`\`\`json
{ "valid": false, "errors": ["..."] }
\`\`\`

Each array in the valid shape must contain at least one non-empty string. Do not include any text outside the JSON object.

---

**Spec title:** ${spec.title}

**Spec content:**
${spec.content}`;
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
              `Planner: claude CLI failed — ${error.message}`,
            ),
          );
          return;
        }
        resolve(stdout);
      },
    );
  });
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === "string" && item.trim().length > 0)
  );
}

export async function runPlanner(spec: SpecPayload): Promise<PlannerOutput> {
  const prompt = buildPrompt(spec);
  const raw = await spawnClaude(prompt);

  let cliOutput: unknown;
  try {
    cliOutput = JSON.parse(raw);
  } catch {
    throw new TaskError("Planner: failed to parse claude CLI output as JSON");
  }

  const result = (cliOutput as { result?: unknown }).result;
  if (result === undefined) {
    throw new TaskError(
      "Planner: claude CLI output missing 'result' field",
    );
  }

  let parsed: unknown;
  if (typeof result === "string") {
    try {
      parsed = JSON.parse(result);
    } catch {
      throw new TaskError(
        "Planner: failed to parse 'result' field as JSON",
      );
    }
  } else {
    parsed = result;
  }

  const obj = parsed as Record<string, unknown>;

  if (obj.valid === false) {
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
