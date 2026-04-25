import { createInterface } from "node:readline";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import chalk from "chalk";
import ora from "ora";
import { isDebug } from "../debug.js";
import { generateSpec, runClarification } from "../generate-spec.js";
import { TaskError } from "../task.js";

async function prompt(question: string, fallback?: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => {
    rl.question(question, resolve);
  });
  rl.close();
  return answer.trim() || fallback || "";
}

export async function generateSpecCommand(
  description: string | undefined,
  options: { output?: string; skipClarification: boolean },
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

    let clarificationAnswers: string | undefined;

    if (!options.skipClarification) {
      // Clarification loop
      let attempts = 0;
      const maxAttempts = 3;
      let ready = false;

      while (!ready && attempts < maxAttempts) {
        attempts++;
        const spinner = ora(chalk.blue("Checking if clarification needed...")).start();
        const result = await runClarification(description!, clarificationAnswers);

        if ("ready" in result && result.ready) {
          spinner.succeed(chalk.green("No clarification needed"));
          ready = true;
          break;
        }

        if ("needsClarification" in result && result.needsClarification) {
          spinner.stop();
          console.log(chalk.yellow("\nClarifying questions:\n"));

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
              console.log(chalk.red("Aborted."));
              process.exit(0);
            }

            answers.push(`Q: ${question}\nA: ${answer}`);
          }

          rl.close();
          clarificationAnswers = answers.join("\n\n");

          if (attempts < maxAttempts) {
            console.log(chalk.blue("\nRe-checking with your answers...\n"));
          }
        }
      }

      if (!ready && attempts >= maxAttempts) {
        // Exhausted attempts, proceed with answers collected so far
        console.log(chalk.yellow("Max clarification rounds reached, generating spec with answers so far..."));
      }
    }

    const spinner = ora(chalk.blue("Generating spec...")).start();

    let markdown: string;
    try {
      markdown = await generateSpec(description!, clarificationAnswers);
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
