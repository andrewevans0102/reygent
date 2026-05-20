import type { StorageBackend } from "../chesstrace/backends/types.js";
import type { TelemetryEvent } from "../chesstrace/events.js";
import { getRunsList } from "./runs-list.js";
import { getTrendData } from "./trends.js";
import { getAgentFailures } from "./agent-failures.js";
import type { RunSummaryRow } from "./runs-list.js";
import type { TrendBucket } from "./trends.js";
import type { AgentFailureSummary } from "./agent-failures.js";

export interface DashboardSnapshot {
  local: ScopeData | null;
  global: ScopeData | null;
  generated: number;
}

export interface RunWithEvents extends RunSummaryRow {
  events: TelemetryEvent[];
}

export type SerializableAgentFailureSummary = Omit<AgentFailureSummary, "errorTypes"> & {
  errorTypes: { [k: string]: number };
};

export interface ScopeData {
  runs: RunWithEvents[];
  trends: {
    buckets: TrendBucket[];
    totalRuns: number;
    successCount: number;
    failureCount: number;
    successRate: number;
  };
  agentFailures: SerializableAgentFailureSummary[];
}

/**
 * Collect all dashboard data from a backend
 */
async function collectScopeData(backend: StorageBackend): Promise<ScopeData> {
  // Get runs (last 90 days, up to 100 to keep file size reasonable). Always
  // include runs with errors even if they fall outside the limit window — the
  // dashboard's "Failures" filter and agent-failure drill-down depend on the
  // failed runs being present in the displayed list.
  const runsResult = await getRunsList(backend, {
    limit: 100,
    since: "90d",
    includeErrors: true,
  });

  // Fetch full events for each run
  const runsWithEvents: RunWithEvents[] = await Promise.all(
    runsResult.runs.map(async (run) => {
      const events = await backend.query({ runId: run.runId });
      events.sort((a, b) => a.timestamp - b.timestamp);
      return {
        ...run,
        events,
      };
    })
  );

  // Get trends (last 90 days)
  const trendsResult = await getTrendData(backend, {
    since: "90d",
    granularity: "day",
  });

  // Get agent failures (last 30 days, top 20)
  const failuresResult = await getAgentFailures(backend, {
    since: "30d",
    limit: 20,
  });

  // Count distinct failed runs from the displayed set (includeErrors above
  // guarantees that error runs from the time window are present here).
  const failedRunIds = new Set<string>();
  for (const r of runsWithEvents) {
    if (r.status === "failure" || r.errorCount > 0) {
      failedRunIds.add(r.runId);
    }
  }

  const totalRuns = runsWithEvents.length;
  const failureCount = failedRunIds.size;
  const successCount = Math.max(0, totalRuns - failureCount);
  const successRate = totalRuns > 0 ? successCount / totalRuns : 0;

  // Convert Map fields to plain objects for JSON serialization
  const serializableAgentFailures = failuresResult.agents.map(a => ({
    ...a,
    errorTypes: Object.fromEntries(a.errorTypes),
  }));

  return {
    runs: runsWithEvents,
    trends: {
      buckets: trendsResult.buckets,
      totalRuns,
      successCount,
      failureCount,
      successRate,
    },
    agentFailures: serializableAgentFailures,
  };
}

/**
 * Collect dashboard data from both local and global backends
 */
export async function collectDashboardData(
  localBackend: StorageBackend | null,
  globalBackend: StorageBackend | null
): Promise<DashboardSnapshot> {
  const [local, global] = await Promise.all([
    localBackend ? collectScopeData(localBackend) : null,
    globalBackend ? collectScopeData(globalBackend) : null,
  ]);

  return {
    local,
    global,
    generated: Date.now(),
  };
}
