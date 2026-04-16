import { spawnAgent, type AgentSpawnOptions } from "./implement.js";
import { TaskError } from "./task.js";
import type { GateResult, TaskContext } from "./task.js";

/* ------------------------------------------------------------------ */
/*  Shared gate utility                                               */
/* ------------------------------------------------------------------ */

export async function runGate(
  agentName: string,
  prompt: string,
  options?: AgentSpawnOptions,
): Promise<GateResult> {
  const result = await spawnAgent(agentName, prompt, options);

  const hasPass = result.stdout.includes("GATE_RESULT:PASS");
  const hasFail = result.stdout.includes("GATE_RESULT:FAIL");

  const passed = result.exitCode === 0 && hasPass && !hasFail;

  return { passed, output: result.stdout };
}

/* ------------------------------------------------------------------ */
/*  Unit-tests gate                                                   */
/* ------------------------------------------------------------------ */

function buildUnitTestGatePrompt(context: TaskContext): string {
  const files = context.implement!.dev!.files;
  const filesList = files.length > 0
    ? files.map((f) => `- ${f}`).join("\n")
    : "(no new files — dev agent found work already complete)";

  return `You are in **test-execution mode**.

## Rules
- DO NOT write or modify any source code or test code.
- Your ONLY job is to find the project's test runner and execute the unit tests.

## Files written by the Dev agent
${filesList}

## Instructions
1. Identify the test runner used by this project (e.g. vitest, jest, mocha, npm test).
2. Run the unit tests. Stream the full output.
3. After the test run completes, emit exactly one of the following as the **last line** of your output:
   - \`GATE_RESULT:PASS\` — if ALL unit tests passed
   - \`GATE_RESULT:FAIL\` — if ANY unit test failed or the runner returned a non-zero exit code

Do NOT emit both markers. Do NOT omit the marker.`;
}

export async function runUnitTestGate(
  context: TaskContext,
  options?: AgentSpawnOptions,
): Promise<GateResult> {
  if (!context.implement) {
    throw new TaskError(
      "gate:unit-tests: implement stage has not run",
    );
  }

  if (!context.implement.dev) {
    throw new TaskError(
      "gate:unit-tests: dev output is null — dev agent failed during implement",
    );
  }

  const prompt = buildUnitTestGatePrompt(context);
  return runGate("gate:unit-tests", prompt, options);
}

/* ------------------------------------------------------------------ */
/*  Functional-tests gate                                             */
/* ------------------------------------------------------------------ */

function buildFunctionalTestGatePrompt(context: TaskContext): string {
  const testFiles = context.implement!.qe!.testFiles;
  const filesList = testFiles.length > 0
    ? testFiles.map((f) => `- ${f}`).join("\n")
    : "(no new test files — qe agent found tests already complete)";

  return `You are in **test-execution mode**.

## Rules
- DO NOT write or modify any source code or test code.
- Your ONLY job is to find the project's test runner and execute the functional tests.

## Test files written by the QE agent
${filesList}

## Instructions
1. Identify the test runner used by this project (e.g. vitest, jest, mocha, npm test).
2. Run the functional tests${testFiles.length > 0 ? " listed above" : ""}. Stream the full output.
3. After the test run completes, emit exactly one of the following as the **last line** of your output:
   - \`GATE_RESULT:PASS\` — if ALL functional tests passed
   - \`GATE_RESULT:FAIL\` — if ANY functional test failed or the runner returned a non-zero exit code

Do NOT emit both markers. Do NOT omit the marker.`;
}

export async function runFunctionalTestGate(
  context: TaskContext,
  options?: AgentSpawnOptions,
): Promise<GateResult> {
  if (!context.implement) {
    throw new TaskError(
      "gate:functional-tests: implement stage has not run",
    );
  }

  if (!context.implement.qe) {
    throw new TaskError(
      "gate:functional-tests: qe output is null — qe agent failed during implement",
    );
  }

  const prompt = buildFunctionalTestGatePrompt(context);
  return runGate("gate:functional-tests", prompt, options);
}
