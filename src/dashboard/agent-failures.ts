import Table from "cli-table3";
import chalk from "chalk";
import type { TelemetryBackend } from "../chesstrace/backends/types.js";
import { parseSince } from "./utils.js";

export interface AgentFailuresOptions {
  since?: string;
  limit?: number;
}

export interface AgentFailuresResult {
  agents: AgentFailureSummary[];
  table: string;
  errorBreakdown: string;
}

export interface AgentFailureSummary {
  agent: string;
  failureCount: number;
  runIds: string[];
  errorTypes: Map<string, number>;
  lastSeen: number;
}

/**
 * Get agent-level failure drill-down
 */
export async function getAgentFailures(
  backend: TelemetryBackend,
  options: AgentFailuresOptions = {}
): Promise<AgentFailuresResult> {
  const startTime = options.since ? parseSince(options.since) : undefined;
  const limit = options.limit ?? 10;

  // Get all runs
  const runs = await backend.listRuns();

  // Filter by time range
  const filtered = startTime
    ? runs.filter((r) => r.startTime >= startTime)
    : runs;

  // Track agent failures
  const agentFailures = new Map<string, AgentFailureSummary>();
  const allErrorTypes = new Map<string, number>();

  for (const run of filtered) {
    const events = await backend.queryEvents({ runId: run.runId });

    // Find agent spawns and errors
    const agentSpawns = events.filter((e) => e.event === "agent.spawn");
    const errors = events.filter((e) => e.category === "error");

    if (errors.length === 0) {
      continue; // No failures in this run
    }

    // For each agent spawn, check if there are errors after it
    for (const spawn of agentSpawns) {
      const agentName = spawn.data.agent as string;
      if (!agentName) continue;

      // Find errors that occurred after this agent spawned
      const agentErrors = errors.filter((e) => e.timestamp > spawn.timestamp);

      if (agentErrors.length === 0) {
        continue; // No errors for this agent
      }

      // Initialize agent failure summary if needed
      if (!agentFailures.has(agentName)) {
        agentFailures.set(agentName, {
          agent: agentName,
          failureCount: 0,
          runIds: [],
          errorTypes: new Map(),
          lastSeen: 0,
        });
      }

      const summary = agentFailures.get(agentName)!;
      summary.failureCount++;
      summary.runIds.push(run.runId);
      summary.lastSeen = Math.max(summary.lastSeen, spawn.timestamp);

      // Track error types
      for (const error of agentErrors) {
        const errorType = error.event; // e.g., "error.task", "error.provider"
        summary.errorTypes.set(
          errorType,
          (summary.errorTypes.get(errorType) ?? 0) + 1
        );
        allErrorTypes.set(errorType, (allErrorTypes.get(errorType) ?? 0) + 1);
      }
    }
  }

  // Convert to sorted array (by failure count descending)
  const agentArray = Array.from(agentFailures.values()).sort(
    (a, b) => b.failureCount - a.failureCount
  );

  // Limit results
  const limited = agentArray.slice(0, limit);

  // Create agents table
  const agentsTable = new Table({
    head: [
      chalk.bold("Agent"),
      chalk.bold("Failures"),
      chalk.bold("Runs"),
      chalk.bold("Top Error"),
    ],
    style: { head: [], border: [] },
  });

  for (const agent of limited) {
    // Get top error type
    const topError = Array.from(agent.errorTypes.entries()).sort(
      (a, b) => b[1] - a[1]
    )[0];

    agentsTable.push([
      chalk.cyan(agent.agent),
      chalk.red(agent.failureCount.toString()),
      agent.runIds.length.toString(),
      topError ? `${topError[0]} (${topError[1]})` : chalk.gray("—"),
    ]);
  }

  // Create error breakdown table
  const errorTable = new Table({
    head: [chalk.bold("Error Type"), chalk.bold("Count"), chalk.bold("Percentage")],
    style: { head: [], border: [] },
  });

  const totalErrors = Array.from(allErrorTypes.values()).reduce(
    (sum, count) => sum + count,
    0
  );

  const sortedErrors = Array.from(allErrorTypes.entries()).sort(
    (a, b) => b[1] - a[1]
  );

  for (const [errorType, count] of sortedErrors.slice(0, 10)) {
    const percentage = ((count / totalErrors) * 100).toFixed(1);
    errorTable.push([
      errorType,
      chalk.red(count.toString()),
      `${percentage}%`,
    ]);
  }

  return {
    agents: limited,
    table: agentsTable.toString(),
    errorBreakdown: errorTable.toString(),
  };
}
