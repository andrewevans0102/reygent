import chalk from "chalk";
import { getAgents } from "./config.js";
import { extractJSON } from "./planner.js";
import type { ActivityEvent } from "./providers/types.js";
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
import { getChesstrace } from "./chesstrace/index.js";
import { Events } from "./chesstrace/events.js";

export type { SpawnResult };

/**
 * Extract head and tail of agent output for error display.
 *
 * For long outputs, shows first 150 and last 150 characters to capture
 * both the initial error context and the final failure message.
 * In debug mode, full output is already printed, so this is for quick
 * terminal feedback during normal operation.
 */
function getFailureSummary(stdout: string, maxLen = 300): string {
  const trimmed = stdout.trim();
  if (!trimmed) return "";
  if (trimmed.length <= maxLen) return trimmed;

  // Show head + tail for better context
  const halfLen = Math.floor(maxLen / 2);
  const head = trimmed.slice(0, halfLen);
  const tail = trimmed.slice(-halfLen);
  return `${head}…${tail}`;
}

const AGENT_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Options for spawning agents via spawnAgent() wrapper.
 * This interface mirrors SpawnOptions from spawn.ts and adds semantic clarity
 * for callers in the implement module. Changes to SpawnOptions should be
 * reflected here to maintain compatibility.
 */
export interface AgentSpawnOptions {
  autoApprove?: boolean;
  quiet?: boolean;
  provider?: string;
  model?: string;
  onActivity?: (event: ActivityEvent) => void;
  stage?: string;
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
    } catch (err) {
      // Emit error.parse before falling through
      const chesstrace = getChesstrace();
      if (chesstrace) {
        chesstrace.emit(Events.ERROR_PARSE, {
          agent: "dev",
          expectedFormat: '{ "files": ["..."] }',
          received: match[0].slice(0, 500),
        });
      }
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
    } catch (err) {
      // Emit error.parse before falling through
      const chesstrace = getChesstrace();
      if (chesstrace) {
        chesstrace.emit(Events.ERROR_PARSE, {
          agent: "qe",
          expectedFormat: '{ "testFiles": ["..."] }',
          received: match[0].slice(0, 500),
        });
      }
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
    // Emit error.task before throwing
    const chesstrace = getChesstrace();
    if (chesstrace) {
      chesstrace.emit(Events.ERROR_TASK, {
        type: "TaskError",
        message: "Implement: missing dev or qe agent config",
        stage: options?.stage ?? "implement",
        agent: "implement",
      });
    }
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
        spawnAgent("dev", devPrompt, { ...options, provider: devAgent.provider, model: devAgent.model, stage: "implement" }).then(
          (v) => ({ status: "fulfilled" as const, value: v }),
          (e) => ({ status: "rejected" as const, reason: e }),
        ),
      );
    }
    if (runQE) {
      promises.push(
        spawnAgent("qe", qePrompt, { ...options, provider: qeAgent.provider, model: qeAgent.model, stage: "implement" }).then(
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
          const summary = getFailureSummary(devResult.value.stdout);
          if (summary) console.log(chalk.gray("  ↳"), chalk.gray(summary));
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
          const summary = getFailureSummary(qeResult.value.stdout);
          if (summary) console.log(chalk.gray("  ↳"), chalk.gray(summary));
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
        const devResult = await spawnAgent("dev", devPrompt, { ...options, provider: devAgent.provider, model: devAgent.model, stage: "implement" });
        if (devResult.exitCode === 0) {
          dev = extractDevOutput(devResult.stdout);
        }
        usages.push({ agent: "dev", usage: devResult.usage });
        if (devResult.exitCode !== 0) {
          console.log(chalk.red("dev agent failed:"), `exit code ${devResult.exitCode}`);
          const summary = getFailureSummary(devResult.stdout);
          if (summary) console.log(chalk.gray("  ↳"), chalk.gray(summary));
        }
      } catch (err) {
        console.log(chalk.red("dev agent failed:"), err);
      }
    }

    if (runQE) {
      console.log(chalk.blue("Running qe agent (approve edits as prompted)..."));
      try {
        const qeResult = await spawnAgent("qe", qePrompt, { ...options, provider: qeAgent.provider, model: qeAgent.model, stage: "implement" });
        if (qeResult.exitCode === 0) {
          qe = extractQEOutput(qeResult.stdout);
        }
        usages.push({ agent: "qe", usage: qeResult.usage });
        if (qeResult.exitCode !== 0) {
          console.log(chalk.red("qe agent failed:"), `exit code ${qeResult.exitCode}`);
          const summary = getFailureSummary(qeResult.stdout);
          if (summary) console.log(chalk.gray("  ↳"), chalk.gray(summary));
        }
      } catch (err) {
        console.log(chalk.red("qe agent failed:"), err);
      }
    }
  }

  // Only fail if both requested agents failed
  const chesstrace = getChesstrace();
  if ((runDev && dev === null) && (runQE && qe === null)) {
    // Emit error.task before throwing
    if (chesstrace) {
      chesstrace.emit(Events.ERROR_TASK, {
        type: "TaskError",
        message: "Implement: all requested agents failed",
        stage: options?.stage ?? "implement",
        agent: "implement",
      });
    }
    throw new TaskError("Implement: all requested agents failed");
  }
  if (runDev && !runQE && dev === null) {
    // Emit error.task before throwing
    if (chesstrace) {
      chesstrace.emit(Events.ERROR_TASK, {
        type: "TaskError",
        message: "Implement: dev agent failed",
        stage: options?.stage ?? "implement",
        agent: "dev",
      });
    }
    throw new TaskError("Implement: dev agent failed");
  }
  if (!runDev && runQE && qe === null) {
    // Emit error.task before throwing
    if (chesstrace) {
      chesstrace.emit(Events.ERROR_TASK, {
        type: "TaskError",
        message: "Implement: qe agent failed",
        stage: options?.stage ?? "implement",
        agent: "qe",
      });
    }
    throw new TaskError("Implement: qe agent failed");
  }

  return { implement: { dev, qe }, usages };
}
