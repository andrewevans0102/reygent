import type { StorageBackend, TelemetryEvent } from "../chesstrace/backends/types.js";
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

export interface ScopeData {
  runs: RunWithEvents[];
  trends: {
    buckets: TrendBucket[];
    totalRuns: number;
    successCount: number;
    failureCount: number;
    successRate: number;
  };
  agentFailures: AgentFailureSummary[];
}

/**
 * Collect all dashboard data from a backend
 */
async function collectScopeData(backend: StorageBackend): Promise<ScopeData> {
  // Get runs (last 90 days, up to 100 to keep file size reasonable)
  const runsResult = await getRunsList(backend, {
    limit: 100,
    since: "90d",
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

  // Calculate aggregate stats
  // Use unique failed run IDs from agent failures (covers runs outside the 100-run display window)
  const failedRunIds = new Set<string>();
  for (const agent of failuresResult.agents) {
    for (const rid of agent.runIds) {
      failedRunIds.add(rid);
    }
  }
  // Also include runs in display window that have errors
  for (const r of runsWithEvents) {
    if (r.status === 'failure' || r.errorCount > 0) {
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
