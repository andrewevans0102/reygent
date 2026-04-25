import { createInterface } from "node:readline";
import chalk from "chalk";
import ora from "ora";
import { isDebug } from "../debug.js";
import { runUnitTestGate, runFunctionalTestGate } from "../gate.js";
import { runImplement } from "../implement.js";
import type { FailureContext } from "../implement.js";
import { runPlanner } from "../planner.js";
import { runPRCreate } from "../pr-create.js";
import { runPRReview, formatPRReviewTerminal, postPRReviewComment } from "../pr-review.js";
import { runSecurityReview, formatFindings } from "../security-review.js";
import { loadSpec, SpecError } from "../spec.js";
import { PIPELINE, TaskError } from "../task.js";
import type { Severity, StageResult, TaskContext, PlannerOutput } from "../task.js";
import { UsageTracker, printUsageSummary, printVerboseUsage } from "../usage.js";

const VALID_SEVERITIES = new Set<string>(["CRITICAL", "HIGH", "MEDIUM", "LOW"]);

interface RunOptions {
  spec: string;
  dryRun: boolean;
  securityThreshold: string;
  autoApprove: boolean;
  insecure: boolean;
  skipClarification: boolean;
  maxRetries: string;
  verbose: boolean;
}

const MAX_TEST_OUTPUT_CHARS = 8000;

function truncateForPrompt(output: string): string {
  if (output.length <= MAX_TEST_OUTPUT_CHARS) return output;
  const half = Math.floor(MAX_TEST_OUTPUT_CHARS / 2);
  return (
    output.slice(0, half) +
    "\n\n... [truncated] ...\n\n" +
    output.slice(-half)
  );
}

interface RetryGateOptions {
  gateName: string;
  gateRunner: () => Promise<{ gate: import("../task.js").GateResult; usage?: import("../usage.js").UsageInfo }>;
  agentsToRun: Array<"dev" | "qe">;
  context: TaskContext;
  agentOptions: { autoApprove: boolean };
  maxRetries: number;
  autoApprove: boolean;
  stageName: string;
  tracker: UsageTracker;
}

async function retryGate(opts: RetryGateOptions): Promise<import("../task.js").GateResult> {
  const { gateName, gateRunner, agentsToRun, context, agentOptions, maxRetries, autoApprove, stageName, tracker } = opts;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const lastOutput = context.gates?.[gateName === "unit tests" ? "unitTests" : "functionalTests"]?.output ?? "";

    if (!autoApprove) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const answer = await new Promise<string>((resolve) => {
        rl.question(
          chalk.yellow(`\n${gateName} failed. Retry with failure context? (y/n) `),
          resolve,
        );
      });
      rl.close();
      if (answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes") {
        console.log(chalk.red("Aborted by user."));
        process.exit(1);
      }
    }

    console.log(chalk.yellow(`\nRetrying ${gateName} (attempt ${attempt}/${maxRetries})...`));

    const failureContext: FailureContext = {
      gateName,
      testOutput: truncateForPrompt(lastOutput),
      attempt,
      maxAttempts: maxRetries,
    };

    const spinner = ora(chalk.blue(`re-running ${agentsToRun.join(" + ")} agent(s)...`)).start();
    const { implement: retryResult, usages: retryUsages } = await runImplement(context.spec, context.plan!, agentOptions, {
      failureContext,
      agentsToRun,
    });

    // Record retry implementation usage
    for (const u of retryUsages) {
      if (u.usage) tracker.record(u.agent, `${stageName}-retry`, u.usage);
    }

    // Merge results into context
    if (retryResult.dev && context.implement) {
      context.implement.dev = retryResult.dev;
    }
    if (retryResult.qe && context.implement) {
      context.implement.qe = retryResult.qe;
    }
    spinner.succeed(chalk.green("Retry implementation complete"));

    // Re-run gate
    const retrySpinner = ora(chalk.blue(`re-running ${gateName}...`)).start();
    const { gate: gateResult, usage: gateUsage } = await gateRunner();

    const gateAgentName =
      gateName === "unit tests" ? "gate:unit-tests" : "gate:functional-tests";
    if (gateUsage) tracker.record(gateAgentName, `${stageName}-retry`, gateUsage);

    if (!context.gates) context.gates = {};
    if (gateName === "unit tests") {
      context.gates.unitTests = gateResult;
    } else {
      context.gates.functionalTests = gateResult;
    }

    if (gateResult.passed) {
      retrySpinner.succeed(chalk.green(`${gateName} PASSED on retry ${attempt}`));
      return gateResult;
    }

    retrySpinner.fail(chalk.red(`${gateName} FAILED (retry ${attempt}/${maxRetries})`));
  }

  // All retries exhausted
  console.log(chalk.red.bold(`\n${gateName} failed after ${maxRetries} retries. Exiting.`));
  process.exit(1);
}

