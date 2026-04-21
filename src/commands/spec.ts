import { createInterface } from "node:readline";
import chalk from "chalk";
import ora from "ora";
import { isDebug } from "../debug.js";
import { loadSpec, SpecError } from "../spec.js";
import { runPlanner } from "../planner.js";
import { TaskError } from "../task.js";
import type { PlannerOutput } from "../task.js";

interface SpecCommandOptions {
  clarify?: boolean;
}

export async function specCommand(source: string, options: SpecCommandOptions): Promise<void> {
  try {
    const spec = await loadSpec(source);

    if (!options.clarify) {
      // Original behavior: just output spec JSON
      console.log(JSON.stringify(spec, null, 2));
      return;
    }

    // Run planner with clarification loop
    const spinner = ora(chalk.blue("running planner...")).start();

    let plan: PlannerOutput | null = null;
    let clarificationAnswers = "";
    let attempts = 0;
    const maxAttempts = 3;

    while (!plan && attempts < maxAttempts) {
      attempts++;
      const { result } = await runPlanner(spec, clarificationAnswers);

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
      throw new TaskError(`Planner: failed to create valid plan after ${maxAttempts} attempts`);
    }

    spinner.succeed(chalk.green("Plan created"));

    console.log(chalk.cyan("\nGoals:"));
    for (const g of plan.goals) console.log(`  ${chalk.gray("-")} ${g}`);
    console.log(chalk.cyan("\nTasks:"));
    for (const t of plan.tasks) console.log(`  ${chalk.gray("-")} ${t}`);
    console.log(chalk.cyan("\nConstraints:"));
    for (const c of plan.constraints) console.log(`  ${chalk.gray("-")} ${c}`);
    console.log(chalk.cyan("\nDefinition of Done:"));
    for (const d of plan.dod) console.log(`  ${chalk.gray("-")} ${d}`);
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
