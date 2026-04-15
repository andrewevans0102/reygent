import { createInterface } from "node:readline";
import { runUnitTestGate, runFunctionalTestGate } from "../gate.js";
import { runImplement } from "../implement.js";
import { runPlanner } from "../planner.js";
import { runPRCreate } from "../pr-create.js";
import { runPRReview, formatPRReviewOutput } from "../pr-review.js";
import { runSecurityReview, formatFindings } from "../security-review.js";
import { loadSpec, SpecError } from "../spec.js";
import { PIPELINE, TaskError } from "../task.js";
import type { Severity, StageResult, TaskContext, PlannerOutput } from "../task.js";

const VALID_SEVERITIES = new Set<string>(["CRITICAL", "HIGH", "MEDIUM", "LOW"]);

interface RunOptions {
  spec: string;
  dryRun: boolean;
  securityThreshold: string;
  autoApprove: boolean;
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

    // Prompt for permission mode if not specified
    let autoApprove = options.autoApprove;
    if (!autoApprove) {
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const answer = await new Promise<string>((resolve) => {
        rl.question(
          "\nAgents will write files and run commands. Auto-approve all actions? (y/n) ",
          resolve,
        );
      });
      rl.close();

      autoApprove = answer.toLowerCase() === "y" || answer.toLowerCase() === "yes";
      console.log("");
    }

    const context: TaskContext = { spec, results: [] };
    const agentOptions = { autoApprove };

    for (const stage of PIPELINE) {
      if (stage.name === "plan") {
        console.log(`[${stage.name}] running planner...`);

        let plan: PlannerOutput | null = null;
        let clarificationAnswers = "";
        let attempts = 0;
        const maxAttempts = 3;

        while (!plan && attempts < maxAttempts) {
          attempts++;
          const result = await runPlanner(context.spec, clarificationAnswers);

          if ("needsClarification" in result && result.needsClarification) {
            console.log(`\n[${stage.name}] planner needs clarification:\n`);

            const answers: string[] = [];
            const rl = createInterface({
              input: process.stdin,
              output: process.stdout,
            });

            for (let i = 0; i < result.questions.length; i++) {
              const question = result.questions[i];
              const answer = await new Promise<string>((resolve) => {
                rl.question(`  [${i + 1}/${result.questions.length}] ${question}\n  > `, resolve);
              });

              if (answer.toLowerCase() === "abort" || answer.toLowerCase() === "cancel") {
                rl.close();
                throw new TaskError("Planner: clarification aborted by user");
              }

              answers.push(`Q: ${question}\nA: ${answer}`);
            }

            rl.close();
            clarificationAnswers = answers.join("\n\n");
            console.log(`\n[${stage.name}] re-running planner with clarifications...\n`);
          } else {
            plan = result as PlannerOutput;
          }
        }

        if (!plan) {
          throw new TaskError(
            `Planner: failed to create valid plan after ${maxAttempts} attempts`,
          );
        }

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
        const impl = await runImplement(context.spec, context.plan, agentOptions);
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
        const gateResult = await runUnitTestGate(context, agentOptions);

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
        const gateResult = await runFunctionalTestGate(context, agentOptions);

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
          agentOptions,
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

        console.log(`[security-review] FAILED — findings at or above ${threshold} threshold`);
        context.results.push({
          stage: stage.name,
          success: false,
          output: JSON.stringify(output),
        });

        const rl = createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        const answer = await new Promise<string>((resolve) => {
          rl.question(
            "\nSecurity review failed. Continue with PR creation anyway? (y/n) ",
            resolve,
          );
        });
        rl.close();

        if (answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes") {
          console.log("[security-review] Aborted by user.");
          process.exit(1);
        }

        console.log("[security-review] Bypassed by user — continuing...");
        continue;
      }

      if (stage.name === "pr-create") {
        if (!context.implement) {
          throw new TaskError("pr-create: implement stage must run first");
        }

        console.log(`[pr-create] creating pull request...`);
        const prResult = await runPRCreate(context);
        context.prCreate = prResult;

        console.log(`[pr-create] branch: ${prResult.branch}`);
        console.log(`[pr-create] PR: ${prResult.prUrl}`);

        context.results.push({
          stage: stage.name,
          success: true,
          output: JSON.stringify(prResult),
        });
        continue;
      }

      if (stage.name === "pr-review") {
        console.log(`[pr-review] reviewing pull request...`);
        const reviewOutput = await runPRReview(context, agentOptions);
        context.prReview = reviewOutput;

        console.log(formatPRReviewOutput(reviewOutput));

        context.results.push({
          stage: stage.name,
          success: true,
          output: JSON.stringify(reviewOutput),
        });

        console.log("What would you like to do next?");
        continue;
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
