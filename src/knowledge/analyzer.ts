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
    .filter((p) => p.occurrences >= 1)
    .sort((a, b) => b.occurrences - a.occurrences);
}

/**
 * Analyze telemetry for success patterns.
 * Identifies high-success-rate agent/stage combinations and tool sequences.
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
    { successes: number; failures: number; lastSeen: number; toolSequences: string[][] }
  >();

  for (const event of completeEvents) {
    const agent = event.data.agent as string;
    const stage = (event.data.stage as string) || "unknown";
    const success = event.data.success as boolean;
    const runId = event.runId;

    const key = `${agent}:${stage}`;
    const existing = patterns.get(key) || {
      successes: 0,
      failures: 0,
      lastSeen: 0,
      toolSequences: [],
    };

    if (success) {
      existing.successes++;
      // Extract tool sequence for this successful run
      const toolSequence = extractToolSequence(events, runId, agent);
      if (toolSequence.length > 0) {
        existing.toolSequences.push(toolSequence);
      }
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
      const commonSequence = findCommonToolSequence(stats.toolSequences);
      successPatterns.push({
        pattern: `${agent} in ${stage} stage`,
        successRate,
        observations: total,
        lastSeen: stats.lastSeen,
        suggestedEntry: generateSuccessEntry(agent, stage, successRate, total, commonSequence),
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
 * Sanitize error message to remove sensitive data (tokens, paths, emails)
 */
function sanitizeErrorMessage(message: string): string {
  return message
    // API keys, tokens, secrets (20+ alphanumeric chars with word boundaries to avoid base64 false positives)
    .replace(/\b[A-Za-z0-9+/=_-]{20,}\b/g, '[REDACTED_TOKEN]')
    // User home paths
    .replace(/\/Users\/[^/\s]+/g, '/Users/***')
    .replace(/\/home\/[^/\s]+/g, '/home/***')
    .replace(/C:\\Users\\[^\\]+/g, 'C:\\Users\\***')
    // Email addresses
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '***@***.***')
    // IP addresses
    .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '***.***.***.**')
    // Common env var patterns
    .replace(/(password|secret|key|token|api[_-]?key)=[^\s]+/gi, '$1=[REDACTED]');
}

/**
 * Normalize error message to pattern (first 100 chars, trimmed, sanitized)
 */
function normalizeErrorPattern(message: string): string {
  const sanitized = sanitizeErrorMessage(message);
  return sanitized.slice(0, 100).trim();
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
  commonSequence?: string[],
): string {
  const today = new Date().toISOString().split("T")[0];
  const pct = Math.round(successRate * 100);
  const sequenceText = commonSequence && commonSequence.length > 0
    ? `

**Common tool sequence**:
${commonSequence.map((tool, i) => `${i + 1}. ${tool}`).join('\n')}`
    : '';

  return `
## ${agent} in ${stage} stage (${pct}% success)
**Observations**: ${observations} runs
**Last seen**: ${today}
**Success rate**: ${pct}%

**Pattern**:
[Describe what makes this approach successful]${sequenceText}

**Recommended approach**:
[Add recommendation here]
`;
}

/**
 * Extract tool sequence from events for a given run and agent
 */
function extractToolSequence(events: TelemetryEvent[], runId: string, agent: string): string[] {
  const agentEvents = events.filter(
    (e) => e.runId === runId && e.data.agent === agent && e.event === Events.TOOL_CALL
  );

  return agentEvents
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((e) => e.data.tool as string)
    .filter((tool): tool is string => !!tool);
}

/**
 * Find common tool sequence across multiple runs
 */
function findCommonToolSequence(sequences: string[][]): string[] | undefined {
  if (sequences.length === 0) return undefined;

  // Find the most common sequence pattern
  const sequenceMap = new Map<string, number>();

  for (const seq of sequences) {
    const key = seq.join('->');
    sequenceMap.set(key, (sequenceMap.get(key) || 0) + 1);
  }

  // Return most common sequence if it appears in >50% of runs
  const threshold = sequences.length * 0.5;
  for (const [key, count] of sequenceMap.entries()) {
    if (count >= threshold) {
      return key.split('->');
    }
  }

  return undefined;
}

/**
 * Suggest knowledge entries from failure patterns.
 * Returns formatted entries ready to add to common-failures.md
 */
export function suggestFromFailures(
  db: SqliteBackend,
  sinceMs: number,
  limit: number = 5,
): string[] {
  const patterns = analyzeFailurePatterns(db, sinceMs);
  return patterns.slice(0, limit).map((p) => p.suggestedEntry);
}

/**
 * Suggest knowledge entries from success patterns.
 * Returns formatted entries ready to add to success-patterns.md
 */
export function suggestFromSuccesses(
  db: SqliteBackend,
  sinceMs: number,
  minSuccessRate: number = 0.85,
  limit: number = 5,
): string[] {
  const patterns = analyzeSuccessPatterns(db, sinceMs, minSuccessRate);
  return patterns.slice(0, limit).map((p) => p.suggestedEntry);
}