export async function runCommand(options: RunOptions): Promise<void> {
  try {
    const spec = await loadSpec(options.spec);

    if (options.dryRun) {
      console.log(chalk.yellow.bold("[dry-run]"), "No changes will be made.\n");
      console.log("");
      console.log(chalk.bold.cyan("┌─ Specification"));
      console.log(chalk.cyan("│"), chalk.bold(spec.title));
      console.log(chalk.cyan("│"), chalk.gray(`source: ${spec.source}`));
      console.log(chalk.cyan("└─"));
      console.log("");
      console.log(chalk.bold.cyan("┌─ Workflow Stages"));

      for (let i = 0; i < PIPELINE.length; i++) {
        const stage = PIPELINE[i];
        const isLast = i === PIPELINE.length - 1;
        const prefix = isLast ? "└─" : "├─";
        const continuation = isLast ? "  " : "│ ";

        console.log(chalk.cyan(prefix), chalk.bold.white(stage.name));
        console.log(chalk.cyan(continuation), chalk.gray(stage.description));

        // Format execution details
        let execInfo = "";
        if (stage.execution.kind === "agent") {
          execInfo = chalk.blue(`agent: ${stage.execution.agent}`);
        } else if (stage.execution.kind === "parallel") {
          execInfo = chalk.magenta(`parallel: ${stage.execution.agents.join(", ")}`);
        } else if (stage.execution.kind === "gate") {
          execInfo = chalk.yellow(`gate: ${stage.execution.condition} (${stage.execution.agent})`);
        }

        console.log(chalk.cyan(continuation), execInfo);

        if (!isLast) {
          console.log(chalk.cyan("│"));
        }
      }

      console.log("");
      return;
    }

    const threshold = options.securityThreshold.toUpperCase();
    if (!VALID_SEVERITIES.has(threshold)) {
      console.log(chalk.red.bold("Error:"), `Invalid --security-threshold "${options.securityThreshold}". Must be one of: CRITICAL, HIGH, MEDIUM, LOW`);
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

    // Prompt for clarification preference if not specified
    let skipClarification = options.skipClarification;
    if (!skipClarification && !options.dryRun) {
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const answer = await new Promise<string>((resolve) => {
        rl.question(
          "Skip clarifying questions and make assumptions? (y/n) ",
          resolve,
        );
      });
      rl.close();

      skipClarification = answer.toLowerCase() === "y" || answer.toLowerCase() === "yes";
      console.log("");
    }

    const maxRetries = Math.max(0, parseInt(options.maxRetries, 10) || 0);

    const context: TaskContext = { spec, results: [] };
    const agentOptions = { autoApprove };
    const tracker = new UsageTracker();

    for (const stage of PIPELINE) {
      if (stage.name === "plan") {
        const spinner = ora(chalk.blue("running planner...")).start();

        let plan: PlannerOutput | null = null;

        if (skipClarification) {
          // Skip clarification, make assumptions
          const { result, usage: planUsage } = await runPlanner(context.spec, undefined, { makeAssumptions: true });
          if ("needsClarification" in result && result.needsClarification) {
            spinner.fail(chalk.red("Planner asked questions despite skip flag"));
            throw new TaskError("Planner: unexpected clarification request in assumption mode");
          }
          plan = result as PlannerOutput;
          if (planUsage) tracker.record("planner", "plan", planUsage);
        } else {
          // Run clarification loop
          let clarificationAnswers = "";
          let attempts = 0;
          const maxAttempts = 3;

          while (!plan && attempts < maxAttempts) {
            attempts++;
            const { result, usage: planUsage } = await runPlanner(context.spec, clarificationAnswers);
            if (planUsage) tracker.record("planner", "plan", planUsage);

            if ("needsClarification" in result && result.needsClarification) {
              spinner.stop();
              console.log(chalk.yellow("\nPlanner needs clarification:\n"));

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
              console.log(chalk.blue("\nRe-running planner with clarifications...\n"));
              spinner.start();
            } else {
              plan = result as PlannerOutput;
            }
          }

          if (!plan) {
            spinner.fail(chalk.red("Planner failed"));
            throw new TaskError(
              `Planner: failed to create valid plan after ${maxAttempts} attempts`,
            );
          }
        }

        spinner.succeed(chalk.green("Plan created"));
        context.plan = plan;

        console.log(chalk.cyan("\nGoals:"));
        for (const g of plan.goals) console.log(`  ${chalk.gray("-")} ${g}`);
        console.log(chalk.cyan("\nTasks:"));
        for (const t of plan.tasks) console.log(`  ${chalk.gray("-")} ${t}`);
        console.log(chalk.cyan("\nConstraints:"));
        for (const c of plan.constraints) console.log(`  ${chalk.gray("-")} ${c}`);
        console.log(chalk.cyan("\nDefinition of Done:"));
        for (const d of plan.dod) console.log(`  ${chalk.gray("-")} ${d}`);

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

        const spinner = ora(chalk.blue("spawning dev and qe agents...")).start();
        const { implement: impl, usages: implUsages } = await runImplement(context.spec, context.plan, agentOptions);
        context.implement = impl;

        for (const u of implUsages) {
          if (u.usage) tracker.record(u.agent, "implement", u.usage);
        }

        const devSuccess = impl.dev !== null;
        const qeSuccess = impl.qe !== null;

        if (devSuccess && qeSuccess) {
          spinner.succeed(chalk.green("Implementation complete"));
        } else {
          spinner.warn(chalk.yellow("Implementation partially failed"));
        }

        if (impl.dev) {
          console.log(chalk.gray("dev files:"), impl.dev.files.join(", ") || chalk.gray("(none)"));
        }
        if (impl.qe) {
          console.log(chalk.gray("qe test files:"), impl.qe.testFiles.join(", ") || chalk.gray("(none)"));
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

        const spinner = ora(chalk.blue("running unit tests...")).start();
        const { gate: unitGateResult, usage: unitGateUsage } = await runUnitTestGate(context, agentOptions);
        let gateResult = unitGateResult;

        if (unitGateUsage) tracker.record("gate:unit-tests", stage.name, unitGateUsage);

        if (!context.gates) context.gates = {};
        context.gates.unitTests = gateResult;

        if (gateResult.passed) {
          spinner.succeed(chalk.green("Unit tests PASSED"));
          context.results.push({
            stage: stage.name,
            success: true,
            output: gateResult.output,
          });
          continue;
        }

        spinner.fail(chalk.red("Unit tests FAILED"));

        // Retry loop — dev agent only for unit test failures
        gateResult = await retryGate({
          gateName: "unit tests",
          gateRunner: () => runUnitTestGate(context, agentOptions),
          agentsToRun: ["dev"],
          context,
          agentOptions,
          maxRetries,
          autoApprove,
          stageName: stage.name,
          tracker,
        });

        context.results.push({
          stage: stage.name,
          success: gateResult.passed,
          output: gateResult.output,
        });
        continue;
      }

      if (stage.name === "gate-functional-tests") {
        if (!context.implement) {
          throw new TaskError("gate-functional-tests: implement stage must run first");
        }

        const spinner = ora(chalk.blue("running functional tests...")).start();
        const { gate: funcGateResult, usage: funcGateUsage } = await runFunctionalTestGate(context, agentOptions);
        let gateResult = funcGateResult;

        if (funcGateUsage) tracker.record("gate:functional-tests", stage.name, funcGateUsage);

        if (!context.gates) context.gates = {};
        context.gates.functionalTests = gateResult;

        if (gateResult.passed) {
          spinner.succeed(chalk.green("Functional tests PASSED"));
          context.results.push({
            stage: stage.name,
            success: true,
            output: gateResult.output,
          });
          continue;
        }

        spinner.fail(chalk.red("Functional tests FAILED"));
        console.log(gateResult.output);

        // Retry loop — both dev + qe agents for functional test failures
        gateResult = await retryGate({
          gateName: "functional tests",
          gateRunner: () => runFunctionalTestGate(context, agentOptions),
          agentsToRun: ["dev", "qe"],
          context,
          agentOptions,
          maxRetries,
          autoApprove,
          stageName: stage.name,
          tracker,
        });

        context.results.push({
          stage: stage.name,
          success: gateResult.passed,
          output: gateResult.output,
        });
        continue;
      }

      if (stage.name === "security-review") {
        if (!context.implement) {
          throw new TaskError("security-review: implement stage must run first");
        }

        const spinner = ora(chalk.blue("running security review...")).start();
        const { output, passed, usage: secUsage } = await runSecurityReview(
          context,
          threshold as Severity,
          agentOptions,
        );
        if (secUsage) tracker.record("security-review", stage.name, secUsage);
        context.securityReview = output;

        if (passed) {
          spinner.succeed(chalk.green("Security review PASSED"));
        } else {
          spinner.fail(chalk.red("Security review FAILED"));
        }

        console.log("");
        console.log(chalk.cyan.bold(`Security Findings (${output.findings.length}):`));
        console.log(formatFindings(output.findings, threshold as Severity));
        console.log("");

        if (passed) {
          context.results.push({
            stage: stage.name,
            success: true,
            output: JSON.stringify(output),
          });
          continue;
        }

        console.log(chalk.yellow(`Findings at or above ${threshold} threshold`));
        context.results.push({
          stage: stage.name,
          success: false,
          output: JSON.stringify(output),
        });

        if (autoApprove) {
          console.log(chalk.yellow("Auto-approved — bypassing security gate..."));
        } else {
          const rl = createInterface({
            input: process.stdin,
            output: process.stdout,
          });
          const answer = await new Promise<string>((resolve) => {
            rl.question(
              chalk.yellow("\nSecurity review failed. Continue with PR creation anyway? (y/n) "),
              resolve,
            );
          });
          rl.close();

          if (answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes") {
            console.log(chalk.red("Aborted by user."));
            process.exit(1);
          }

          console.log(chalk.yellow("Bypassed by user — continuing..."));
        }
        continue;
      }

      if (stage.name === "pr-create") {
        if (!context.implement) {
          throw new TaskError("pr-create: implement stage must run first");
        }

        const spinner = ora(chalk.blue("creating pull request...")).start();
        const prResult = await runPRCreate(context, { insecure: options.insecure });
        context.prCreate = prResult;
        spinner.succeed(chalk.green("PR created"));

        console.log(chalk.gray("branch:"), chalk.cyan(prResult.branch));
        console.log(chalk.gray("PR:"), chalk.blue(prResult.prUrl));

        context.results.push({
          stage: stage.name,
          success: true,
          output: JSON.stringify(prResult),
        });
        continue;
      }

      if (stage.name === "pr-review") {
        const spinner = ora(chalk.blue("reviewing pull request...")).start();
        const { output: reviewOutput, usage: prUsage } = await runPRReview(context, agentOptions);
        context.prReview = reviewOutput;
        if (prUsage) tracker.record("pr-review", stage.name, prUsage);
        spinner.succeed(chalk.green("PR review complete"));

        console.log(formatPRReviewTerminal(reviewOutput));

        const commentSpinner = ora(chalk.blue("posting review comment to PR...")).start();
        try {
          await postPRReviewComment(context, reviewOutput);
          commentSpinner.succeed(chalk.green("Review posted to PR"));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          commentSpinner.fail(chalk.yellow(`Could not post review to PR: ${msg}`));
        }

        context.results.push({
          stage: stage.name,
          success: true,
          output: JSON.stringify(reviewOutput),
        });

        console.log(chalk.cyan("\nWhat would you like to do next?"));
        continue;
      }

      const result: StageResult = {
        stage: stage.name,
        success: true,
        output: "skipped",
      };
      console.log(chalk.gray(`[${stage.name}] skipped`));
      context.results.push(result);
    }

    // Print usage summary after pipeline completes
    printUsageSummary(tracker);
    if (options.verbose) {
      printVerboseUsage(tracker);
    }
  } catch (err) {
    if (err instanceof SpecError || err instanceof TaskError) {
      console.log(chalk.red.bold("Error:"), err.message);
      if (isDebug()) console.error(err.stack);
      process.exit(1);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.log(chalk.red.bold("Internal error:"), message);
    if (isDebug()) console.error(err instanceof Error ? err.stack : err);
    process.exit(2);
  }
}
