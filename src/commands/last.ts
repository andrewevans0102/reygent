import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import Table from "cli-table3";
import { loadConfig } from "../config.js";
import { SqliteBackend } from "../chesstrace/backends/sqlite.js";
import type { TelemetryEvent } from "../chesstrace/events.js";
import { Events } from "../chesstrace/events.js";
import { getLocalTelemetryPath } from "../telemetry-path.js";

interface LastOptions {
  verbose?: boolean;
  output?: boolean;
  errors?: boolean;
  json?: boolean;
}

/**
 * Format timestamp to readable date
 */
function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
}

/**
 * Format duration in milliseconds
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

/**
 * Format USD cost
 */
function formatCost(usd: number): string {
  return `$${usd.toFixed(4)}`;
}

/**
 * Check if telemetry is enabled
 */
function checkTelemetryEnabled(config: ReturnType<typeof loadConfig>): void {
  if (!config.telemetry?.enabled) {
    console.log(chalk.yellow("\nTelemetry disabled. Enable with:"));
    console.log(chalk.cyan("  reygent telemetry enable\n"));
    process.exit(1);
  }
}

/**
 * Display quick summary of latest run
 */
function displaySummary(runId: string, events: TelemetryEvent[]): void {
  const pipelineEnd = events.find(e => e.event === Events.PIPELINE_END);
  const commandEnd = events.find(e => e.event === Events.COMMAND_END);
  const pipelineStart = events.find(e => e.event === Events.PIPELINE_START);
  const errorEvents = events.filter(e => e.category === "error");
  const costEvents = events.filter(e => e.event === Events.USAGE_COST);
  const agentSpawns = events.filter(e => e.event === Events.AGENT_SPAWN);

  const success = pipelineEnd?.data.success === true || (!pipelineEnd && commandEnd?.data.success === true);
  const startTime = pipelineStart?.timestamp ?? events[0]?.timestamp ?? 0;
  const endTime = pipelineEnd?.timestamp ?? events[events.length - 1]?.timestamp ?? 0;
  const duration = endTime - startTime;

  const totalCost = costEvents.reduce((sum, e) => sum + (e.data.costUsd as number), 0);
  const agents = [...new Set(agentSpawns.map(e => e.data.agent as string))];

  console.log();
  console.log(chalk.bold("Latest Run Summary"));
  console.log();
  console.log(`  Run ID:    ${chalk.cyan(runId.substring(0, 8))}`);
  console.log(`  Status:    ${success ? chalk.green("Success") : chalk.red("Failed")}`);
  console.log(`  Started:   ${chalk.gray(formatTimestamp(startTime))}`);
  console.log(`  Duration:  ${formatDuration(duration)}`);
  console.log(`  Agents:    ${agents.join(", ") || "none"}`);

  if (totalCost > 0) {
    console.log(`  Cost:      ${formatCost(totalCost)}`);
  }

  if (errorEvents.length > 0) {
    console.log();
    console.log(chalk.red(`  Errors:    ${errorEvents.length} error(s)`));

    const errorSummary = errorEvents.slice(0, 3).map(e => {
      const msg = e.data.message as string || e.event;
      return `    • ${msg}`;
    }).join("\n");
    console.log(errorSummary);

    if (errorEvents.length > 3) {
      console.log(`    ... and ${errorEvents.length - 3} more`);
    }
  }

  console.log();
}

/**
 * Display verbose details
 */
function displayVerbose(runId: string, events: TelemetryEvent[]): void {
  console.log();
  console.log(chalk.bold(`Detailed Event Log (${events.length} events)`));
  console.log();

  const table = new Table({
    head: [
      chalk.cyan("Time"),
      chalk.cyan("Category"),
      chalk.cyan("Event"),
      chalk.cyan("Details"),
    ],
    colWidths: [20, 15, 30, 50],
    wordWrap: true,
  });

  for (const event of events) {
    const timestamp = formatTimestamp(event.timestamp);
    const details = Object.keys(event.data).length > 0
      ? JSON.stringify(event.data).substring(0, 100)
      : "";

    table.push([
      chalk.gray(timestamp),
      event.category,
      event.event,
      chalk.gray(details),
    ]);
  }

  console.log(table.toString());
  console.log();
}

