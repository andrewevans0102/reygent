import { Command } from "commander";
import { readFileSync, statSync } from "node:fs";
import { writeFileSync } from "node:fs";
import chalk from "chalk";
import ora from "ora";
import Table from "cli-table3";
import { loadConfig, resolveGlobalConfigPath, findLocalConfigDir } from "../config.js";
import { SqliteBackend } from "../chesstrace/backends/sqlite.js";
import type { TelemetryEvent } from "../chesstrace/events.js";
import { join } from "node:path";

/**
 * Validate UUID format
 */
function isValidUuid(value: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(value);
}

/**
 * Parse duration string like "30d", "7d", "1d" into days
 */
function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)d$/);
  if (!match) {
    throw new Error(`Invalid duration format: ${duration}. Use format like "30d", "7d", "1d".`);
  }
  return Number.parseInt(match[1], 10);
}

/**
 * Format bytes to human-readable size
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

/**
 * Format timestamp to human-readable date
 */
function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
}

/**
 * Format duration in milliseconds to human-readable string
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

/**
 * Get database size in bytes
 */
function getDbSize(dbPath: string): number {
  try {
    const stats = statSync(dbPath);
    return stats.size;
  } catch {
    return 0;
  }
}

/**
 * reygent telemetry status - show config, run count, DB size
 */
async function statusCommand() {
  const spinner = ora("Loading telemetry status...").start();

  try {
    const config = loadConfig();
    const telemetryConfig = config.telemetry;

    if (!telemetryConfig) {
      spinner.fail(chalk.red("Telemetry configuration not found"));
      return;
    }

    // Initialize backend to get database info
    const backendType = telemetryConfig.backend === "sqlite" ? "local" : "local";
    const backend = new SqliteBackend(backendType);
    await backend.init();

    const runs = await backend.listRuns();
    const dbPath = backend.getDbPath();
    const dbSize = getDbSize(dbPath);

    await backend.close();

    spinner.succeed(chalk.green("Telemetry status loaded"));

    console.log();
    console.log(chalk.bold("Telemetry Configuration"));
    console.log(`  Enabled:    ${telemetryConfig.enabled === undefined ? chalk.yellow("unset (will prompt)") : telemetryConfig.enabled ? chalk.green("yes") : chalk.red("no")}`);
    console.log(`  Level:      ${chalk.cyan(telemetryConfig.level)}`);
    console.log(`  Backend:    ${chalk.cyan(telemetryConfig.backend)}`);
    console.log(`  Retention:  ${chalk.cyan(`${telemetryConfig.retention} days`)}`);

    console.log();
    console.log(chalk.bold("Storage"));
    console.log(`  Database:   ${chalk.gray(dbPath)}`);
    console.log(`  Size:       ${chalk.cyan(formatBytes(dbSize))}`);
    console.log(`  Runs:       ${chalk.cyan(runs.length.toString())}`);
  } catch (err) {
    spinner.fail(chalk.red(`Failed to load telemetry status: ${(err as Error).message}`));
    process.exit(1);
  }
}

/**
 * reygent telemetry runs [--limit N] - list recent runs (table format)
 */
async function runsCommand(options: { limit?: string }) {
  const spinner = ora("Loading telemetry runs...").start();

  try {
    const config = loadConfig();
    const backendType = config.telemetry?.backend === "sqlite" ? "local" : "local";
    const backend = new SqliteBackend(backendType);
    await backend.init();

    const allRuns = await backend.listRuns();
    await backend.close();

    let limit = allRuns.length;
    if (options.limit) {
      const parsed = Number.parseInt(options.limit, 10);
      if (isNaN(parsed) || parsed < 1) {
        spinner.fail(chalk.red(`Invalid limit: ${options.limit}. Must be positive integer.`));
        process.exit(1);
      }
      limit = parsed;
    }
    const runs = allRuns.slice(0, limit);

    spinner.succeed(chalk.green(`Loaded ${runs.length} run(s)`));

    if (runs.length === 0) {
      console.log(chalk.yellow("\nNo telemetry runs found"));
      return;
    }

    console.log();
    const table = new Table({
      head: [
        chalk.cyan("Run ID"),
        chalk.cyan("Start Time"),
        chalk.cyan("Duration"),
        chalk.cyan("Events"),
        chalk.cyan("Categories"),
      ],
      colWidths: [38, 20, 12, 10, 30],
    });

    for (const run of runs) {
      const duration = run.endTime - run.startTime;
      table.push([
        run.runId,
        formatTimestamp(run.startTime),
        formatDuration(duration),
        run.eventCount.toString(),
        run.categories.join(", "),
      ]);
    }

    console.log(table.toString());
  } catch (err) {
    spinner.fail(chalk.red(`Failed to load runs: ${(err as Error).message}`));
    process.exit(1);
  }
}

