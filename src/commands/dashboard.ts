import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { join } from "node:path";
import { SqliteBackend } from "../chesstrace/backends/sqlite.js";
import { resolveGlobalConfigPath } from "../config.js";
import { getProjectRoot } from "../dashboard/utils.js";
import {
  getRunsList,
  getRunDetail,
  getTrendData,
  getAgentFailures,
  exportToCSV,
  exportToXLSX,
} from "../dashboard/index.js";

/**
 * Dashboard command - visualize telemetry data
 */
export function registerDashboardCommand(program: Command): void {
  const dashboard = program
    .command("dashboard")
    .description("Visualize telemetry data");

  // List runs
  dashboard
    .command("runs")
    .description("List runs with summary information")
    .option("--global", "Use global telemetry scope instead of local")
    .option("--limit <n>", "Maximum runs to display", "50")
    .option("--since <duration>", "Show runs since duration (e.g., 7d, 30d)", "30d")
    .action(async (options) => {
      const spinner = ora("Loading runs...").start();
      try {
        const backend = await loadDashboardBackend(options.global);
        const runs = await getRunsList(backend, {
          limit: parseInt(options.limit, 10),
          since: options.since,
        });

        spinner.stop();

        if (runs.length === 0) {
          console.log(chalk.yellow("No runs found"));
          return;
        }

        console.log(
          chalk.bold(
            `\n${options.global ? "Global" : "Local"} Runs (${runs.length}):\n`
          )
        );
        console.log(runs.table);
      } catch (err) {
        spinner.fail(chalk.red(`Failed: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // Run detail
  dashboard
    .command("run")
    .description("Show detailed information for a specific run")
    .argument("<runId>", "Run ID to display")
    .option("--global", "Use global telemetry scope instead of local")
    .action(async (runId, options) => {
      const spinner = ora("Loading run details...").start();
      try {
        const backend = await loadDashboardBackend(options.global);
        const detail = await getRunDetail(backend, runId);

        spinner.stop();

        if (!detail) {
          console.log(chalk.yellow(`Run ${runId} not found`));
          return;
        }

        console.log(
          chalk.bold(
            `\n${options.global ? "Global" : "Local"} Run Detail: ${runId}\n`
          )
        );
        console.log(detail.summary);
        console.log("\n" + chalk.bold("Events:\n"));
        console.log(detail.events);
      } catch (err) {
        spinner.fail(chalk.red(`Failed: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // Trend visualization
  dashboard
    .command("trends")
    .description("Show success vs failure trends over time")
    .option("--global", "Use global telemetry scope instead of local")
    .option("--since <duration>", "Show trends since duration (e.g., 7d, 30d)", "30d")
    .option("--granularity <unit>", "Time bucket size (day, week)", "day")
    .action(async (options) => {
      const spinner = ora("Analyzing trends...").start();
      try {
        const backend = await loadDashboardBackend(options.global);
        const trends = await getTrendData(backend, {
          since: options.since,
          granularity: options.granularity,
        });

        spinner.stop();

        if (trends.buckets.length === 0) {
          console.log(chalk.yellow("No trend data available"));
          return;
        }

        console.log(
          chalk.bold(
            `\n${options.global ? "Global" : "Local"} Success vs Failure Trends:\n`
          )
        );
        console.log(trends.chart);
        console.log("\n" + chalk.bold("Summary:\n"));
        console.log(trends.summary);
      } catch (err) {
        spinner.fail(chalk.red(`Failed: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // Agent failures
  dashboard
    .command("agent-failures")
    .description("Drill down into agent-level failures")
    .option("--global", "Use global telemetry scope instead of local")
    .option("--since <duration>", "Show failures since duration (e.g., 7d, 30d)", "30d")
    .option("--limit <n>", "Maximum agents to display", "10")
    .action(async (options) => {
      const spinner = ora("Analyzing agent failures...").start();
      try {
        const backend = await loadDashboardBackend(options.global);
        const failures = await getAgentFailures(backend, {
          since: options.since,
          limit: parseInt(options.limit, 10),
        });

        spinner.stop();

        if (failures.agents.length === 0) {
          console.log(chalk.yellow("No agent failures found"));
          return;
        }

        console.log(
          chalk.bold(
            `\n${options.global ? "Global" : "Local"} Agent Failures:\n`
          )
        );
        console.log(failures.table);
        console.log("\n" + chalk.bold("Top Error Types:\n"));
        console.log(failures.errorBreakdown);
      } catch (err) {
        spinner.fail(chalk.red(`Failed: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // Export
  dashboard
    .command("export")
    .description("Export telemetry data to CSV or XLSX")
    .option("--global", "Use global telemetry scope instead of local")
    .option("--format <type>", "Export format (csv, xlsx)", "csv")
    .option("--run <runId>", "Export specific run (otherwise export all)")
    .option("--since <duration>", "Export runs since duration (e.g., 7d, 30d)", "30d")
    .option("--output <file>", "Output file path (auto-generated if not provided)")
    .action(async (options) => {
      const spinner = ora("Exporting telemetry...").start();
      try {
        const backend = await loadDashboardBackend(options.global);
        const scope = options.global ? "global" : "local";

        let filepath: string;
        if (options.format === "xlsx") {
          filepath = await exportToXLSX(backend, {
            scope,
            runId: options.run,
            since: options.since,
            output: options.output,
          });
        } else {
          filepath = await exportToCSV(backend, {
            scope,
            runId: options.run,
            since: options.since,
            output: options.output,
          });
        }

        spinner.succeed(chalk.green(`Exported to ${filepath}`));
      } catch (err) {
        spinner.fail(chalk.red(`Failed: ${(err as Error).message}`));
        process.exit(1);
      }
    });
}

/**
 * Load backend based on scope (local or global)
 */
async function loadDashboardBackend(useGlobal: boolean) {
  if (useGlobal) {
    // Use global backend
    const globalDir = resolveGlobalConfigPath();
    const dbPath = join(globalDir, "chesstrace.db");
    const backend = new SqliteBackend(dbPath);
    await backend.init();
    return backend;
  } else {
    // Use local backend (project-specific)
    const projectRoot = await getProjectRoot();
    const dbPath = join(projectRoot, ".reygent", "chesstrace.db");
    const backend = new SqliteBackend(dbPath);
    await backend.init();
    return backend;
  }
}
