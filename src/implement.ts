import chalk from "chalk";
import { builtinAgents } from "./agents.js";
import { extractJSON } from "./planner.js";
import { spawnAgentStream } from "./spawn.js";
import type { SpawnResult } from "./spawn.js";
import type { SpecPayload } from "./spec.js";
import type {
  PlannerOutput,
  DevOutput,
  QEOutput,
  ImplementOutput,
} from "./task.js";
import { TaskError } from "./task.js";

export type { SpawnResult };

const AGENT_TIMEOUT_MS = 15 * 60 * 1000;

export interface AgentSpawnOptions {
  autoApprove?: boolean;
}

export function spawnAgent(
  name: string,
  prompt: string,
  options?: AgentSpawnOptions,
): Promise<SpawnResult> {
  return spawnAgentStream(name, prompt, AGENT_TIMEOUT_MS, options);
}

function buildDevPrompt(
  systemPrompt: string,
  spec: SpecPayload,
  plan: PlannerOutput,
): string {
  return `${systemPrompt}

---

## Spec

**Title:** ${spec.title}

${spec.content}

---

## Plan

**Goals:**
${plan.goals.map((g) => `- ${g}`).join("\n")}

**Tasks:**
${plan.tasks.map((t) => `- ${t}`).join("\n")}

**Constraints:**
${plan.constraints.map((c) => `- ${c}`).join("\n")}

**Definition of Done:**
${plan.dod.map((d) => `- ${d}`).join("\n")}

---

When you are finished, output a JSON block with the list of files you created or modified:

\`\`\`json
{ "files": ["src/example.ts", "src/example.test.ts"] }
\`\`\``;
}

function buildQEPrompt(
  systemPrompt: string,
  spec: SpecPayload,
  plan: PlannerOutput,
): string {
  return `${systemPrompt}

---

## Spec

**Title:** ${spec.title}

${spec.content}

---

## Plan

**Goals:**
${plan.goals.map((g) => `- ${g}`).join("\n")}

**Tasks:**
${plan.tasks.map((t) => `- ${t}`).join("\n")}

**Constraints:**
${plan.constraints.map((c) => `- ${c}`).join("\n")}

**Definition of Done:**
${plan.dod.map((d) => `- ${d}`).join("\n")}

---

When you are finished, output a JSON block with the list of test files you created or modified:

\`\`\`json
{ "testFiles": ["tests/example.test.ts"] }
\`\`\``;
}

function extractDevOutput(stdout: string): DevOutput {
  const cleaned = extractJSON(stdout);
  const match = cleaned.match(/\{\s*"files"\s*:\s*\[.*?\]\s*\}/s);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]) as { files: unknown };
      if (Array.isArray(parsed.files)) {
        return { files: parsed.files.filter((f) => typeof f === "string") };
      }
    } catch {
      // fall through
    }
  }
  return { files: [] };
}

function extractQEOutput(stdout: string): QEOutput {
  const cleaned = extractJSON(stdout);
  const match = cleaned.match(/\{\s*"testFiles"\s*:\s*\[.*?\]\s*\}/s);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]) as { testFiles: unknown };
      if (Array.isArray(parsed.testFiles)) {
        return {
          testFiles: parsed.testFiles.filter((f) => typeof f === "string"),
        };
      }
    } catch {
      // fall through
    }
  }
  return { testFiles: [] };
}

export async function runImplement(
  spec: SpecPayload,
  plan: PlannerOutput,
  options?: AgentSpawnOptions,
): Promise<ImplementOutput> {
  const devAgent = builtinAgents.find((a) => a.name === "dev");
  const qeAgent = builtinAgents.find((a) => a.name === "qe");

  if (!devAgent || !qeAgent) {
    throw new TaskError("Implement: missing dev or qe agent config");
  }

  const devPrompt = buildDevPrompt(devAgent.systemPrompt, spec, plan);
  const qePrompt = buildQEPrompt(qeAgent.systemPrompt, spec, plan);

  let dev: DevOutput | null = null;
  let qe: QEOutput | null = null;

  if (options?.autoApprove) {
    // Parallel: no stdin needed
    const [devResult, qeResult] = await Promise.allSettled([
      spawnAgent("dev", devPrompt, options),
      spawnAgent("qe", qePrompt, options),
    ]);

    if (devResult.status === "fulfilled" && devResult.value.exitCode === 0) {
      dev = extractDevOutput(devResult.value.stdout);
    } else {
      const reason =
        devResult.status === "rejected"
          ? devResult.reason
          : `exit code ${devResult.value.exitCode}`;
      console.log(chalk.red("dev agent failed:"), reason);
    }

    if (qeResult.status === "fulfilled" && qeResult.value.exitCode === 0) {
      qe = extractQEOutput(qeResult.value.stdout);
    } else {
      const reason =
        qeResult.status === "rejected"
          ? qeResult.reason
          : `exit code ${qeResult.value.exitCode}`;
      console.log(chalk.red("qe agent failed:"), reason);
    }
  } else {
    // Sequential: stdin inherited so user can approve each edit
    console.log(chalk.blue("Running dev agent (approve edits as prompted)..."));
    try {
      const devResult = await spawnAgent("dev", devPrompt, options);
      if (devResult.exitCode === 0) {
        dev = extractDevOutput(devResult.stdout);
      } else {
        console.log(chalk.red("dev agent failed:"), `exit code ${devResult.exitCode}`);
      }
    } catch (err) {
      console.log(chalk.red("dev agent failed:"), err);
    }

    console.log(chalk.blue("Running qe agent (approve edits as prompted)..."));
    try {
      const qeResult = await spawnAgent("qe", qePrompt, options);
      if (qeResult.exitCode === 0) {
        qe = extractQEOutput(qeResult.stdout);
      } else {
        console.log(chalk.red("qe agent failed:"), `exit code ${qeResult.exitCode}`);
      }
    } catch (err) {
      console.log(chalk.red("qe agent failed:"), err);
    }
  }

  if (dev === null && qe === null) {
    throw new TaskError("Implement: both dev and qe agents failed");
  }

  return { dev, qe };
}