/**
 * reygent telemetry show <runId> - detailed chronological event log
 */
async function showCommand(runId: string) {
  if (!isValidUuid(runId)) {
    console.error(chalk.red(`Invalid run ID format: ${runId}. Must be valid UUID.`));
    process.exit(1);
  }

  const spinner = ora(`Loading events for run ${runId}...`).start();

  try {
    const config = loadConfig();
    const backendType = config.telemetry?.backend === "sqlite" ? "local" : "local";
    const backend = new SqliteBackend(backendType);
    await backend.init();

    const events = await backend.query({ runId });
    await backend.close();

    if (events.length === 0) {
      spinner.fail(chalk.yellow(`No events found for run ${runId}`));
      return;
    }

    spinner.succeed(chalk.green(`Loaded ${events.length} event(s) for run ${runId}`));

    console.log();
    console.log(chalk.bold(`Events for run ${runId}`));
    console.log(chalk.gray(`Total events: ${events.length}`));
    console.log();

    for (const event of events) {
      const timestamp = formatTimestamp(event.timestamp);
      const category = chalk.cyan(`[${event.category}]`);
      const eventName = chalk.bold(event.event);
      const dataStr = Object.keys(event.data).length > 0 ? JSON.stringify(event.data, null, 2) : "";

      console.log(`${chalk.gray(timestamp)} ${category} ${eventName}`);
      if (dataStr) {
        // Apply gray color to entire data block for visual distinction
        const grayData = dataStr.split('\n').map(line => chalk.gray(line)).join('\n');
        console.log(grayData);
      }
      console.log();
    }
  } catch (err) {
    spinner.fail(chalk.red(`Failed to load events: ${(err as Error).message}`));
    process.exit(1);
  }
}

/**
 * Export event data as JSON
 */
function exportJson(events: TelemetryEvent[]): string {
  return JSON.stringify(events, null, 2);
}

/**
 * Export event data as CSV
 */
