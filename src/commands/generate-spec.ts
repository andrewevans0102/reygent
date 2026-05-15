import { createInterface } from "node:readline";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import chalk from "chalk";
import { isDebug } from "../debug.js";
import { generateSpec, runClarification } from "../generate-spec.js";
import { createLiveStatus } from "../live-status.js";
import { TaskError } from "../task.js";
import { resetTerminalForInput } from "../terminal-reset.js";
import { withTelemetry } from "../telemetry-lifecycle.js";
import { wrapText } from "../format.js";

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
  return withTelemetry('generate-spec', async () => {
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
        const clarifyStatus = createLiveStatus("Checking if clarification needed...");

        let result: Awaited<ReturnType<typeof runClarification>>;
        try {
          result = await runClarification(description!, clarificationAnswers, clarifyStatus.onActivity);
        } catch (err) {
          clarifyStatus.fail(chalk.red("Failed to check clarification needs"));
          if (err instanceof TaskError) {
            throw err;
          }
          const message = err instanceof Error ? err.message : String(err);
          throw new TaskError(`Clarification check failed: ${message}`);
        }

        if ("ready" in result && result.ready) {
          clarifyStatus.succeed(chalk.green("No clarification needed"));
          ready = true;
          break;
        }

        if ("needsClarification" in result && result.needsClarification) {
          clarifyStatus.stop();
          resetTerminalForInput();
          console.log(chalk.yellow("\n━━━ Clarifying Questions ━━━\n"));

          const answers: string[] = [];
          const rl = createInterface({
            input: process.stdin,
            output: process.stdout,
          });

          const termWidth = Math.max(process.stdout.columns || 80, 40);

          try {
            for (let i = 0; i < result.questions.length; i++) {
              const question = result.questions[i];

              // Add empty line before first question for consistency
              if (i === 0) {
                console.log();
              }

              const counter = chalk.cyan(`Question ${i + 1} of ${result.questions.length}`);
              console.log(counter);

              // Wrap question text to terminal width with 2-space indent
              const wrapped = wrapText(question, 2, termWidth, "  ");
              console.log(`  ${wrapped}`);

              const answer = await new Promise<string>((resolve) => {
                rl.question(chalk.gray("> "), resolve);
              });

              if (answer.trim().toLowerCase() === "abort" || answer.trim().toLowerCase() === "cancel") {
                console.log(chalk.red("\nAborted."));
                process.exit(0);
              }

              answers.push(`Q: ${question}\nA: ${answer}`);

              // Add spacing between questions except after last one
              if (i < result.questions.length - 1) {
                console.log();
              }
            }
          } finally {
            rl.close();
          }

          clarificationAnswers = answers.join("\n\n");

          if (attempts < maxAttempts) {
            console.log(chalk.blue("\n━━━ Re-checking with your answers ━━━\n"));
          }
        }
      }

      if (!ready && attempts >= maxAttempts) {
        // Exhausted attempts, proceed with answers collected so far
        console.log(chalk.yellow("Max clarification rounds reached, generating spec with answers so far..."));
      }
    }

    const genStatus = createLiveStatus("Generating spec...");

    let markdown: string;
    try {
      markdown = await generateSpec(description!, clarificationAnswers, genStatus.onActivity);
      genStatus.succeed(chalk.green("Spec generated"));
    } catch (err) {
      genStatus.fail(chalk.red("Failed to generate spec"));
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
  });
}
