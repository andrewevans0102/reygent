import Table from "cli-table3";
import chalk from "chalk";
import type { StorageBackend } from "../chesstrace/backends/types.js";
import {
  formatRelativeTime,
  formatDuration,
  parseSince,
  deriveRunStatus,
} from "./utils.js";

export interface RunsListOptions {
  limit?: number;
  since?: string;
  withAgents?: boolean;
  /**
   * When true, runs with errors that fall outside the limit window are still
   * included in the result. The runs list is no longer guaranteed to be
   * exactly `limit` items long.
   */
  includeErrors?: boolean;
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

  // Build summary rows (before limiting, so we can filter by agent count)
  const summaries = await Promise.all(
    sorted.map(async (run) => {
      const events = await backend.query({ runId: run.runId });

      const status = deriveRunStatus(events);

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

  // Filter by agent count if requested
  const agentFiltered = options.withAgents
    ? summaries.filter((s) => s.agentCount > 0)
    : summaries;

  // Limit results after filtering. When includeErrors is set, also append any
  // runs with errors that fall outside the limit window — otherwise the
  // dashboard's "Failures" filter and agent-failure drill-down can reference
  // runs that aren't in the visible list.
  const topN = agentFiltered.slice(0, limit);
  let limited = topN;
  if (options.includeErrors) {
    const topIds = new Set(topN.map((s) => s.runId));
    const extraErrors = agentFiltered.filter(
      (s) => s.errorCount > 0 && !topIds.has(s.runId)
    );
    if (extraErrors.length > 0) {
      limited = [...topN, ...extraErrors];
    }
  }

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

  for (const row of limited) {
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
    runs: limited,
    table: table.toString(),
  };
}