/**
 * Display only output
 */
function displayOutput(events: TelemetryEvent[]): void {
  const pipelineEnd = events.find(e => e.event === Events.PIPELINE_END);
  const agentCompletes = events.filter(e => e.event === Events.AGENT_COMPLETE);

  console.log();
  console.log(chalk.bold("Run Output"));
  console.log();

  if (pipelineEnd?.data.output) {
    console.log(pipelineEnd.data.output);
  } else if (agentCompletes.length > 0) {
    for (const complete of agentCompletes) {
      const agent = complete.data.agent as string;
      const output = complete.data.output as string;
      if (output) {
        console.log(chalk.cyan(`[${agent}]`));
        console.log(output);
        console.log();
      }
    }
  } else {
    console.log(chalk.yellow("No output captured"));
  }

  console.log();
}

/**
 * Display only errors
 */
function displayErrors(events: TelemetryEvent[]): void {
  const errorEvents = events.filter(e => e.category === "error");

  console.log();
  console.log(chalk.bold(`Errors (${errorEvents.length})`));
  console.log();

  if (errorEvents.length === 0) {
    console.log(chalk.green("No errors in this run"));
    console.log();
    return;
  }

  for (const error of errorEvents) {
    const timestamp = formatTimestamp(error.timestamp);
    const message = error.data.message as string || "Unknown error";
    const agent = error.data.agent as string || "unknown";

    console.log(chalk.gray(timestamp) + chalk.red(` [${error.event}]`) + ` ${agent}`);
    console.log(`  ${message}`);

    if (error.data.stack) {
      console.log(chalk.gray(`  ${error.data.stack}`));
    }
    console.log();
  }
}

/**
 * Output as JSON
 */
function displayJson(runId: string, events: TelemetryEvent[]): void {
  const output = {
    runId,
    eventCount: events.length,
    events,
  };
  console.log(JSON.stringify(output, null, 2));
}

/**
 * Internal implementation for testing
 */
export async function lastCommandImpl(
  options: LastOptions,
  testBackend?: SqliteBackend
): Promise<void> {
  const spinner = ora("Loading latest run...").start();

  try {
    const config = loadConfig();
    checkTelemetryEnabled(config);

    // Determine backend path - match writer path from run.ts
    const backend = testBackend ?? new SqliteBackend("local", getLocalTelemetryPath(process.cwd()));
    if (!testBackend) {
      await backend.init();
    }

    const runs = await backend.listRuns();

    if (runs.length === 0) {
      spinner.fail(chalk.yellow("No telemetry runs found"));
      console.log(chalk.gray("\nRun a reygent command to generate telemetry data"));
      if (!testBackend) {
        await backend.close();
      }
      return;
    }

    const latestRun = runs[0];
    const events = await backend.query({ runId: latestRun.runId });

    if (!testBackend) {
      await backend.close();
    }

    spinner.succeed(chalk.green(`Loaded latest run: ${latestRun.runId.substring(0, 8)}`));

    // Display based on options
    if (options.json) {
      displayJson(latestRun.runId, events);
    } else if (options.output) {
      displayOutput(events);
    } else if (options.errors) {
      displayErrors(events);
    } else if (options.verbose) {
      displayVerbose(latestRun.runId, events);
    } else {
      displaySummary(latestRun.runId, events);
    }

  } catch (err) {
    spinner.fail(chalk.red(`Failed to load latest run: ${(err as Error).message}`));
    process.exit(1);
  }
}

/**
 * CLI command wrapper
 */
export async function lastCommand(options: LastOptions): Promise<void> {
  return lastCommandImpl(options);
}

/**
 * Register last command
 */
export function registerLastCommand(program: Command): void {
  program
    .command("last")
    .description("Show details of the most recent run")
    .option("--verbose", "Show full event log with timestamps and details", false)
    .option("--output", "Show only the final output from the run", false)
    .option("--errors", "Show only errors from the run", false)
    .option("--json", "Output as JSON for machine parsing", false)
    .action(lastCommand);
}
