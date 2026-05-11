import { describe, it, expect } from "vitest";
import {
  analyzeFailurePatterns,
  analyzeSuccessPatterns,
  measureKnowledgeEffectiveness,
} from "./analyzer.js";
import { SqliteBackend } from "../chesstrace/backends/sqlite.js";
import { Events } from "../chesstrace/events.js";
import type { TelemetryEvent } from "../chesstrace/events.js";

// Mock SqliteBackend for testing
class MockBackend extends SqliteBackend {
  private mockEvents: TelemetryEvent[] = [];

  constructor(events: TelemetryEvent[] = []) {
    super(":memory:");
    this.mockEvents = events;
  }

  getEvents(): TelemetryEvent[] {
    return this.mockEvents;
  }
}

describe("analyzeFailurePatterns", () => {
  it("groups error events by pattern", () => {
    const now = Date.now();
    const events: TelemetryEvent[] = [
      {
        id: "1",
        runId: "run1",
        timestamp: now,
        category: "error",
        event: Events.ERROR_TASK,
        minLevel: 0,
        data: { message: "Circular import error", agent: "dev" },
      },
      {
        id: "2",
        runId: "run2",
        timestamp: now,
        category: "error",
        event: Events.ERROR_TASK,
        minLevel: 0,
        data: { message: "Circular import error", agent: "dev" },
      },
      {
        id: "3",
        runId: "run3",
        timestamp: now,
        category: "error",
        event: Events.ERROR_TASK,
        minLevel: 0,
        data: { message: "Different error", agent: "qe" },
      },
      {
        id: "4",
        runId: "run4",
        timestamp: now,
        category: "error",
        event: Events.ERROR_TASK,
        minLevel: 0,
        data: { message: "Different error", agent: "qe" },
      },
    ];

    const backend = new MockBackend(events);
    const patterns = analyzeFailurePatterns(backend, now - 1000);

    expect(patterns).toHaveLength(2);
    expect(patterns[0].occurrences).toBe(2);
    expect(patterns[0].pattern).toContain("Circular import");
    expect(patterns[0].agents).toContain("dev");
    expect(patterns[1].occurrences).toBe(2);
  });

  it("filters by time window", () => {
    const now = Date.now();
    const recent = now - 1000;
    const old = now - 100000;

    const events: TelemetryEvent[] = [
      {
        id: "1",
        runId: "run1",
        timestamp: recent,
        category: "error",
        event: Events.ERROR_TASK,
        minLevel: 0,
        data: { message: "Recent error", agent: "dev" },
      },
      {
        id: "2",
        runId: "run2",
        timestamp: old,
        category: "error",
        event: Events.ERROR_TASK,
        minLevel: 0,
        data: { message: "Old error", agent: "dev" },
      },
    ];

    const backend = new MockBackend(events);
    const patterns = analyzeFailurePatterns(backend, recent);

    expect(patterns).toHaveLength(0); // both filtered out (occurrences = 1)
  });

  it("returns empty array when no patterns found", () => {
    const backend = new MockBackend([]);
    const patterns = analyzeFailurePatterns(backend, Date.now() - 1000);

    expect(patterns).toEqual([]);
  });
});

describe("analyzeSuccessPatterns", () => {
  it("calculates success rates by agent/stage", () => {
    const now = Date.now();
    const events: TelemetryEvent[] = [
      {
        id: "1",
        runId: "run1",
        timestamp: now,
        category: "agent",
        event: Events.AGENT_COMPLETE,
        minLevel: 1,
        data: { agent: "dev", stage: "implement", success: true },
      },
      {
        id: "2",
        runId: "run2",
        timestamp: now,
        category: "agent",
        event: Events.AGENT_COMPLETE,
        minLevel: 1,
        data: { agent: "dev", stage: "implement", success: true },
      },
      {
        id: "3",
        runId: "run3",
        timestamp: now,
        category: "agent",
        event: Events.AGENT_COMPLETE,
        minLevel: 1,
        data: { agent: "dev", stage: "implement", success: true },
      },
      {
        id: "4",
        runId: "run4",
        timestamp: now,
        category: "agent",
        event: Events.AGENT_COMPLETE,
        minLevel: 1,
        data: { agent: "dev", stage: "implement", success: true },
      },
      {
        id: "5",
        runId: "run5",
        timestamp: now,
        category: "agent",
        event: Events.AGENT_COMPLETE,
        minLevel: 1,
        data: { agent: "dev", stage: "implement", success: false },
      },
    ];

    const backend = new MockBackend(events);
    // Pass lower threshold since default is 0.8 but we have 0.8 success rate
    const patterns = analyzeSuccessPatterns(backend, now - 1000, 0.7);

    expect(patterns).toHaveLength(1);
    expect(patterns[0].successRate).toBeCloseTo(0.8); // 4/5
    expect(patterns[0].observations).toBe(5);
    expect(patterns[0].pattern).toContain("dev");
  });

  it("filters by minimum success rate", () => {
    const now = Date.now();
    const events: TelemetryEvent[] = [
      {
        id: "1",
        runId: "run1",
        timestamp: now,
        category: "agent",
        event: Events.AGENT_COMPLETE,
        minLevel: 1,
        data: { agent: "dev", stage: "implement", success: true },
      },
      {
        id: "2",
        runId: "run2",
        timestamp: now,
        category: "agent",
        event: Events.AGENT_COMPLETE,
        minLevel: 1,
        data: { agent: "dev", stage: "implement", success: false },
      },
      {
        id: "3",
        runId: "run3",
        timestamp: now,
        category: "agent",
        event: Events.AGENT_COMPLETE,
        minLevel: 1,
        data: { agent: "dev", stage: "implement", success: false },
      },
    ];

    const backend = new MockBackend(events);
    const patterns = analyzeSuccessPatterns(backend, now - 1000, 0.8);

    expect(patterns).toEqual([]); // 33% success rate < 80%
  });
});

describe("measureKnowledgeEffectiveness", () => {
  it("compares success rates with/without knowledge", () => {
    const now = Date.now();
    const events: TelemetryEvent[] = [
      // Knowledge consulted run (success)
      {
        id: "1",
        runId: "run1",
        timestamp: now,
        category: "knowledge",
        event: Events.KNOWLEDGE_CONSULTED,
        minLevel: 1,
        data: { agent: "dev" },
      },
      {
        id: "2",
        runId: "run1",
        timestamp: now,
        category: "pipeline",
        event: Events.PIPELINE_END,
        minLevel: 1,
        data: { success: true },
      },
      // Baseline run (failure)
      {
        id: "3",
        runId: "run2",
        timestamp: now,
        category: "pipeline",
        event: Events.PIPELINE_END,
        minLevel: 1,
        data: { success: false },
      },
    ];

    const backend = new MockBackend(events);
    const effectiveness = measureKnowledgeEffectiveness(backend, now - 1000);

    expect(effectiveness.withKnowledge).toBe(1.0); // 1/1
    expect(effectiveness.baseline).toBe(0.0); // 0/1
    expect(effectiveness.improvement).toBe(1.0);
    expect(effectiveness.consultedRuns).toBe(1);
    expect(effectiveness.baselineRuns).toBe(1);
  });

  it("returns zero when no data", () => {
    const backend = new MockBackend([]);
    const effectiveness = measureKnowledgeEffectiveness(backend, Date.now() - 1000);

    expect(effectiveness.withKnowledge).toBe(0);
    expect(effectiveness.baseline).toBe(0);
    expect(effectiveness.improvement).toBe(0);
  });
});
