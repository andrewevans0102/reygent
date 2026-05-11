import { createInterface } from "node:readline";
import chalk from "chalk";
import ora from "ora";
import { select } from "@inquirer/prompts";
import { pasteableInput } from "../pasteable-input.js";
import { isDebug } from "../debug.js";
import { wrapText } from "../format.js";
import { loadEnvFile } from "../env.js";
import { runUnitTestGate, runFunctionalTestGate } from "../gate.js";
import { runImplement } from "../implement.js";
import type { FailureContext } from "../implement.js";
import { createLiveStatus } from "../live-status.js";
import { runPlanner } from "../planner.js";
import { resetTerminalForInput } from "../terminal-reset.js";
import { runPRCreate } from "../pr-create.js";
import { normalizeType, detectTypeFromJiraIssueType, detectTypeFromLinearLabels, VALID_BRANCH_TYPES, type BranchType } from "../branch-type.js";
import { runPRReview, formatPRReviewTerminal, postPRReviewComment } from "../pr-review.js";
import { runSecurityReview, formatFindings } from "../security-review.js";
import { loadSpec, SpecError } from "../spec.js";
import { PIPELINE, TaskError } from "../task.js";
import type { Severity, StageResult, TaskContext, PlannerOutput } from "../task.js";
import { UsageTracker, printUsageSummary, printVerboseUsage } from "../usage.js";
import { getChesstrace } from "../chesstrace/index.js";
import type { Chesstrace } from "../chesstrace/index.js";
import { Events, TelemetryLevel } from "../chesstrace/events.js";
import { SqliteBackend } from "../chesstrace/backends/sqlite.js";
import { loadConfig } from "../config.js";

const VALID_SEVERITIES = new Set<string>(["CRITICAL", "HIGH", "MEDIUM", "LOW"]);

/**
 * Emit stage.end event with duration and success status
 */
function emitStageEnd(
  chesstrace: Chesstrace | null,
  stageName: string,
  stageStartTime: number,
  success: boolean,
  metadata?: { cost?: number; outputSummary?: string },
): void {
  if (!chesstrace) return;
  try {
    chesstrace.emit(Events.PIPELINE_STAGE_END, {
      stage: stageName,
      success,
      durationMs: Date.now() - stageStartTime,
      ...(metadata && { metadata }),
    });
  } catch {
    // Swallow emit errors
  }
}

/**
 * Helper to merge agentOptions with onActivity callback from a LiveStatus instance.
 * Reduces boilerplate from repeated `{ ...agentOptions, onActivity: status.onActivity }` pattern.
 */
function withActivity(
  agentOptions: { autoApprove: boolean },
  status: { onActivity: (event: import("../live-status.js").ActivityEvent) => void },
): { autoApprove: boolean; onActivity: (event: import("../live-status.js").ActivityEvent) => void } {
  return { ...agentOptions, onActivity: status.onActivity };
}

interface RunOptions {
  spec?: string;
  type?: string;
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
  gateRunner: (attempt: number) => Promise<{ gate: import("../task.js").GateResult; usage?: import("../usage.js").UsageInfo }>;
  agentsToRun: Array<"dev" | "qe">;
  context: TaskContext;
  agentOptions: { autoApprove: boolean };
  maxRetries: number;
  autoApprove: boolean;
  stageName: string;
  tracker: UsageTracker;
  verbose: boolean;
}

