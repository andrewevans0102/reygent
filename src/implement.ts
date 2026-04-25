import chalk from "chalk";
import { getAgents } from "./config.js";
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
import type { UsageInfo } from "./usage.js";

export type { SpawnResult };

const AGENT_TIMEOUT_MS = 15 * 60 * 1000;

export interface AgentSpawnOptions {
  autoApprove?: boolean;
  quiet?: boolean;
}

export interface FailureContext {
  gateName: string;
  testOutput: string;
  attempt: number;
  maxAttempts: number;
}

export interface RetryOptions {
  failureContext?: FailureContext;
  agentsToRun?: Array<"dev" | "qe">;
}

export function spawnAgent(
  name: string,
  prompt: string,
  options?: AgentSpawnOptions,
): Promise<SpawnResult> {
  return spawnAgentStream(name, prompt, AGENT_TIMEOUT_MS, options);
}

function buildRetrySection(failureContext: FailureContext): string {
  return `

---

## RETRY (attempt ${failureContext.attempt}/${failureContext.maxAttempts})

The previous implementation failed the **${failureContext.gateName}** gate. Review the test output below, identify what went wrong, and fix the issues.

**Test output:**
\`\`\`
${failureContext.testOutput}
\`\`\`

Focus on fixing the failures above. Do not rewrite code that already works.`;
}

function buildDevPrompt(
  systemPrompt: string,
  spec: SpecPayload,
  plan: PlannerOutput,
  failureContext?: FailureContext,
): string {
  let prompt = `${systemPrompt}

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

  if (failureContext) {
    prompt += buildRetrySection(failureContext);
  }

  return prompt;
}

function buildQEPrompt(
  systemPrompt: string,
  spec: SpecPayload,
  plan: PlannerOutput,
  failureContext?: FailureContext,
): string {
  let prompt = `${systemPrompt}

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

  if (failureContext) {
    prompt += buildRetrySection(failureContext);
  }

  return prompt;
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

export interface ImplementResult {
  implement: ImplementOutput;
  usages: Array<{ agent: string; usage?: UsageInfo }>;
}

export async function runImplement(
  spec: SpecPayload,
  plan: PlannerOutput,
  options?: AgentSpawnOptions,
  retryOptions?: RetryOptions,
): Promise<ImplementResult> {
  const agents = getAgents();
  const devAgent = agents.find((a) => a.name === "dev");
  const qeAgent = agents.find((a) => a.name === "qe");

  if (!devAgent || !qeAgent) {
    throw new TaskError("Implement: missing dev or qe agent config");
  }

  const agentsToRun = retryOptions?.agentsToRun ?? ["dev", "qe"];
  const failureContext = retryOptions?.failureContext;

  const runDev = agentsToRun.includes("dev");
  const runQE = agentsToRun.includes("qe");

  const devPrompt = runDev
    ? buildDevPrompt(devAgent.systemPrompt, spec, plan, failureContext)
    : "";
  const qePrompt = runQE
    ? buildQEPrompt(qeAgent.systemPrompt, spec, plan, failureContext)
    : "";

  let dev: DevOutput | null = null;
  let qe: QEOutput | null = null;
  const usages: Array<{ agent: string; usage?: UsageInfo }> = [];

  if (options?.autoApprove) {
    // Parallel: no stdin needed
    const promises: Promise<PromiseSettledResult<SpawnResult>>[] = [];

    if (runDev) {
      promises.push(
        spawnAgent("dev", devPrompt, options).then(
          (v) => ({ status: "fulfilled" as const, value: v }),
          (e) => ({ status: "rejected" as const, reason: e }),
        ),
      );
    }
    if (runQE) {
      promises.push(
        spawnAgent("qe", qePrompt, options).then(
          (v) => ({ status: "fulfilled" as const, value: v }),
          (e) => ({ status: "rejected" as const, reason: e }),
        ),
      );
    }

    const results = await Promise.all(promises);
    let idx = 0;

    if (runDev) {
      const devResult = results[idx++];
      if (devResult.status === "fulfilled") {
        usages.push({ agent: "dev", usage: devResult.value.usage });
        if (devResult.value.exitCode === 0) {
          dev = extractDevOutput(devResult.value.stdout);
        } else {
          console.log(chalk.red("dev agent failed:"), `exit code ${devResult.value.exitCode}`);
        }
      } else {
        console.log(chalk.red("dev agent failed:"), devResult.reason);
      }
    }

    if (runQE) {
      const qeResult = results[idx++];
      if (qeResult.status === "fulfilled") {
        usages.push({ agent: "qe", usage: qeResult.value.usage });
        if (qeResult.value.exitCode === 0) {
          qe = extractQEOutput(qeResult.value.stdout);
        } else {
          console.log(chalk.red("qe agent failed:"), `exit code ${qeResult.value.exitCode}`);
        }
      } else {
        console.log(chalk.red("qe agent failed:"), qeResult.reason);
      }
    }
  } else {
    // Sequential: stdin inherited so user can approve each edit
    if (runDev) {
      console.log(chalk.blue("Running dev agent (approve edits as prompted)..."));
      try {
        const devResult = await spawnAgent("dev", devPrompt, options);
        if (devResult.exitCode === 0) {
          dev = extractDevOutput(devResult.stdout);
        }
        usages.push({ agent: "dev", usage: devResult.usage });
        if (devResult.exitCode !== 0) {
          console.log(chalk.red("dev agent failed:"), `exit code ${devResult.exitCode}`);
        }
      } catch (err) {
        console.log(chalk.red("dev agent failed:"), err);
      }
    }

    if (runQE) {
      console.log(chalk.blue("Running qe agent (approve edits as prompted)..."));
      try {
        const qeResult = await spawnAgent("qe", qePrompt, options);
        if (qeResult.exitCode === 0) {
          qe = extractQEOutput(qeResult.stdout);
        }
        usages.push({ agent: "qe", usage: qeResult.usage });
        if (qeResult.exitCode !== 0) {
          console.log(chalk.red("qe agent failed:"), `exit code ${qeResult.exitCode}`);
        }
      } catch (err) {
        console.log(chalk.red("qe agent failed:"), err);
      }
    }
  }

  // Only fail if both requested agents failed
  if ((runDev && dev === null) && (runQE && qe === null)) {
    throw new TaskError("Implement: all requested agents failed");
  }
  if (runDev && !runQE && dev === null) {
    throw new TaskError("Implement: dev agent failed");
  }
  if (!runDev && runQE && qe === null) {
    throw new TaskError("Implement: qe agent failed");
  }

  return { implement: { dev, qe }, usages };
}
