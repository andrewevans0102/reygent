import Table from "cli-table3";
import chalk from "chalk";
import type { StorageBackend } from "../chesstrace/backends/types.js";
import { formatRelativeTime, formatDuration, parseSince } from "./utils.js";

export interface RunsListOptions {
  limit?: number;
  since?: string;
}

export interface RunsListResult {
  runs: RunSummaryRow[];
  table: string;
}

export interface RunSummaryRow {
  runId: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  status: "success" | "failure" | "incomplete";
  agentCount: number;
  errorCount: number;
  categories: string[];
}

/**
 * Get runs list with summary information
 */
export async function getRunsList(
  backend: StorageBackend,
  options: RunsListOptions = {}
): Promise<RunsListResult> {
  const limit = options.limit ?? 50;
  const startTime = options.since ? parseSince(options.since) : undefined;

  // Get all runs
  const runs = await backend.listRuns();

  // Filter by time range
  const filtered = startTime
    ? runs.filter((r) => r.startTime >= startTime)
    : runs;

  // Sort by start time descending (newest first)
  const sorted = filtered.sort((a, b) => b.startTime - a.startTime);

  // Limit results
  const limited = sorted.slice(0, limit);

  // Build summary rows
  const summaries = await Promise.all(
    limited.map(async (run) => {
      const events = await backend.query({ runId: run.runId });

      // Determine status
      let status: "success" | "failure" | "incomplete" = "incomplete";
      const commandEnd = events.find((e) => e.event === "command.end");
      const pipelineEnd = events.find((e) => e.event === "pipeline.end");
      const hasErrors = events.some((e) => e.category === "error");

      if (commandEnd || pipelineEnd) {
        status = hasErrors ? "failure" : "success";
      }

      // Count agents
      const agentSpawns = events.filter((e) => e.event === "agent.spawn");
      const agentCount = agentSpawns.length;

      // Count errors
      const errorCount = events.filter((e) => e.category === "error").length;

      // Calculate duration
      const endTime = run.endTime;
      const duration = endTime ? endTime - run.startTime : undefined;

      return {
        runId: run.runId,
        startTime: run.startTime,
        endTime,
        duration,
        status,
        agentCount,
        errorCount,
        categories: Array.from(new Set(events.map((e) => e.category))),
      };
    })
  );

  // Create table
  const table = new Table({
    head: [
      chalk.bold("Run ID"),
      chalk.bold("Started"),
      chalk.bold("Duration"),
      chalk.bold("Status"),
      chalk.bold("Agents"),
      chalk.bold("Errors"),
    ],
    style: { head: [], border: [] },
  });

  for (const row of summaries) {
    const statusColor =
      row.status === "success"
        ? chalk.green
        : row.status === "failure"
          ? chalk.red
          : chalk.yellow;

    table.push([
      chalk.cyan(row.runId.slice(0, 8)),
      formatRelativeTime(row.startTime),
      row.duration ? formatDuration(row.duration) : chalk.gray("—"),
      statusColor(row.status),
      row.agentCount.toString(),
      row.errorCount > 0 ? chalk.red(row.errorCount.toString()) : chalk.gray("0"),
    ]);
  }

  return {
    runs: summaries,
    table: table.toString(),
  };
}
