import { loadSpec, SpecError } from "../spec.js";
import { PIPELINE, TaskError } from "../task.js";
import type { StageResult, TaskContext } from "../task.js";

interface RunOptions {
  spec: string;
  dryRun: boolean;
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

    const context: TaskContext = { spec, results: [] };

    for (const stage of PIPELINE) {
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
