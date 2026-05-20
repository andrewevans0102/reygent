import Table from "cli-table3";
import chalk from "chalk";
import type { StorageBackend } from "../chesstrace/backends/types.js";
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
  backend: StorageBackend,
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
    const events = await backend.query({ runId: run.runId });

    // An agent failure is an agent.complete with success === false.
    // Spawning-and-then-some-later-error is not enough — a pipeline that runs
    // 8 agents successfully and then fails at pr-create would otherwise blame
    // all 8 agents for the pipeline error.
    const failedCompletions = events.filter(
      (e) => e.event === "agent.complete" && e.data?.success === false
    );

    if (failedCompletions.length === 0) {
      continue;
    }

    const errors = events.filter((e) => e.category === "error");

    for (const completion of failedCompletions) {
      const agentName = completion.data.agent as string | undefined;
      if (!agentName) continue;

      const stage = completion.data.stage as string | undefined;

      // Errors are associated with a failed agent when their data.agent
      // matches, or when they share the same stage as the failed completion.
      // The stage match catches pipeline-level errors like
      // "error.task {stage: 'implement', agent: 'implement'}" which describe
      // why the agent at that stage failed.
      const associatedErrors = errors.filter((e) => {
        const errAgent = e.data?.agent as string | undefined;
        const errStage = e.data?.stage as string | undefined;
        if (errAgent === agentName) return true;
        if (stage && errStage === stage) return true;
        return false;
      });

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
      summary.lastSeen = Math.max(summary.lastSeen, completion.timestamp);

      // Use the completion event itself as the primary failure indicator so
      // the breakdown isn't empty when associated errors don't carry an
      // agent/stage tag.
      summary.errorTypes.set(
        "agent.complete",
        (summary.errorTypes.get("agent.complete") ?? 0) + 1
      );
      allErrorTypes.set(
        "agent.complete",
        (allErrorTypes.get("agent.complete") ?? 0) + 1
      );

      for (const error of associatedErrors) {
        const errorType = error.event;
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