function exportCsv(events: TelemetryEvent[]): string {
  const lines: string[] = [];
  lines.push("id,runId,timestamp,category,event,minLevel,data");

  for (const event of events) {
    const dataStr = JSON.stringify(event.data).replace(/"/g, '""');
    lines.push(
      `"${event.id}","${event.runId}","${event.timestamp}","${event.category}","${event.event}","${event.minLevel}","${dataStr}"`,
    );
  }

  return lines.join("\n");
}

/**
 * reygent telemetry export <runId> [--format json|csv] - export run data
 */
async function exportCommand(runId: string, options: { format?: string; output?: string }) {
  if (!isValidUuid(runId)) {
    console.error(chalk.red(`Invalid run ID format: ${runId}. Must be valid UUID.`));
    process.exit(1);
  }

  const format = options.format ?? "json";
  const spinner = ora(`Exporting run ${runId} as ${format.toUpperCase()}...`).start();

  try {
    const config = loadConfig();
    const backendType = config.telemetry?.backend === "sqlite" ? "local" : "local";
    const backend = new SqliteBackend(backendType);
    await backend.init();

    const events = await backend.query({ runId });
    await backend.close();

    if (events.length === 0) {
      spinner.fail(chalk.yellow(`No events found for run ${runId}`));
      return;
    }

    const data = format === "json" ? exportJson(events) : exportCsv(events);

    if (options.output) {
      writeFileSync(options.output, data, "utf-8");
      spinner.succeed(chalk.green(`Exported ${events.length} events to ${options.output}`));
    } else {
      spinner.succeed(chalk.green(`Exported ${events.length} events`));
      console.log();
      console.log(data);
    }
  } catch (err) {
    spinner.fail(chalk.red(`Failed to export run: ${(err as Error).message}`));
    process.exit(1);
  }
}

/**
 * reygent telemetry prune [--older-than 30d] - delete old data
 */
async function pruneCommand(options: { olderThan?: string }) {
  const duration = options.olderThan ?? "30d";
  const days = parseDuration(duration);

  const spinner = ora(`Pruning events older than ${days} days...`).start();

  try {
    const config = loadConfig();
    const backendType = config.telemetry?.backend === "sqlite" ? "local" : "local";
    const backend = new SqliteBackend(backendType);
    await backend.init();

    const olderThan = Date.now() - days * 24 * 60 * 60 * 1000;
    const deleted = await backend.prune(olderThan);

    await backend.close();

    spinner.succeed(chalk.green(`Pruned ${deleted} event(s) older than ${days} days`));
    console.log(chalk.gray(`Deleted ${deleted} event(s) older than ${days} days`));
  } catch (err) {
    spinner.fail(chalk.red(`Failed to prune events: ${(err as Error).message}`));
    process.exit(1);
  }
}

/**
 * reygent telemetry enable - enable telemetry in config
 */
async function enableCommand() {
  const spinner = ora("Enabling telemetry...").start();

  try {
    // Check for local config first
    const localConfigDir = findLocalConfigDir(process.cwd());
    const configPath = localConfigDir
      ? join(localConfigDir, "config.json")
      : resolveGlobalConfigPath();

    const config = loadConfig();

    config.telemetry = config.telemetry ?? {
      level: "standard",
      backend: "sqlite",
      retention: 30,
    };
    config.telemetry.enabled = true;

    writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");

    const scope = localConfigDir ? "local" : "global";
    spinner.succeed(chalk.green(`Telemetry enabled (${scope} config)`));
  } catch (err) {
    spinner.fail(chalk.red(`Failed to enable telemetry: ${(err as Error).message}`));
    process.exit(1);
  }
}

/**
 * reygent telemetry disable - disable telemetry in config
 */
async function disableCommand() {
  const spinner = ora("Disabling telemetry...").start();

  try {
    // Check for local config first
    const localConfigDir = findLocalConfigDir(process.cwd());
    const configPath = localConfigDir
      ? join(localConfigDir, "config.json")
      : resolveGlobalConfigPath();

    const config = loadConfig();

    config.telemetry = config.telemetry ?? {
      level: "standard",
      backend: "sqlite",
      retention: 30,
    };
    config.telemetry.enabled = false;

    writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");

    const scope = localConfigDir ? "local" : "global";
    spinner.succeed(chalk.green(`Telemetry disabled (${scope} config)`));
  } catch (err) {
    spinner.fail(chalk.red(`Failed to disable telemetry: ${(err as Error).message}`));
    process.exit(1);
  }
}

/**
 * Register telemetry command and subcommands
 */
export function registerTelemetryCommand(program: Command): void {
  const telemetry = program
    .command("telemetry")
    .description("Manage telemetry data and configuration");

  telemetry
    .command("status")
    .description("Show telemetry configuration and storage status")
    .action(statusCommand);

  telemetry
    .command("runs")
    .description("List recent telemetry runs")
    .option("--limit <n>", "Limit number of runs to display")
    .action(runsCommand);

  telemetry
    .command("show")
    .description("Show detailed event log for a specific run")
    .argument("<runId>", "Run ID to display")
    .action(showCommand);

  telemetry
    .command("export")
    .description("Export run data to JSON or CSV")
    .argument("<runId>", "Run ID to export")
    .addOption(
      program
        .createOption("--format <type>", "Export format")
        .choices(["json", "csv"])
        .default("json")
    )
    .option("--output <file>", "Output file path (prints to stdout if omitted)")
    .action(exportCommand);

  telemetry
    .command("prune")
    .description("Delete old telemetry data")
    .option("--older-than <duration>", "Delete events older than duration (e.g., 30d, 7d)", "30d")
    .action(pruneCommand);

  telemetry
    .command("enable")
    .description("Enable telemetry in configuration")
    .action(enableCommand);

  telemetry
    .command("disable")
    .description("Disable telemetry in configuration")
    .action(disableCommand);
}
