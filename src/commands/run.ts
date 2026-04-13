import { runUnitTestGate, runFunctionalTestGate } from "../gate.js";
import { runImplement } from "../implement.js";
import { runPlanner } from "../planner.js";
import { runSecurityReview, formatFindings } from "../security-review.js";
import { loadSpec, SpecError } from "../spec.js";
import { PIPELINE, TaskError } from "../task.js";
import type { Severity, StageResult, TaskContext } from "../task.js";

const VALID_SEVERITIES = new Set<string>(["CRITICAL", "HIGH", "MEDIUM", "LOW"]);

interface RunOptions {
  spec: string;
  dryRun: boolean;
  securityThreshold: string;
}

export async function runCommand(options: RunOptions): Promise<void> {
  try {
    const spec = await loadSpec(options.spec);

    if (options.dryRun) {
      const output = {
        spec: { source: spec.source, title: spec.title },
        stages: PIPELINE.map((s) => ({
          name: s.name,
          description: s.description,
          execution: s.execution,
        })),
      };
      console.log(JSON.stringify(output, null, 2));
      return;
    }

    const threshold = options.securityThreshold.toUpperCase();
    if (!VALID_SEVERITIES.has(threshold)) {
      console.error(
        `Invalid --security-threshold "${options.securityThreshold}". Must be one of: CRITICAL, HIGH, MEDIUM, LOW`,
      );
      process.exit(1);
    }

    const context: TaskContext = { spec, results: [] };

    for (const stage of PIPELINE) {
      if (stage.name === "plan") {
        console.log(`[${stage.name}] running planner...`);
        const plan = await runPlanner(context.spec);
        context.plan = plan;

        console.log(`[${stage.name}] goals:`);
        for (const g of plan.goals) console.log(`  - ${g}`);
        console.log(`[${stage.name}] tasks:`);
        for (const t of plan.tasks) console.log(`  - ${t}`);
        console.log(`[${stage.name}] constraints:`);
        for (const c of plan.constraints) console.log(`  - ${c}`);
        console.log(`[${stage.name}] definition of done:`);
        for (const d of plan.dod) console.log(`  - ${d}`);

        context.results.push({
          stage: stage.name,
          success: true,
          output: JSON.stringify(plan),
        });
        continue;
      }

      if (stage.name === "implement") {
        if (!context.plan) {
          throw new TaskError("Implement: plan stage must run before implement");
        }

        console.log(`[${stage.name}] spawning dev and qe agents...`);
        const impl = await runImplement(context.spec, context.plan);
        context.implement = impl;

        const devSuccess = impl.dev !== null;
        const qeSuccess = impl.qe !== null;

        if (impl.dev) {
          console.log(`[${stage.name}] dev files: ${impl.dev.files.join(", ") || "(none)"}`);
        }
        if (impl.qe) {
          console.log(`[${stage.name}] qe test files: ${impl.qe.testFiles.join(", ") || "(none)"}`);
        }

        context.results.push({
          stage: stage.name,
          success: devSuccess && qeSuccess,
          output: JSON.stringify(impl),
        });
        continue;
      }

      if (stage.name === "gate-unit-tests") {
        if (!context.implement) {
          throw new TaskError("gate-unit-tests: implement stage must run first");
        }

        console.log(`[gate-unit-tests] running unit tests...`);
        const gateResult = await runUnitTestGate(context);

        if (!context.gates) context.gates = {};
        context.gates.unitTests = gateResult;

        if (gateResult.passed) {
          console.log(`[gate:unit-tests] PASSED`);
          context.results.push({
            stage: stage.name,
            success: true,
            output: gateResult.output,
          });
          continue;
        }

        console.log(`[gate:unit-tests] FAILED`);
        context.results.push({
          stage: stage.name,
          success: false,
          output: gateResult.output,
        });
        process.exit(1);
      }

      if (stage.name === "gate-functional-tests") {
        if (!context.implement) {
          throw new TaskError("gate-functional-tests: implement stage must run first");
        }

        console.log(`[gate-functional-tests] running functional tests...`);
        const gateResult = await runFunctionalTestGate(context);

        if (!context.gates) context.gates = {};
        context.gates.functionalTests = gateResult;

        if (gateResult.passed) {
          console.log(`[gate:functional-tests] PASSED`);
          context.results.push({
            stage: stage.name,
            success: true,
            output: gateResult.output,
          });
          continue;
        }

        console.log(gateResult.output);
        console.log(`[gate:functional-tests] FAILED`);
        context.results.push({
          stage: stage.name,
          success: false,
          output: gateResult.output,
        });
        process.exit(1);
      }

      if (stage.name === "security-review") {
        if (!context.implement) {
          throw new TaskError("security-review: implement stage must run first");
        }

        console.log(`[security-review] running security review...`);
        const { output, passed } = await runSecurityReview(
          context,
          threshold as Severity,
        );
        context.securityReview = output;

        console.log(
          `[security-review] ${output.findings.length} finding(s):`,
        );
        console.log(formatFindings(output.findings, threshold as Severity));

        if (passed) {
          console.log(`[security-review] PASSED`);
          context.results.push({
            stage: stage.name,
            success: true,
            output: JSON.stringify(output),
          });
          continue;
        }

        console.log(`[security-review] FAILED`);
        context.results.push({
          stage: stage.name,
          success: false,
          output: JSON.stringify(output),
        });
        process.exit(1);
      }

      const result: StageResult = {
        stage: stage.name,
        success: true,
        output: "skipped",
      };
      console.log(`[${stage.name}] skipped`);
      context.results.push(result);
    }
  } catch (err) {
    if (err instanceof SpecError || err instanceof TaskError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}
