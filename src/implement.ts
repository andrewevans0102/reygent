import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { builtinAgents } from "./agents.js";
import type { SpecPayload } from "./spec.js";
import type {
  PlannerOutput,
  DevOutput,
  QEOutput,
  ImplementOutput,
} from "./task.js";
import { TaskError } from "./task.js";

const AGENT_TIMEOUT_MS = 5 * 60 * 1000;

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

interface SpawnResult {
  stdout: string;
  exitCode: number;
}

function spawnAgent(name: string, prompt: string): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", ["-p", prompt, "--output-format", "text"], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    const chunks: string[] = [];

    const timeout = setTimeout(() => {
      child.kill();
      reject(new TaskError(`${name}: timed out after ${AGENT_TIMEOUT_MS}ms`));
    }, AGENT_TIMEOUT_MS);

    const stdoutRL = createInterface({ input: child.stdout! });
    stdoutRL.on("line", (line) => {
      console.log(`[${name}] ${line}`);
      chunks.push(line);
    });

    const stderrRL = createInterface({ input: child.stderr! });
    stderrRL.on("line", (line) => {
      console.error(`[${name}] ${line}`);
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(new TaskError(`${name}: failed to spawn — ${err.message}`));
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ stdout: chunks.join("\n"), exitCode: code ?? 1 });
    });
  });
}

function extractDevOutput(stdout: string): DevOutput {
  const match = stdout.match(/\{\s*"files"\s*:\s*\[.*?\]\s*\}/s);
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
  const match = stdout.match(/\{\s*"testFiles"\s*:\s*\[.*?\]\s*\}/s);
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
): Promise<ImplementOutput> {
  const devAgent = builtinAgents.find((a) => a.name === "dev");
  const qeAgent = builtinAgents.find((a) => a.name === "qe");

  if (!devAgent || !qeAgent) {
    throw new TaskError("Implement: missing dev or qe agent config");
  }

  const devPrompt = buildDevPrompt(devAgent.systemPrompt, spec, plan);
  const qePrompt = buildQEPrompt(qeAgent.systemPrompt, spec, plan);

  const [devResult, qeResult] = await Promise.allSettled([
    spawnAgent("dev", devPrompt),
    spawnAgent("qe", qePrompt),
  ]);

  let dev: DevOutput | null = null;
  let qe: QEOutput | null = null;

  if (devResult.status === "fulfilled" && devResult.value.exitCode === 0) {
    dev = extractDevOutput(devResult.value.stdout);
  } else {
    const reason =
      devResult.status === "rejected"
        ? devResult.reason
        : `exit code ${devResult.value.exitCode}`;
    console.error(`[dev] failed: ${reason}`);
  }

  if (qeResult.status === "fulfilled" && qeResult.value.exitCode === 0) {
    qe = extractQEOutput(qeResult.value.stdout);
  } else {
    const reason =
      qeResult.status === "rejected"
        ? qeResult.reason
        : `exit code ${qeResult.value.exitCode}`;
    console.error(`[qe] failed: ${reason}`);
  }

  if (dev === null && qe === null) {
    throw new TaskError("Implement: both dev and qe agents failed");
  }

  return { dev, qe };
}
