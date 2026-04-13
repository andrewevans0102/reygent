import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateSpec } from "../generate-spec.js";
import { TaskError } from "../task.js";

export async function generateSpecCommand(
  description: string,
  options: { output: string },
): Promise<void> {
  try {
    const markdown = await generateSpec(description);
    const outPath = resolve(process.cwd(), options.output);
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
