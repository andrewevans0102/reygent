import { runImplement } from "../implement.js";
import { runPlanner } from "../planner.js";
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
      if (stage.name === "plan") {
        console.log(`[${stage.name}] running planner...`);
        const plan = await runPlanner(context.spec);
        context.plan = plan;

        console.log(`[${stage.name}] goals:`);
        for (const g of plan.goals) console.log(`  - ${g}`);
        console.log(`[${stage.name}] tasks:`);
        for (const t of plan.tasks) console.log(`  - ${t}`);
        console.log(`[${stage.name}] constraints:`);
        for (const c of plan.constraints) console.log(`  - ${c}`);
        console.log(`[${stage.name}] definition of done:`);
        for (const d of plan.dod) console.log(`  - ${d}`);

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

        console.log(`[${stage.name}] spawning dev and qe agents...`);
        const impl = await runImplement(context.spec, context.plan);
        context.implement = impl;

        const devSuccess = impl.dev !== null;
        const qeSuccess = impl.qe !== null;

        if (impl.dev) {
          console.log(`[${stage.name}] dev files: ${impl.dev.files.join(", ") || "(none)"}`);
        }
        if (impl.qe) {
          console.log(`[${stage.name}] qe test files: ${impl.qe.testFiles.join(", ") || "(none)"}`);
        }

        context.results.push({
          stage: stage.name,
          success: devSuccess && qeSuccess,
          output: JSON.stringify(impl),
        });
        continue;
      }

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