async function retryGate(opts: RetryGateOptions): Promise<import("../task.js").GateResult> {
  const { gateName, gateRunner, agentsToRun, context, agentOptions, maxRetries, autoApprove, stageName, tracker, verbose } = opts;

  // Retry attempt numbering:
  // - Initial gate run uses attempt=1 (before entering this loop)
  // - Loop variable `attempt` represents retry iteration (1 to maxRetries)
  // - Gate receives attempt+1 as total attempt number:
  //   * First retry (attempt=1) → gate attempt 2
  //   * Second retry (attempt=2) → gate attempt 3
  //   * etc.
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const lastOutput = context.gates?.[gateName === "unit tests" ? "unitTests" : "functionalTests"]?.output ?? "";

    if (!autoApprove) {
      resetTerminalForInput();
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

    // Emit gate.retry telemetry after user approves
    const chesstrace = getChesstrace();
    if (chesstrace) {
      try {
        const failureSnippet = lastOutput.length > 500
          ? lastOutput.slice(-500)
          : lastOutput;
        chesstrace.emit(Events.GATE_RETRY, {
          gateName,
          attempt,
          maxRetries,
          failureSnippet,
        });
      } catch (err) {
        if (verbose) {
          console.error("[telemetry]", err instanceof Error ? err.message : String(err));
        }
      }
    }

    console.log(chalk.yellow(`\nRetrying ${gateName} (attempt ${attempt}/${maxRetries})...`));

    const failureContext: FailureContext = {
      gateName,
      testOutput: truncateForPrompt(lastOutput),
      attempt,
      maxAttempts: maxRetries,
    };

    const status = createLiveStatus(`re-running ${agentsToRun.join(" + ")} agent(s)...`);
    const { implement: retryResult, usages: retryUsages } = await runImplement(
      context.spec,
      context.plan!,
      withActivity(agentOptions, status),
      { failureContext, agentsToRun },
    );

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
    status.succeed(chalk.green("Retry implementation complete"));

    // Re-run gate
    const retryStatus = createLiveStatus(`re-running ${gateName}...`);
    const { gate: gateResult, usage: gateUsage } = await gateRunner(attempt + 1);

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
      retryStatus.succeed(chalk.green(`${gateName} PASSED on retry ${attempt}`));
      return gateResult;
    }

    retryStatus.fail(chalk.red(`${gateName} FAILED (retry ${attempt}/${maxRetries})`));
  }

  // All retries exhausted
  throw new TaskError(`${gateName} failed after ${maxRetries} retries`);
}

async function promptLinearSpec(): Promise<string> {
  loadEnvFile();
  if (!process.env.LINEAR_API_KEY) {
    console.log(chalk.red.bold("Error:"), "LINEAR_API_KEY not set. Add it to your .env file.");
    process.exit(1);
  }
  const value = await pasteableInput({
    message: "Linear issue URL or ID (e.g. https://linear.app/team/ENG-123 or ENG-123):",
    validate: (v) => {
      const trimmed = v.trim();
      if (!trimmed) return "Required";
      if (/^https:\/\/linear\.app\/.+/.test(trimmed)) return true;
      if (/^[A-Z]+-\d+$/i.test(trimmed)) return true;
      return "Enter a Linear URL or issue ID (e.g. ENG-123)";
    },
  });
  return value.trim();
}

async function promptJiraSpec(): Promise<string> {
  loadEnvFile();
  const missing: string[] = [];
  if (!process.env.JIRA_URL) missing.push("JIRA_URL");
  if (!process.env.JIRA_EMAIL) missing.push("JIRA_EMAIL");
  if (!process.env.JIRA_API_TOKEN) missing.push("JIRA_API_TOKEN");
  if (missing.length > 0) {
    console.log(chalk.red.bold("Error:"), `Missing env vars: ${missing.join(", ")}. Add them to your .env file.`);
    process.exit(1);
  }
  const value = await pasteableInput({
    message: "Jira issue key (e.g. PROJ-123):",
    validate: (v) => {
      const trimmed = v.trim();
      if (!trimmed) return "Required";
      if (/^[A-Z]+-\d+$/i.test(trimmed)) return true;
      return "Enter a Jira issue key (e.g. PROJ-123)";
    },
  });
  return value.trim();
}

async function promptMarkdownSpec(): Promise<string> {
  const value = await pasteableInput({
    message: "Path to markdown spec file:",
    validate: (v) => (v.trim() ? true : "Required"),
  });
  return value.trim();
}

