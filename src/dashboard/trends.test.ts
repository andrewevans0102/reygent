import { describe, it, expect, vi, beforeEach } from "vitest";
import { getTrendData } from "./trends.js";
import type { TelemetryBackend } from "../chesstrace/backends/types.js";
import type { TelemetryEvent } from "../chesstrace/events.js";

describe("getTrendData", () => {
  let mockBackend: TelemetryBackend;

  beforeEach(() => {
    mockBackend = {
      init: vi.fn(),
      emit: vi.fn(),
      flush: vi.fn(),
      close: vi.fn(),
      listRuns: vi.fn(),
      queryEvents: vi.fn(),
    };
  });

  it("returns empty buckets when no runs exist", async () => {
    vi.mocked(mockBackend.listRuns).mockResolvedValue([]);

    const result = await getTrendData(mockBackend);

    expect(result.buckets).toHaveLength(0);
    expect(result.chart).toBe("");
    expect(result.summary).toBe("");
  });

  it("groups runs into day buckets", async () => {
    // Use fixed timestamp at start of day to avoid midnight boundary issues
    const baseTime = new Date("2024-01-01T00:00:00Z").getTime();
    const runs = [
      {
        runId: "run-1",
        startTime: baseTime,
        endTime: baseTime + 1000,
        eventCount: 5,
        categories: ["command"],
      },
      {
        runId: "run-2",
        startTime: baseTime + 3600000, // 1 hour later (same day)
        endTime: baseTime + 3601000,
        eventCount: 5,
        categories: ["command"],
      },
      {
        runId: "run-3",
        startTime: baseTime + 86400000, // 1 day later
        endTime: baseTime + 86401000,
        eventCount: 5,
        categories: ["command"],
      },
    ];

    vi.mocked(mockBackend.listRuns).mockResolvedValue(runs);
    vi.mocked(mockBackend.queryEvents)
      .mockResolvedValueOnce([
        {
          id: "1",
          runId: "run-1",
          timestamp: baseTime,
          category: "command",
          event: "command.end",
          minLevel: 0,
          data: {},
        },
      ] as TelemetryEvent[])
      .mockResolvedValueOnce([
        {
          id: "2",
          runId: "run-2",
          timestamp: baseTime + 3600000,
          category: "command",
          event: "command.end",
          minLevel: 0,
          data: {},
        },
      ] as TelemetryEvent[])
      .mockResolvedValueOnce([
        {
          id: "3",
          runId: "run-3",
          timestamp: baseTime + 86400000,
          category: "command",
          event: "command.end",
          minLevel: 0,
          data: {},
        },
      ] as TelemetryEvent[]);

    const result = await getTrendData(mockBackend, { granularity: "day" });

    expect(result.buckets).toHaveLength(2); // 2 different days
    expect(result.buckets[0].totalCount).toBe(2); // Day 1: 2 runs
    expect(result.buckets[1].totalCount).toBe(1); // Day 2: 1 run
  });

  it("calculates success rate correctly", async () => {
    const baseTime = Date.now();
    const runs = [
      {
        runId: "run-1",
        startTime: baseTime,
        endTime: baseTime + 1000,
        eventCount: 5,
        categories: ["command"],
      },
      {
        runId: "run-2",
        startTime: baseTime + 1000,
        endTime: baseTime + 2000,
        eventCount: 5,
        categories: ["command", "error"],
      },
    ];

    vi.mocked(mockBackend.listRuns).mockResolvedValue(runs);
    vi.mocked(mockBackend.queryEvents)
      .mockResolvedValueOnce([
        {
          id: "1",
          runId: "run-1",
          timestamp: baseTime,
          category: "command",
          event: "command.end",
          minLevel: 0,
          data: {},
        },
      ] as TelemetryEvent[])
      .mockResolvedValueOnce([
        {
          id: "2",
          runId: "run-2",
          timestamp: baseTime + 1000,
          category: "command",
          event: "command.end",
          minLevel: 0,
          data: {},
        },
        {
          id: "3",
          runId: "run-2",
          timestamp: baseTime + 1500,
          category: "error",
          event: "error.task",
          minLevel: 0,
          data: { message: "Test error" },
        },
      ] as TelemetryEvent[]);

    const result = await getTrendData(mockBackend, { granularity: "day" });

    expect(result.buckets).toHaveLength(1);
    expect(result.buckets[0].successCount).toBe(1);
    expect(result.buckets[0].failureCount).toBe(1);
    expect(result.buckets[0].successRate).toBe(0.5);
  });

  it("includes summary statistics", async () => {
    const baseTime = Date.now();
    const runs = [
      {
        runId: "run-1",
        startTime: baseTime,
        endTime: baseTime + 1000,
        eventCount: 5,
        categories: ["command"],
      },
      {
        runId: "run-2",
        startTime: baseTime + 1000,
        endTime: baseTime + 2000,
        eventCount: 5,
        categories: ["command", "error"],
      },
    ];

    vi.mocked(mockBackend.listRuns).mockResolvedValue(runs);
    vi.mocked(mockBackend.queryEvents)
      .mockResolvedValueOnce([
        {
          id: "1",
          runId: "run-1",
          timestamp: baseTime,
          category: "command",
          event: "command.end",
          minLevel: 0,
          data: {},
        },
      ] as TelemetryEvent[])
      .mockResolvedValueOnce([
        {
          id: "2",
          runId: "run-2",
          timestamp: baseTime + 1000,
          category: "command",
          event: "command.end",
          minLevel: 0,
          data: {},
        },
        {
          id: "3",
          runId: "run-2",
          timestamp: baseTime + 1500,
          category: "error",
          event: "error.task",
          minLevel: 0,
          data: { message: "Test error" },
        },
      ] as TelemetryEvent[]);

    const result = await getTrendData(mockBackend, { granularity: "day" });

    expect(result.summary).toContain("Total Runs: 2");
    expect(result.summary).toContain("Success:");
    expect(result.summary).toContain("Failure:");
  });

  it("handles incomplete runs", async () => {
    const baseTime = Date.now();
    const runs = [
      {
        runId: "run-1",
        startTime: baseTime,
        endTime: undefined,
        eventCount: 3,
        categories: ["agent"],
      },
    ];

    vi.mocked(mockBackend.listRuns).mockResolvedValue(runs);
    vi.mocked(mockBackend.queryEvents).mockResolvedValue([
      {
        id: "1",
        runId: "run-1",
        timestamp: baseTime,
        category: "agent",
        event: "agent.spawn",
        minLevel: 1,
        data: { agent: "Dev" },
      },
    ] as TelemetryEvent[]);

    const result = await getTrendData(mockBackend, { granularity: "day" });

    expect(result.buckets).toHaveLength(1);
    expect(result.buckets[0].incompleteCount).toBe(1);
    expect(result.summary).toContain("Incomplete:");
  });

  it("filters by time range when since is provided", async () => {
    const run1 = {
      runId: "run-1",
      startTime: Date.now() - 86400000 * 40, // 40 days ago
      endTime: Date.now() - 86400000 * 40 + 1000,
      eventCount: 5,
      categories: ["command"],
    };
    const run2 = {
      runId: "run-2",
      startTime: Date.now() - 86400000 * 20, // 20 days ago
      endTime: Date.now() - 86400000 * 20 + 1000,
      eventCount: 5,
      categories: ["command"],
    };

    vi.mocked(mockBackend.listRuns).mockResolvedValue([run1, run2]);
    vi.mocked(mockBackend.queryEvents).mockResolvedValue([
      {
        id: "1",
        runId: "run-2",
        timestamp: run2.startTime,
        category: "command",
        event: "command.end",
        minLevel: 0,
        data: {},
      },
    ] as TelemetryEvent[]);

    const result = await getTrendData(mockBackend, { since: "30d" });

    expect(result.buckets.length).toBeGreaterThan(0);
    expect(result.summary).toContain("Total Runs: 1");
  });
});
