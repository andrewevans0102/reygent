import { spawnAgent } from "./implement.js";
import { TaskError } from "./task.js";
import type { GateResult, TaskContext } from "./task.js";

function buildUnitTestGatePrompt(context: TaskContext): string {
  const files = context.implement!.dev!.files;

  return `You are in **test-execution mode**.

## Rules
- DO NOT write or modify any source code or test code.
- Your ONLY job is to find the project's test runner and execute the unit tests.

## Files written by the Dev agent
${files.map((f) => `- ${f}`).join("\n")}

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

  if (context.implement.dev.files.length === 0) {
    throw new TaskError(
      "gate:unit-tests: dev agent produced zero files — nothing to test",
    );
  }

  const prompt = buildUnitTestGatePrompt(context);
  const result = await spawnAgent("gate:unit-tests", prompt);

  const hasPass = result.stdout.includes("GATE_RESULT:PASS");
  const hasFail = result.stdout.includes("GATE_RESULT:FAIL");

  const passed =
    result.exitCode === 0 && hasPass && !hasFail;

  return { passed, output: result.stdout };
}
