import { createInterface } from "node:readline/promises";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
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
        console.error("Description is required.");
        process.exit(1);
      }
    }

    let output = options.output;
    if (!output) {
      output = await prompt("Output file path (spec.md): ", "spec.md");
    }

    const spinner = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    let i = 0;
    const interval = setInterval(() => {
      process.stdout.write(`\r${spinner[i++ % spinner.length]} Generating spec...`);
    }, 80);

    let markdown: string;
    try {
      markdown = await generateSpec(description);
    } finally {
      clearInterval(interval);
      process.stdout.write("\r\x1b[K");
    }

    const outPath = resolve(process.cwd(), output);
    writeFileSync(outPath, markdown, "utf-8");
    console.log(`Spec written to ${outPath}`);
  } catch (err) {
    if (err instanceof TaskError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}