async function promptForSpec(): Promise<string> {
  const source = await select({
    message: "Where is the workflow spec?",
    choices: [
      { name: "Local Markdown file", value: "markdown" },
      { name: "Linear issue", value: "linear" },
      { name: "Jira issue", value: "jira" },
    ],
  });

  switch (source) {
    case "linear":
      return promptLinearSpec();
    case "jira":
      return promptJiraSpec();
    case "markdown":
    default:
      return promptMarkdownSpec();
  }
}

export async function runCommand(options: RunOptions): Promise<void> {
  const pipelineStartTime = Date.now();

  // Initialize tracker and context early for error handling
  const tracker = new UsageTracker();
  let context: TaskContext | undefined;

  // Load config and check if telemetry is enabled
  const config = loadConfig();
  const telemetryEnabled = config.telemetry?.enabled === true;
  let chesstrace: Chesstrace | null = null;

  // Initialize telemetry backend only if enabled
  if (telemetryEnabled) {
    try {
      const telemetryLevel = TelemetryLevel[config.telemetry?.level ?? 'standard'];
      chesstrace = getChesstrace();
      const backend = new SqliteBackend();
      await chesstrace.init(backend);
      await chesstrace.startRun();
    } catch (err) {
      // Telemetry init failed - continue without telemetry
      if (isDebug()) {
        console.error(chalk.gray("Telemetry init failed:"), err);
      }
      chesstrace = null;
    }
  }

  try {
    let specSource = options.spec;
    if (!specSource) {
      if (!process.stdin.isTTY) {
        console.log(chalk.red.bold("Error:"), "--spec is required in non-interactive environments.");
        process.exit(1);
      }
      specSource = await promptForSpec();
    }
    const spec = await loadSpec(specSource);

    // Skip telemetry in dry-run mode
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

    // Initialize context after dry-run check
    context = { spec, results: [] };

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

    const agentOptions = { autoApprove };

    // Emit pipeline.start
    if (chesstrace) {
      try {
        chesstrace.emit(Events.PIPELINE_START, {
          spec: {
            source: spec.source,
            title: spec.title,
          },
          options: {
            autoApprove,
            skipClarification,
            maxRetries,
            securityThreshold: options.securityThreshold,
            insecure: options.insecure,
          },
        });
      } catch {
        // Swallow emit errors
      }
    }

    for (const stage of PIPELINE) {
      const stageStartTime = Date.now();

      // Emit pipeline.stage.start
      if (chesstrace) {
        try {
          chesstrace.emit(Events.PIPELINE_STAGE_START, {
            stage: stage.name,
            description: stage.description,
          });
        } catch {
          // Swallow emit errors
        }
      }

      if (stage.name === "plan") {
        const status = createLiveStatus("running planner...");

        let plan: PlannerOutput | null = null;

        if (skipClarification) {
          // Skip clarification, make assumptions
          const { result, usage: planUsage } = await runPlanner(
            context.spec,
            undefined,
            { makeAssumptions: true, onActivity: status.onActivity },
          );
          if ("needsClarification" in result && result.needsClarification) {
            status.fail(chalk.red("Planner asked questions despite skip flag"));
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
            const { result, usage: planUsage } = await runPlanner(
              context.spec,
              clarificationAnswers,
              { onActivity: status.onActivity },
            );
            if (planUsage) tracker.record("planner", "plan", planUsage);

            if ("needsClarification" in result && result.needsClarification) {
              status.stop();
              resetTerminalForInput();
              console.log(chalk.yellow("\nPlanner needs clarification:\n"));

              const answers: string[] = [];

              for (let i = 0; i < result.questions.length; i++) {
                const question = result.questions[i];
                console.log(`  [${i + 1}/${result.questions.length}] ${question}`);
                const answer = await pasteableInput({ message: ">" });

                if (answer.toLowerCase() === "abort" || answer.toLowerCase() === "cancel") {
                  throw new TaskError("Planner: clarification aborted by user");
                }

                answers.push(`Q: ${question}\nA: ${answer}`);
              }
              clarificationAnswers = answers.join("\n\n");
              console.log(chalk.blue("\nRe-running planner with clarifications...\n"));
              status.start();
            } else {
              plan = result as PlannerOutput;
            }
          }

          if (!plan) {
            status.fail(chalk.red("Planner failed"));
            throw new TaskError(
              `Planner: failed to create valid plan after ${maxAttempts} attempts`,
            );
          }
        }

        status.succeed(chalk.green("Plan created"));
        context.plan = plan;

        const cols = process.stdout.columns || 80;
        console.log(chalk.cyan("\nGoals:"));
        for (const g of plan.goals) console.log(`  ${chalk.gray("-")} ${wrapText(g, 4, cols)}`);
        console.log(chalk.cyan("\nTasks:"));
        for (const t of plan.tasks) console.log(`  ${chalk.gray("-")} ${wrapText(t, 4, cols)}`);
        console.log(chalk.cyan("\nConstraints:"));
        for (const c of plan.constraints) console.log(`  ${chalk.gray("-")} ${wrapText(c, 4, cols)}`);
        console.log(chalk.cyan("\nDefinition of Done:"));
        for (const d of plan.dod) console.log(`  ${chalk.gray("-")} ${wrapText(d, 4, cols)}`);
        console.log();

        context.results.push({
          stage: stage.name,
          success: true,
          output: JSON.stringify(plan),
        });

        emitStageEnd(chesstrace, stage.name, stageStartTime, true);
        continue;
      }

      if (stage.name === "implement") {
        if (!context.plan) {
          throw new TaskError("Implement: plan stage must run before implement");
        }

        const implStatus = createLiveStatus("spawning dev and qe agents...");
        const { implement: impl, usages: implUsages } = await runImplement(
          context.spec,
          context.plan,
          withActivity(agentOptions, implStatus),
        );
        context.implement = impl;

        for (const u of implUsages) {
          if (u.usage) tracker.record(u.agent, "implement", u.usage);
        }

        const devSuccess = impl.dev !== null;
        const qeSuccess = impl.qe !== null;

        if (devSuccess && qeSuccess) {
          implStatus.succeed(chalk.green("Implementation complete"));
        } else {
          implStatus.warn(chalk.yellow("Implementation partially failed"));
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

        emitStageEnd(chesstrace, stage.name, stageStartTime, devSuccess && qeSuccess);
        continue;
      }

      if (stage.name === "gate-unit-tests") {
        if (!context.implement) {
          throw new TaskError("gate-unit-tests: implement stage must run first");
        }

        const unitStatus = createLiveStatus("running unit tests...");
        const { gate: unitGateResult, usage: unitGateUsage } = await runUnitTestGate(
          context,
          { ...withActivity(agentOptions, unitStatus), attempt: 1, verbose: options.verbose },
        );
        let gateResult = unitGateResult;

        if (unitGateUsage) tracker.record("gate:unit-tests", stage.name, unitGateUsage);

        if (!context.gates) context.gates = {};
        context.gates.unitTests = gateResult;

        if (gateResult.passed) {
          unitStatus.succeed(chalk.green("Unit tests PASSED"));
          context.results.push({
            stage: stage.name,
            success: true,
            output: gateResult.output,
          });
          emitStageEnd(chesstrace, stage.name, stageStartTime, true);
          continue;
        }

        unitStatus.fail(chalk.red("Unit tests FAILED"));

        // If no retries configured, emit failure and throw
        if (maxRetries === 0) {
          context.results.push({
            stage: stage.name,
            success: false,
            output: gateResult.output,
          });
          emitStageEnd(chesstrace, stage.name, stageStartTime, false);
          throw new TaskError("unit tests failed with 0 retries configured");
        }

        // Retry loop — dev agent only for unit test failures
        gateResult = await retryGate({
          gateName: "unit tests",
          gateRunner: (attempt) => runUnitTestGate(context, { ...agentOptions, attempt, verbose: options.verbose }),
          agentsToRun: ["dev"],
          context,
          agentOptions,
          maxRetries,
          autoApprove,
          stageName: stage.name,
          tracker,
          verbose: options.verbose,
        });

        context.results.push({
          stage: stage.name,
          success: gateResult.passed,
          output: gateResult.output,
        });

        emitStageEnd(chesstrace, stage.name, stageStartTime, gateResult.passed);
        continue;
      }

      if (stage.name === "gate-functional-tests") {
        if (!context.implement) {
          throw new TaskError("gate-functional-tests: implement stage must run first");
        }

        const funcStatus = createLiveStatus("running functional tests...");
        const { gate: funcGateResult, usage: funcGateUsage } = await runFunctionalTestGate(
          context,
          { ...withActivity(agentOptions, funcStatus), attempt: 1, verbose: options.verbose },
        );
        let gateResult = funcGateResult;

        if (funcGateUsage) tracker.record("gate:functional-tests", stage.name, funcGateUsage);

        if (!context.gates) context.gates = {};
        context.gates.functionalTests = gateResult;

        if (gateResult.passed) {
          funcStatus.succeed(chalk.green("Functional tests PASSED"));
          context.results.push({
            stage: stage.name,
            success: true,
            output: gateResult.output,
          });
          emitStageEnd(chesstrace, stage.name, stageStartTime, true);
          continue;
        }

        funcStatus.fail(chalk.red("Functional tests FAILED"));
        console.log(gateResult.output);

        // If no retries configured, emit failure and throw
        if (maxRetries === 0) {
          context.results.push({
            stage: stage.name,
            success: false,
            output: gateResult.output,
          });
          emitStageEnd(chesstrace, stage.name, stageStartTime, false);
          throw new TaskError("functional tests failed with 0 retries configured");
        }

        // Retry loop — both dev + qe agents for functional test failures
        gateResult = await retryGate({
          gateName: "functional tests",
          gateRunner: (attempt) => runFunctionalTestGate(context, { ...agentOptions, attempt, verbose: options.verbose }),
          agentsToRun: ["dev", "qe"],
          context,
          agentOptions,
          maxRetries,
          autoApprove,
          stageName: stage.name,
          tracker,
          verbose: options.verbose,
        });

        context.results.push({
          stage: stage.name,
          success: gateResult.passed,
          output: gateResult.output,
        });

        emitStageEnd(chesstrace, stage.name, stageStartTime, gateResult.passed);
        continue;
      }

      if (stage.name === "security-review") {
        if (!context.implement) {
          throw new TaskError("security-review: implement stage must run first");
        }

        const secStatus = createLiveStatus("running security review...");
        const { output, passed, usage: secUsage } = await runSecurityReview(
          context,
          threshold as Severity,
          withActivity(agentOptions, secStatus),
        );
        if (secUsage) tracker.record("security-review", stage.name, secUsage);
        context.securityReview = output;

        if (passed) {
          secStatus.succeed(chalk.green("Security review PASSED"));
        } else {
          secStatus.fail(chalk.red("Security review FAILED"));
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
          emitStageEnd(chesstrace, stage.name, stageStartTime, true);
          continue;
        }

        console.log(chalk.yellow(`Findings at or above ${threshold} threshold`));
        context.results.push({
          stage: stage.name,
          success: false,
          output: JSON.stringify(output),
        });

        emitStageEnd(chesstrace, stage.name, stageStartTime, false);

        if (autoApprove) {
          console.log(chalk.yellow("Auto-approved — bypassing security gate..."));
        } else {
          resetTerminalForInput();
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

        // Determine branch type
        let branchType: BranchType;

        // Check if --type flag was provided
        if (options.type) {
          // Validation already done in CLI hook, just normalize
          branchType = normalizeType(options.type);
        } else {
          // Try auto-detection from issue type
          let autoDetected: BranchType | null = null;

          if (context.spec.source === "jira" && context.spec.issueType) {
            autoDetected = detectTypeFromJiraIssueType(context.spec.issueType);
          } else if (context.spec.source === "linear" && "labels" in context.spec && context.spec.labels) {
            autoDetected = detectTypeFromLinearLabels(context.spec.labels);
          }

          if (autoDetected) {
            // Issue type detected - use it without prompting
            branchType = autoDetected;
          } else {
            // No auto-detection - prompt user
            resetTerminalForInput();
            branchType = await select({
              message: "Select branch type:",
              choices: VALID_BRANCH_TYPES.map(t => ({ name: t, value: t })),
            }) as BranchType;
          }
        }

        const spinner = ora(chalk.blue("creating pull request...")).start();
        const prResult = await runPRCreate(context, { insecure: options.insecure, branchType });
        context.prCreate = prResult;
        spinner.succeed(chalk.green("PR created"));

        console.log(chalk.gray("branch:"), chalk.cyan(prResult.branch));
        console.log(chalk.gray("PR:"), chalk.blue(prResult.prUrl));

        context.results.push({
          stage: stage.name,
          success: true,
          output: JSON.stringify(prResult),
        });

        emitStageEnd(chesstrace, stage.name, stageStartTime, true);
        continue;
      }

      if (stage.name === "pr-review") {
        const prStatus = createLiveStatus("reviewing pull request...");
        const { output: reviewOutput, usage: prUsage } = await runPRReview(
          context,
          withActivity(agentOptions, prStatus),
        );
        context.prReview = reviewOutput;
        if (prUsage) tracker.record("pr-review", stage.name, prUsage);
        prStatus.succeed(chalk.green("PR review complete"));

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

        emitStageEnd(chesstrace, stage.name, stageStartTime, true);
        continue;
      }

      const result: StageResult = {
        stage: stage.name,
        success: true,
        output: "skipped",
      };
      console.log(chalk.gray(`[${stage.name}] skipped`));
      context.results.push(result);
      emitStageEnd(chesstrace, stage.name, stageStartTime, true);
    }

    // Emit pipeline.end
    const allSuccess = context.results.every((r) => r.success);
    if (chesstrace) {
      try {
        chesstrace.emit(Events.PIPELINE_END, {
          success: allSuccess,
          totalDurationMs: Date.now() - pipelineStartTime,
          totalCost: tracker.getTotalCost(),
        });
      } catch {
        // Swallow emit errors
      }

      // Flush and close telemetry
      try {
        await chesstrace.flush();
      } catch {
        // Swallow flush errors
      }
      try {
        await chesstrace.close();
      } catch {
        // Swallow close errors
      }
    }

    // Print usage summary after pipeline completes
    printUsageSummary(tracker);
    if (options.verbose) {
      printVerboseUsage(tracker);
    }
  } catch (err) {
    // Emit pipeline.end with failure status (if context exists)
    if (chesstrace) {
      try {
        if (context) {
          chesstrace.emit(Events.PIPELINE_END, {
            success: false,
            totalDurationMs: Date.now() - pipelineStartTime,
            totalCost: tracker?.getTotalCost() ?? 0,
          });
        }
      } catch {
        // Swallow emit errors
      }

      // Flush and close telemetry even on error
      try {
        await chesstrace.flush();
      } catch {
        // Swallow flush errors
      }
      try {
        await chesstrace.close();
      } catch {
        // Swallow close errors
      }
    }

    if (err instanceof Error && err.name === "ExitPromptError") {
      process.exit(0);
    }
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
