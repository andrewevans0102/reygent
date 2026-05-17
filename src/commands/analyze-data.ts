import { loadConfig } from "../config.js";
import { SqliteBackend } from "../chesstrace/backends/sqlite.js";
import type { TelemetryEvent } from "../chesstrace/events.js";
import { Events } from "../chesstrace/events.js";
import { getLocalTelemetryPath } from "../telemetry-path.js";

// ---------------------------------------------------------------------------
// Shared helpers (re-exported for use by both CLI + dashboard)
// ---------------------------------------------------------------------------

/**
 * Parse duration string like "30d", "7d" into timestamp
 */
export function parseSince(since: string): number {
  const match = since.match(/^(\d+)d$/);
  if (!match) {
    throw new Error(`Invalid duration format: ${since}. Use format like "30d", "7d".`);
  }
  const days = Number.parseInt(match[1], 10);
  return Date.now() - days * 24 * 60 * 60 * 1000;
}

/**
 * Format timestamp to relative time
 */
export function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  const hours = Math.floor(diff / (60 * 60 * 1000));

  if (days > 0) return `${days} day${days > 1 ? "s" : ""} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  return "< 1 hour ago";
}

/**
 * Format duration in milliseconds
 */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);

  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

/**
 * Format USD cost
 */
export function formatCost(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

/**
 * Format percentage
 */
export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/**
 * Group items by key function
 */
export function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return groups;
}

/**
 * Filter events by category or event type
 */
export function filterEvents(
  events: TelemetryEvent[],
  criteria: { category?: string; event?: string }
): TelemetryEvent[] {
  return events.filter(e => {
    if (criteria.category && e.category !== criteria.category) return false;
    if (criteria.event && e.event !== criteria.event) return false;
    return true;
  });
}

/**
 * Get backend instance
 */
export async function getBackend(): Promise<SqliteBackend> {
  const dbPath = getLocalTelemetryPath(process.cwd());
  const backend = new SqliteBackend("local", dbPath);
  await backend.init();
  return backend;
}

/**
 * Check if telemetry is enabled (throws string message on failure for dashboard use)
 */
export function checkTelemetryEnabled(config: ReturnType<typeof loadConfig>): void {
  if (!config.telemetry?.enabled) {
    throw new Error("Telemetry is disabled. Enable with: reygent telemetry enable");
  }
}

// ---------------------------------------------------------------------------
// Cost constants
// ---------------------------------------------------------------------------

export const RETRY_COST_ESTIMATE_MULTIPLIER = 0.1;
export const POTENTIAL_SAVINGS_MULTIPLIER = 0.5;

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface FailurePattern {
  eventName: string;
  count: number;
  agents: { name: string; count: number }[];
  commonMessage: string | null;
  mostRecent: { runId: string; timestamp: number };
}

export interface FailureAnalysisResult {
  totalErrors: number;
  totalRuns: number;
  days: number;
  patterns: FailurePattern[];
  recommendations: string[];
}

export interface AgentPerf {
  agent: string;
  spawns: number;
  completions: number;
  successes: number;
  failures: number;
  totalDuration: number;
  avgDuration: number;
  successRate: number;
  models: { model: string; count: number }[];
}

export interface SuccessAnalysisResult {
  successfulRuns: number;
  days: number;
  agents: AgentPerf[];
  recommendations: string[];
}

export interface CostBreakdown {
  name: string;
  cost: number;
  runs: number;
  avgCost: number;
  percent: number;
}

export interface CostAnalysisResult {
  totalCost: number;
  successCost: number;
  failedCost: number;
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  days: number;
  byStage: CostBreakdown[];
  byAgent: CostBreakdown[];
  dailyCosts: { date: string; cost: number }[];
  recommendations: string[];
}

export interface AgentDetail {
  agent: string;
  spawns: number;
  completions: number;
  successes: number;
  failures: number;
  totalDuration: number;
  avgDuration: number;
  successRate: number;
  totalCost: number;
  avgCost: number;
  models: { model: string; count: number }[];
  errorTypes: { type: string; count: number }[];
}

export interface AgentAnalysisResult {
  totalSpawns: number;
  days: number;
  agents: AgentDetail[];
  recommendations: string[];
}

export interface TimelineBucket {
  date: string;
  counts: Record<string, number>;
}

export interface EventTimelineResult {
  days: number;
  buckets: TimelineBucket[];
  categories: string[];
}

export interface RunSummaryItem {
  runId: string;
  startTime: number;
  endTime: number;
  duration: number;
  eventCount: number;
  success: boolean | null;
  cost: number;
  agents: string[];
}

// ---------------------------------------------------------------------------
// Shared event resolution (handles "lastrun" filter)
// ---------------------------------------------------------------------------

interface ResolvedEvents {
  events: TelemetryEvent[];
  days: number;
}

async function resolveEvents(since?: string): Promise<ResolvedEvents> {
  const backend = await getBackend();

  if (since === "lastrun") {
    // Query last 90 days to find latest run
    const recentTime = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const allEvents = await backend.query({ startTime: recentTime });
    await backend.close();

    // Find run with most recent event
    const runLatest = new Map<string, number>();
    for (const e of allEvents) {
      const cur = runLatest.get(e.runId) || 0;
      if (e.timestamp > cur) runLatest.set(e.runId, e.timestamp);
    }
    let latestRunId = "";
    let latestTime = 0;
    for (const [runId, time] of runLatest) {
      if (time > latestTime) {
        latestRunId = runId;
        latestTime = time;
      }
    }

    const events = latestRunId
      ? allEvents.filter((e) => e.runId === latestRunId)
      : [];
    return { events, days: 1 };
  }

  const sinceTs = since
    ? parseSince(since)
    : Date.now() - 30 * 24 * 60 * 60 * 1000;
  const events = await backend.query({ startTime: sinceTs });
  await backend.close();
  const days = Math.max(
    1,
    Math.floor((Date.now() - sinceTs) / (24 * 60 * 60 * 1000)),
  );
  return { events, days };
}

// ---------------------------------------------------------------------------
// Compute functions
// ---------------------------------------------------------------------------

export async function computeFailureAnalysis(opts: {
  since?: string;
  limit?: number;
}): Promise<FailureAnalysisResult> {
  const { events: allEvents, days } = await resolveEvents(opts.since);
  const errorEvents = filterEvents(allEvents, { category: "error" });
  const pipelineEvents = filterEvents(allEvents, { event: Events.PIPELINE_END });
  const gateRetries = allEvents.filter(e => e.event === Events.GATE_RETRY);

  const totalRuns = new Set(pipelineEvents.map(e => e.runId)).size;

  // Group by event type
  const patternGroups = groupBy(errorEvents, e => e.event);
  const sortedPatterns = Array.from(patternGroups.entries())
    .sort((a, b) => b[1].length - a[1].length);

  const limit = opts.limit ?? sortedPatterns.length;
  const topPatterns = sortedPatterns.slice(0, limit);

  const patterns: FailurePattern[] = topPatterns.map(([eventName, events]) => {
    const agentGroups = groupBy(events, e => (e.data.agent as string) || "unknown");
    const mostRecent = events.reduce((a, b) => a.timestamp > b.timestamp ? a : b);
    const messages = events.map(e => e.data.message as string).filter(Boolean);

    return {
      eventName,
      count: events.length,
      agents: Array.from(agentGroups.entries()).map(([name, evts]) => ({ name, count: evts.length })),
      commonMessage: messages[0] ?? null,
      mostRecent: { runId: mostRecent.runId, timestamp: mostRecent.timestamp },
    };
  });

  // Build recommendations
  const recommendations: string[] = [];

  const parseErrors = errorEvents.filter(e => e.event === Events.ERROR_PARSE);
  if (parseErrors.length > 0) {
    const parseAgents = new Set(parseErrors.map(e => e.data.agent as string));
    for (const agent of parseAgents) {
      const count = parseErrors.filter(e => e.data.agent === agent).length;
      recommendations.push(`${agent} has ${count} parse failure(s) - review output format expectations`);
    }
  }

  if (gateRetries.length > 0) {
    const gateGroups = groupBy(gateRetries, e => e.data.gateName as string);
    for (const [gateName, events] of gateGroups) {
      const avgAttempts = events.reduce((sum, e) => sum + (e.data.attempt as number), 0) / events.length;
      recommendations.push(`${gateName} requires ${avgAttempts.toFixed(1)} avg retries - consider relaxing criteria`);
    }
  }

  const providerErrors = errorEvents.filter(e => e.event === Events.ERROR_PROVIDER);
  if (providerErrors.length > 0) {
    const reasons = providerErrors.map(e => e.data.reason as string).filter(Boolean);
    if (reasons.some(r => r.includes("rate limit"))) {
      recommendations.push("Rate limits hit during peak hours - consider request throttling");
    }
  }

  return { totalErrors: errorEvents.length, totalRuns, days, patterns, recommendations };
}

export async function computeSuccessAnalysis(opts: {
  since?: string;
  stage?: string;
  minSuccessRate?: number;
}): Promise<SuccessAnalysisResult> {
  const { events: allEvents, days } = await resolveEvents(opts.since);
  const pipelineEvents = filterEvents(allEvents, { event: Events.PIPELINE_END });
  const agentSpawnEvents = filterEvents(allEvents, { event: Events.AGENT_SPAWN });
  const agentCompleteEvents = filterEvents(allEvents, { event: Events.AGENT_COMPLETE });

  const successfulRuns = pipelineEvents.filter(e => e.data.success === true).length;

  // Build agent stats
  const agentStatsMap = new Map<string, {
    spawns: number; completions: number; successes: number;
    totalDuration: number; models: Map<string, number>;
  }>();

  for (const spawn of agentSpawnEvents) {
    const agent = spawn.data.agent as string;
    const model = spawn.data.model as string;
    const stats = agentStatsMap.get(agent) || {
      spawns: 0, completions: 0, successes: 0, totalDuration: 0, models: new Map(),
    };
    stats.spawns++;
    stats.models.set(model, (stats.models.get(model) || 0) + 1);
    agentStatsMap.set(agent, stats);
  }

  for (const complete of agentCompleteEvents) {
    const agent = complete.data.agent as string;
    const stats = agentStatsMap.get(agent);
    if (stats) {
      stats.completions++;
      if (complete.data.success === true) stats.successes++;
      if (complete.data.duration) stats.totalDuration += complete.data.duration as number;
    }
  }

  let agents: AgentPerf[] = Array.from(agentStatsMap.entries()).map(([agent, s]) => {
    const successRate = s.completions > 0 ? s.successes / s.completions : 0;
    return {
      agent,
      spawns: s.spawns,
      completions: s.completions,
      successes: s.successes,
      failures: s.completions - s.successes,
      totalDuration: s.totalDuration,
      avgDuration: s.completions > 0 ? s.totalDuration / s.completions : 0,
      successRate,
      models: Array.from(s.models.entries()).map(([model, count]) => ({ model, count })),
    };
  });

  // Apply filters
  if (opts.minSuccessRate !== undefined) {
    agents = agents.filter(a => a.successRate >= opts.minSuccessRate!);
  }
  if (opts.stage) {
    const stageAgentNames = new Set(
      allEvents
        .filter(e => e.data.stage === opts.stage && (e.event === Events.AGENT_SPAWN || e.event === Events.AGENT_COMPLETE))
        .map(e => e.data.agent as string)
    );
    agents = agents.filter(a => stageAgentNames.has(a.agent));
  }

  // Recommendations
  const recommendations: string[] = [];
  const sorted = [...agents].filter(a => a.completions > 0).sort((a, b) => b.successRate - a.successRate);
  if (sorted.length > 0 && sorted[0].successRate >= 0.9) {
    recommendations.push(`${sorted[0].agent}: Best performer (${formatPercent(sorted[0].successRate)} success)`);
  }

  return { successfulRuns, days, agents, recommendations };
}

export async function computeCostAnalysis(opts: {
  since?: string;
}): Promise<CostAnalysisResult> {
  const { events: allEvents, days } = await resolveEvents(opts.since);
  const costEvents = filterEvents(allEvents, { event: Events.USAGE_COST });
  const pipelineEvents = filterEvents(allEvents, { event: Events.PIPELINE_END });

  const totalRuns = new Set(pipelineEvents.map(e => e.runId)).size;
  const successRunIds = new Set(pipelineEvents.filter(e => e.data.success === true).map(e => e.runId));
  const successfulRuns = successRunIds.size;
  const failedRuns = totalRuns - successfulRuns;

  const totalCost = costEvents.reduce((sum, e) => sum + (e.data.costUsd as number), 0);
  const successCost = costEvents.filter(e => successRunIds.has(e.runId)).reduce((sum, e) => sum + (e.data.costUsd as number), 0);
  const failedCost = totalCost - successCost;

  // By stage
  const stageCosts = new Map<string, { cost: number; runs: Set<string> }>();
  for (const event of costEvents) {
    const stage = (event.data.stage as string) ?? "unknown";
    const cost = event.data.costUsd as number;
    const existing = stageCosts.get(stage) || { cost: 0, runs: new Set() };
    existing.cost += cost;
    existing.runs.add(event.runId);
    stageCosts.set(stage, existing);
  }
  const byStage: CostBreakdown[] = Array.from(stageCosts.entries())
    .sort((a, b) => b[1].cost - a[1].cost)
    .map(([name, data]) => ({
      name,
      cost: data.cost,
      runs: data.runs.size,
      avgCost: data.cost / data.runs.size,
      percent: totalCost > 0 ? data.cost / totalCost : 0,
    }));

  // By agent
  const agentCosts = new Map<string, { cost: number; runs: Set<string> }>();
  for (const event of costEvents) {
    const agent = (event.data.agent as string) || "unknown";
    const cost = event.data.costUsd as number;
    const existing = agentCosts.get(agent) || { cost: 0, runs: new Set() };
    existing.cost += cost;
    existing.runs.add(event.runId);
    agentCosts.set(agent, existing);
  }
  const byAgent: CostBreakdown[] = Array.from(agentCosts.entries())
    .sort((a, b) => b[1].cost - a[1].cost)
    .map(([name, data]) => ({
      name,
      cost: data.cost,
      runs: data.runs.size,
      avgCost: data.cost / data.runs.size,
      percent: totalCost > 0 ? data.cost / totalCost : 0,
    }));

  // Daily costs
  const dailyMap = new Map<string, number>();
  for (const event of costEvents) {
    const date = new Date(event.timestamp).toISOString().slice(0, 10);
    dailyMap.set(date, (dailyMap.get(date) || 0) + (event.data.costUsd as number));
  }
  const dailyCosts = Array.from(dailyMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, cost]) => ({ date, cost }));

  // Recommendations
  const recommendations: string[] = [];
  if (failedCost > 0 && totalCost > 0) {
    recommendations.push(`${formatPercent(failedCost / totalCost)} spend on failed runs - see 'reygent analyze failures' to reduce`);
  }
  const gateRetries = allEvents.filter(e => e.event === Events.GATE_RETRY);
  if (gateRetries.length > 0) {
    const monthlyCost = (totalCost / days) * 30;
    const retryCostEst = monthlyCost * RETRY_COST_ESTIMATE_MULTIPLIER;
    recommendations.push(`Gate retry loops cost ~${formatCost(retryCostEst)}/month - review gate criteria`);
  }
  const potentialSavings = failedCost * POTENTIAL_SAVINGS_MULTIPLIER;
  if (potentialSavings > 0) {
    const monthlySavings = (potentialSavings / days) * 30;
    recommendations.push(`Potential Savings: ${formatCost(monthlySavings)}/month (${formatPercent(potentialSavings / totalCost)})`);
  }

  return {
    totalCost, successCost, failedCost,
    totalRuns, successfulRuns, failedRuns,
    days, byStage, byAgent, dailyCosts, recommendations,
  };
}

export async function computeAgentAnalysis(opts: {
  since?: string;
  agent?: string;
}): Promise<AgentAnalysisResult> {
  const { events: allEvents, days } = await resolveEvents(opts.since);
  const agentSpawnEvents = filterEvents(allEvents, { event: Events.AGENT_SPAWN });
  const agentCompleteEvents = filterEvents(allEvents, { event: Events.AGENT_COMPLETE });
  const errorEvents = filterEvents(allEvents, { category: "error" });
  const costEvents = filterEvents(allEvents, { event: Events.USAGE_COST });

  // Build per-agent stats
  const statsMap = new Map<string, {
    spawns: number; completions: number; successes: number; failures: number;
    totalDuration: number; totalCost: number;
    models: Map<string, number>; errorTypes: Map<string, number>;
  }>();

  for (const spawn of agentSpawnEvents) {
    const agent = spawn.data.agent as string;
    const model = spawn.data.model as string;
    const s = statsMap.get(agent) || {
      spawns: 0, completions: 0, successes: 0, failures: 0,
      totalDuration: 0, totalCost: 0,
      models: new Map(), errorTypes: new Map(),
    };
    s.spawns++;
    s.models.set(model, (s.models.get(model) || 0) + 1);
    statsMap.set(agent, s);
  }

  for (const complete of agentCompleteEvents) {
    const agent = complete.data.agent as string;
    const s = statsMap.get(agent);
    if (s) {
      s.completions++;
      if (complete.data.success === true) s.successes++; else s.failures++;
      if (complete.data.duration) s.totalDuration += complete.data.duration as number;
    }
  }

  for (const error of errorEvents) {
    const agent = error.data.agent as string;
    const s = statsMap.get(agent);
    if (s) {
      s.errorTypes.set(error.event, (s.errorTypes.get(error.event) || 0) + 1);
    }
  }

  for (const cost of costEvents) {
    const agent = cost.data.agent as string;
    const s = statsMap.get(agent);
    if (s) {
      s.totalCost += cost.data.costUsd as number;
    }
  }

  let entries: [string, typeof statsMap extends Map<string, infer V> ? V : never][] = Array.from(statsMap.entries());
  if (opts.agent) {
    entries = entries.filter(([name]) => name === opts.agent);
  }

  const agents: AgentDetail[] = entries.map(([agent, s]) => ({
    agent,
    spawns: s.spawns,
    completions: s.completions,
    successes: s.successes,
    failures: s.failures,
    totalDuration: s.totalDuration,
    avgDuration: s.completions > 0 ? s.totalDuration / s.completions : 0,
    successRate: s.completions > 0 ? s.successes / s.completions : 0,
    totalCost: s.totalCost,
    avgCost: s.completions > 0 ? s.totalCost / s.completions : 0,
    models: Array.from(s.models.entries()).map(([model, count]) => ({ model, count })),
    errorTypes: Array.from(s.errorTypes.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => ({ type, count })),
  }));

  // Recommendations
  const recommendations: string[] = [];
  for (const a of agents) {
    if (a.completions > 0 && a.failures / a.completions > 0.2 && a.errorTypes.length > 0) {
      recommendations.push(`${a.agent}: High failure rate (${formatPercent(a.failures / a.completions)}) - review ${a.errorTypes[0].type} errors`);
    }
  }
  const sorted = [...agents].filter(a => a.completions > 0).sort((a, b) => b.successRate - a.successRate);
  if (sorted.length > 0 && sorted[0].successRate >= 0.9) {
    recommendations.push(`${sorted[0].agent}: Best performer (${formatPercent(sorted[0].successRate)} success)`);
  }

  return { totalSpawns: agentSpawnEvents.length, days, agents, recommendations };
}

export async function computeEventTimeline(opts: {
  since?: string;
}): Promise<EventTimelineResult> {
  const { events: allEvents, days } = await resolveEvents(opts.since);

  const bucketMap = new Map<string, Record<string, number>>();
  const categorySet = new Set<string>();

  for (const event of allEvents) {
    const date = new Date(event.timestamp).toISOString().slice(0, 10);
    const cat = event.category;
    categorySet.add(cat);

    const bucket = bucketMap.get(date) || {};
    bucket[cat] = (bucket[cat] || 0) + 1;
    bucketMap.set(date, bucket);
  }

  const buckets: TimelineBucket[] = Array.from(bucketMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, counts]) => ({ date, counts }));

  return { days, buckets, categories: Array.from(categorySet).sort() };
}

export async function computeRunsSummary(opts: {
  since?: string;
  limit?: number;
}): Promise<RunSummaryItem[]> {
  const { events: allEvents } = await resolveEvents(opts.since);

  // Group by runId
  const runMap = new Map<string, TelemetryEvent[]>();
  for (const e of allEvents) {
    const arr = runMap.get(e.runId) || [];
    arr.push(e);
    runMap.set(e.runId, arr);
  }

  const runs: RunSummaryItem[] = [];

  for (const [runId, events] of runMap) {
    const timestamps = events.map(e => e.timestamp);
    const startTime = Math.min(...timestamps);
    const endTime = Math.max(...timestamps);

    const pipelineEnd = events.find(e => e.event === Events.PIPELINE_END);
    const success = pipelineEnd ? (pipelineEnd.data.success as boolean) : null;

    const cost = events
      .filter(e => e.event === Events.USAGE_COST)
      .reduce((sum, e) => sum + (e.data.costUsd as number), 0);

    const agents = [...new Set(
      events.filter(e => e.event === Events.AGENT_SPAWN).map(e => e.data.agent as string)
    )];

    runs.push({
      runId, startTime, endTime,
      duration: endTime - startTime,
      eventCount: events.length,
      success, cost, agents,
    });
  }

  runs.sort((a, b) => b.startTime - a.startTime);

  const limit = opts.limit ?? 50;
  return runs.slice(0, limit);
}
