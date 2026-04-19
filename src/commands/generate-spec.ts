import { createInterface } from "node:readline/promises";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import chalk from "chalk";
import ora from "ora";
import { isDebug } from "../debug.js";
import { generateSpec } from "../generate-spec.js";
import { TaskError } from "../task.js";

async function prompt(question: string, fallback?: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(question);
    return answer.trim() || fallback || "";
  } finally {
    rl.close();
  }
}

export async function generateSpecCommand(
  description: string | undefined,
  options: { output?: string },
): Promise<void> {
  try {
    if (!description) {
      description = await prompt("Feature description: ");
      if (!description) {
        console.log(chalk.red.bold("Error:"), "Description is required.");
        process.exit(1);
      }
    }

    let output = options.output;
    if (!output) {
      output = await prompt("Output file path (spec.md): ", "spec.md");
    }

    const spinner = ora(chalk.blue("Generating spec...")).start();

    let markdown: string;
    try {
      markdown = await generateSpec(description);
      spinner.succeed(chalk.green("Spec generated"));
    } catch (err) {
      spinner.fail(chalk.red("Failed to generate spec"));
      throw err;
    }

    const outPath = resolve(process.cwd(), output);
    writeFileSync(outPath, markdown, "utf-8");
    console.log(chalk.gray("Spec written to"), chalk.cyan(outPath));
  } catch (err) {
    if (err instanceof TaskError) {
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
