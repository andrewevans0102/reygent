import type { SqliteBackend } from "../chesstrace/backends/sqlite.js";
import type { TelemetryEvent } from "../chesstrace/events.js";
import { Events } from "../chesstrace/events.js";

export interface FailurePattern {
  pattern: string;
  occurrences: number;
  runIds: string[];
  agents: string[];
  lastSeen: number;
  suggestedEntry: string;
}

export interface SuccessPattern {
  pattern: string;
  successRate: number;
  observations: number;
  lastSeen: number;
  suggestedEntry: string;
}

/**
 * Analyze telemetry for recurring failure patterns.
 * Groups error events by message pattern and agent.
 */
export function analyzeFailurePatterns(
  db: SqliteBackend,
  sinceMs: number,
): FailurePattern[] {
  const events = db.getEvents();
  const errorEvents = events.filter(
    (e) =>
      e.category === "error" &&
      e.timestamp >= sinceMs &&
      (e.event === Events.ERROR_TASK || e.event === Events.AGENT_ERROR),
  );

  // Group by error message pattern
  const patterns = new Map<string, FailurePattern>();

  for (const event of errorEvents) {
    const message = event.data.message as string;
    const agent = event.data.agent as string;
    const runId = event.runId;

    if (!message || !agent) continue;

    // Extract pattern (first 100 chars of message, normalized)
    const pattern = normalizeErrorPattern(message);

    const existing = patterns.get(pattern);
    if (existing) {
      existing.occurrences++;
      if (!existing.runIds.includes(runId)) {
        existing.runIds.push(runId);
      }
      if (!existing.agents.includes(agent)) {
        existing.agents.push(agent);
      }
      existing.lastSeen = Math.max(existing.lastSeen, event.timestamp);
    } else {
      patterns.set(pattern, {
        pattern,
        occurrences: 1,
        runIds: [runId],
        agents: [agent],
        lastSeen: event.timestamp,
        suggestedEntry: generateFailureEntry(pattern, agent),
      });
    }
  }

  // Return patterns with >1 occurrence, sorted by frequency
  return Array.from(patterns.values())
    .filter((p) => p.occurrences > 1)
    .sort((a, b) => b.occurrences - a.occurrences);
}

/**
 * Analyze telemetry for success patterns.
 * Identifies high-success-rate agent/stage combinations.
 */
export function analyzeSuccessPatterns(
  db: SqliteBackend,
  sinceMs: number,
  minSuccessRate: number = 0.8,
): SuccessPattern[] {
  const events = db.getEvents();
  const completeEvents = events.filter(
    (e) =>
      e.event === Events.AGENT_COMPLETE && e.timestamp >= sinceMs,
  );

  // Group by agent+stage
  const patterns = new Map<
    string,
    { successes: number; failures: number; lastSeen: number }
  >();

  for (const event of completeEvents) {
    const agent = event.data.agent as string;
    const stage = (event.data.stage as string) || "unknown";
    const success = event.data.success as boolean;

    const key = `${agent}:${stage}`;
    const existing = patterns.get(key) || {
      successes: 0,
      failures: 0,
      lastSeen: 0,
    };

    if (success) {
      existing.successes++;
    } else {
      existing.failures++;
    }
    existing.lastSeen = Math.max(existing.lastSeen, event.timestamp);
    patterns.set(key, existing);
  }

  // Filter by success rate and convert to SuccessPattern
  const successPatterns: SuccessPattern[] = [];

  for (const [key, stats] of patterns.entries()) {
    const total = stats.successes + stats.failures;
    const successRate = stats.successes / total;

    if (successRate >= minSuccessRate && total >= 3) {
      const [agent, stage] = key.split(":");
      successPatterns.push({
        pattern: `${agent} in ${stage} stage`,
        successRate,
        observations: total,
        lastSeen: stats.lastSeen,
        suggestedEntry: generateSuccessEntry(agent, stage, successRate, total),
      });
    }
  }

  return successPatterns.sort((a, b) => b.successRate - a.successRate);
}

/**
 * Measure knowledge effectiveness by comparing success rates.
 * Returns success rate when knowledge consulted vs baseline.
 */
export function measureKnowledgeEffectiveness(db: SqliteBackend, sinceMs: number): {
  withKnowledge: number;
  baseline: number;
  improvement: number;
  consultedRuns: number;
  baselineRuns: number;
} {
  const events = db.getEvents();

  // Get runs that consulted knowledge
  const knowledgeEvents = events.filter(
    (e) =>
      e.event === Events.KNOWLEDGE_CONSULTED && e.timestamp >= sinceMs,
  );
  const consultedRunIds = new Set(knowledgeEvents.map((e) => e.runId));

  // Get pipeline end events
  const pipelineEnds = events.filter(
    (e) =>
      e.event === Events.PIPELINE_END && e.timestamp >= sinceMs,
  );

  let consultedSuccess = 0;
  let consultedTotal = 0;
  let baselineSuccess = 0;
  let baselineTotal = 0;

  for (const event of pipelineEnds) {
    const success = event.data.success as boolean;
    const runId = event.runId;

    if (consultedRunIds.has(runId)) {
      consultedTotal++;
      if (success) consultedSuccess++;
    } else {
      baselineTotal++;
      if (success) baselineSuccess++;
    }
  }

  const withKnowledge = consultedTotal > 0 ? consultedSuccess / consultedTotal : 0;
  const baseline = baselineTotal > 0 ? baselineSuccess / baselineTotal : 0;
  const improvement = withKnowledge - baseline;

  return {
    withKnowledge,
    baseline,
    improvement,
    consultedRuns: consultedTotal,
    baselineRuns: baselineTotal,
  };
}

/**
 * Normalize error message to pattern (first 100 chars, trimmed)
 */
function normalizeErrorPattern(message: string): string {
  return message.slice(0, 100).trim();
}

/**
 * Generate failure entry template
 */
function generateFailureEntry(pattern: string, agent: string): string {
  const today = new Date().toISOString().split("T")[0];
  return `
## ${pattern}
**Occurrences**: X runs
**Last seen**: ${today}
**Agent**: ${agent}

**Solution**: [Add solution description here]

**Example**:
\`\`\`
[Add code example here]
\`\`\`
`;
}

/**
 * Generate success entry template
 */
function generateSuccessEntry(
  agent: string,
  stage: string,
  successRate: number,
  observations: number,
): string {
  const today = new Date().toISOString().split("T")[0];
  const pct = Math.round(successRate * 100);
  return `
## ${agent} in ${stage} stage (${pct}% success)
**Observations**: ${observations} runs
**Last seen**: ${today}
**Success rate**: ${pct}%

**Pattern**:
[Describe what makes this approach successful]

**Recommended approach**:
[Add recommendation here]
`;
}
