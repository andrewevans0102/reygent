import { createInterface } from "node:readline";
import chalk from "chalk";
import { select } from "@inquirer/prompts";
import { ExitPromptError } from "@inquirer/core";
import { isDebug } from "../debug.js";
import { wrapText } from "../format.js";
import { createLiveStatus } from "../live-status.js";
import { loadSpec, SpecError, ISSUE_KEY_PATTERN } from "../spec.js";
import { resetTerminalForInput } from "../terminal-reset.js";
import { runPlanner } from "../planner.js";
import { TaskError } from "../task.js";
import type { PlannerOutput } from "../task.js";
import type { SpecProvider } from "../spec.js";

const VALID_PROVIDERS: SpecProvider[] = ["jira", "linear", "local"];

interface SpecCommandOptions {
  clarify?: boolean;
  source?: string;
}

/**
 * Infer provider when unambiguous, or return undefined to trigger prompt.
 * Returns undefined only for ambiguous issue keys (e.g. ENG-123).
 */
function inferProvider(source: string): SpecProvider | undefined {
  if (/^https:\/\/linear\.app\//.test(source)) {
    return "linear";
  }
  if (ISSUE_KEY_PATTERN.test(source)) {
    return undefined; // ambiguous — needs prompt
  }
  return "local"; // file path or anything else
}

export async function specCommand(source: string, options: SpecCommandOptions): Promise<void> {
  try {
    // Validate --source flag if given
    if (options.source !== undefined) {
      if (!VALID_PROVIDERS.includes(options.source as SpecProvider)) {
        console.log(
          chalk.red.bold("Error:"),
          `Invalid source provider "${options.source}". Must be one of: ${VALID_PROVIDERS.join(", ")}`,
        );
        process.exit(1);
      }
    }

    // Resolve provider: flag > inference > prompt
    let provider: SpecProvider | undefined = options.source as SpecProvider | undefined;

    // Validate source format matches explicit provider if given
    if (provider) {
      const hasMdExt = /\.(md|markdown)$/i.test(source);
      const isLinearUrl = /^https:\/\/linear\.app\//.test(source);
      const isIssueKey = ISSUE_KEY_PATTERN.test(source);

      // Only warn for clear mismatches
      if (provider === "local" && isLinearUrl) {
        console.log(
          chalk.yellow("Warning:"),
          `Source "${source}" is a Linear URL, but --source=local treats it as a file path.`,
        );
      } else if (provider === "linear" && hasMdExt) {
        console.log(
          chalk.yellow("Warning:"),
          `Source "${source}" ends in .md/.markdown, but --source=linear treats it as a Linear issue ID.`,
        );
      } else if (provider === "jira" && hasMdExt) {
        console.log(
          chalk.yellow("Warning:"),
          `Source "${source}" ends in .md/.markdown, but --source=jira treats it as a Jira issue key.`,
        );
      }
    }

    if (!provider) {
      provider = inferProvider(source);
    }

    if (!provider) {
      // Need to prompt — check for TTY
      if (!process.stdin.isTTY) {
        console.log(
          chalk.red.bold("Error:"),
          `Cannot determine provider for "${source}" in non-interactive mode. Use --source <jira|linear|local>.`,
        );
        process.exit(1);
      }

      provider = await select<SpecProvider>({
        message: "Which provider is this issue from?",
        choices: [
          { name: "Jira", value: "jira" },
          { name: "Linear", value: "linear" },
          { name: "Local file", value: "local" },
        ],
      });
    }

    const spec = await loadSpec(source, provider);

    if (!options.clarify) {
      // Original behavior: just output spec JSON
      console.log(JSON.stringify(spec, null, 2));
      return;
    }

    // Run planner with clarification loop
    const status = createLiveStatus("running planner...");

    let plan: PlannerOutput | null = null;
    let clarificationAnswers = "";
    let attempts = 0;
    const maxAttempts = 3;

    while (!plan && attempts < maxAttempts) {
      attempts++;
      const { result } = await runPlanner(spec, clarificationAnswers, { onActivity: status.onActivity });

      if ("needsClarification" in result && result.needsClarification) {
        status.stop();
        resetTerminalForInput();
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
        status.start();
      } else {
        plan = result as PlannerOutput;
      }
    }

    if (!plan) {
      status.fail(chalk.red("Planner failed"));
      throw new TaskError(`Planner: failed to create valid plan after ${maxAttempts} attempts`);
    }

    status.succeed(chalk.green("Plan created"));

    const cols = process.stdout.columns || 80;
    console.log(chalk.cyan("\nGoals:"));
    for (const g of plan.goals) console.log(`  ${chalk.gray("-")} ${wrapText(g, 4, cols)}`);
    console.log(chalk.cyan("\nTasks:"));
    for (const t of plan.tasks) console.log(`  ${chalk.gray("-")} ${wrapText(t, 4, cols)}`);
    console.log(chalk.cyan("\nConstraints:"));
    for (const c of plan.constraints) console.log(`  ${chalk.gray("-")} ${wrapText(c, 4, cols)}`);
    console.log(chalk.cyan("\nDefinition of Done:"));
    for (const d of plan.dod) console.log(`  ${chalk.gray("-")} ${wrapText(d, 4, cols)}`);
  } catch (err) {
    if (err instanceof ExitPromptError) {
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
