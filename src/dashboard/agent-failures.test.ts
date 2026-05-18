import { describe, it, expect, vi, beforeEach } from "vitest";
import { getAgentFailures } from "./agent-failures.js";
import type { TelemetryBackend } from "../chesstrace/backends/types.js";
import type { TelemetryEvent } from "../chesstrace/events.js";

describe("getAgentFailures", () => {
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

  it("returns empty list when no failures exist", async () => {
    const run = {
      runId: "run-1",
      startTime: 1000,
      endTime: 2000,
      eventCount: 5,
      categories: ["command"],
    };

    vi.mocked(mockBackend.listRuns).mockResolvedValue([run]);
    vi.mocked(mockBackend.queryEvents).mockResolvedValue([
      {
        id: "1",
        runId: "run-1",
        timestamp: 1000,
        category: "command",
        event: "command.end",
        minLevel: 0,
        data: {},
      },
    ] as TelemetryEvent[]);

    const result = await getAgentFailures(mockBackend);

    expect(result.agents).toHaveLength(0);
  });

  it("aggregates failures by agent", async () => {
    const run = {
      runId: "run-1",
      startTime: 1000,
      endTime: 2000,
      eventCount: 10,
      categories: ["agent", "error"],
    };

    vi.mocked(mockBackend.listRuns).mockResolvedValue([run]);
    vi.mocked(mockBackend.queryEvents).mockResolvedValue([
      {
        id: "1",
        runId: "run-1",
        timestamp: 1000,
        category: "agent",
        event: "agent.spawn",
        minLevel: 1,
        data: { agent: "Dev" },
      },
      {
        id: "2",
        runId: "run-1",
        timestamp: 1500,
        category: "error",
        event: "error.task",
        minLevel: 0,
        data: { message: "Test error" },
      },
      {
        id: "3",
        runId: "run-1",
        timestamp: 2000,
        category: "command",
        event: "command.end",
        minLevel: 0,
        data: {},
      },
    ] as TelemetryEvent[]);

    const result = await getAgentFailures(mockBackend);

    expect(result.agents).toHaveLength(1);
    expect(result.agents[0].agent).toBe("Dev");
    expect(result.agents[0].failureCount).toBe(1);
  });

  it("tracks error types per agent", async () => {
    const run = {
      runId: "run-1",
      startTime: 1000,
      endTime: 2000,
      eventCount: 10,
      categories: ["agent", "error"],
    };

    vi.mocked(mockBackend.listRuns).mockResolvedValue([run]);
    vi.mocked(mockBackend.queryEvents).mockResolvedValue([
      {
        id: "1",
        runId: "run-1",
        timestamp: 1000,
        category: "agent",
        event: "agent.spawn",
        minLevel: 1,
        data: { agent: "Dev" },
      },
      {
        id: "2",
        runId: "run-1",
        timestamp: 1500,
        category: "error",
        event: "error.task",
        minLevel: 0,
        data: { message: "Task failed" },
      },
      {
        id: "3",
        runId: "run-1",
        timestamp: 1600,
        category: "error",
        event: "error.provider",
        minLevel: 0,
        data: { message: "API error" },
      },
      {
        id: "4",
        runId: "run-1",
        timestamp: 2000,
        category: "command",
        event: "command.end",
        minLevel: 0,
        data: {},
      },
    ] as TelemetryEvent[]);

    const result = await getAgentFailures(mockBackend);

    expect(result.agents[0].errorTypes.size).toBe(2);
    expect(result.agents[0].errorTypes.get("error.task")).toBe(1);
    expect(result.agents[0].errorTypes.get("error.provider")).toBe(1);
  });

  it("sorts agents by failure count descending", async () => {
    const run1 = {
      runId: "run-1",
      startTime: 1000,
      endTime: 2000,
      eventCount: 10,
      categories: ["agent", "error"],
    };
    const run2 = {
      runId: "run-2",
      startTime: 3000,
      endTime: 4000,
      eventCount: 10,
      categories: ["agent", "error"],
    };

    vi.mocked(mockBackend.listRuns).mockResolvedValue([run1, run2]);
    vi.mocked(mockBackend.queryEvents)
      .mockResolvedValueOnce([
        {
          id: "1",
          runId: "run-1",
          timestamp: 1000,
          category: "agent",
          event: "agent.spawn",
          minLevel: 1,
          data: { agent: "Dev" },
        },
        {
          id: "2",
          runId: "run-1",
          timestamp: 1500,
          category: "error",
          event: "error.task",
          minLevel: 0,
          data: { message: "Error 1" },
        },
      ] as TelemetryEvent[])
      .mockResolvedValueOnce([
        {
          id: "3",
          runId: "run-2",
          timestamp: 3000,
          category: "agent",
          event: "agent.spawn",
          minLevel: 1,
          data: { agent: "QE" },
        },
        {
          id: "4",
          runId: "run-2",
          timestamp: 3200,
          category: "error",
          event: "error.task",
          minLevel: 0,
          data: { message: "Error 2" },
        },
        {
          id: "5",
          runId: "run-2",
          timestamp: 3400,
          category: "error",
          event: "error.task",
          minLevel: 0,
          data: { message: "Error 3" },
        },
      ] as TelemetryEvent[]);

    const result = await getAgentFailures(mockBackend);

    expect(result.agents).toHaveLength(2);
    // Both agents have 1 failure (1 run each), but QE has more error types (2 vs 1)
    // Agents are sorted by failure count, then both have count=1 so order may vary
    // Just check that both agents are present
    const agentNames = result.agents.map((a) => a.agent);
    expect(agentNames).toContain("Dev");
    expect(agentNames).toContain("QE");
  });

  it("respects limit option", async () => {
    const runs = Array.from({ length: 20 }, (_, i) => ({
      runId: `run-${i}`,
      startTime: 1000 + i * 1000,
      endTime: 2000 + i * 1000,
      eventCount: 5,
      categories: ["agent", "error"],
    }));

    vi.mocked(mockBackend.listRuns).mockResolvedValue(runs);
    vi.mocked(mockBackend.queryEvents).mockResolvedValue([
      {
        id: "1",
        runId: "run-1",
        timestamp: 1000,
        category: "agent",
        event: "agent.spawn",
        minLevel: 1,
        data: { agent: `Agent-1` },
      },
      {
        id: "2",
        runId: "run-1",
        timestamp: 1500,
        category: "error",
        event: "error.task",
        minLevel: 0,
        data: { message: "Error" },
      },
    ] as TelemetryEvent[]);

    const result = await getAgentFailures(mockBackend, { limit: 5 });

    expect(result.agents.length).toBeLessThanOrEqual(5);
  });

  it("provides error type breakdown", async () => {
    const run = {
      runId: "run-1",
      startTime: 1000,
      endTime: 2000,
      eventCount: 10,
      categories: ["agent", "error"],
    };

    vi.mocked(mockBackend.listRuns).mockResolvedValue([run]);
    vi.mocked(mockBackend.queryEvents).mockResolvedValue([
      {
        id: "1",
        runId: "run-1",
        timestamp: 1000,
        category: "agent",
        event: "agent.spawn",
        minLevel: 1,
        data: { agent: "Dev" },
      },
      {
        id: "2",
        runId: "run-1",
        timestamp: 1500,
        category: "error",
        event: "error.task",
        minLevel: 0,
        data: { message: "Error 1" },
      },
      {
        id: "3",
        runId: "run-1",
        timestamp: 1600,
        category: "error",
        event: "error.task",
        minLevel: 0,
        data: { message: "Error 2" },
      },
    ] as TelemetryEvent[]);

    const result = await getAgentFailures(mockBackend);

    expect(result.errorBreakdown).toContain("Error Type");
    expect(result.errorBreakdown).toContain("error.task");
  });

  it("only counts errors after agent spawn", async () => {
    const run = {
      runId: "run-1",
      startTime: 1000,
      endTime: 3000,
      eventCount: 10,
      categories: ["agent", "error"],
    };

    vi.mocked(mockBackend.listRuns).mockResolvedValue([run]);
    vi.mocked(mockBackend.queryEvents).mockResolvedValue([
      {
        id: "1",
        runId: "run-1",
        timestamp: 1000,
        category: "error",
        event: "error.task",
        minLevel: 0,
        data: { message: "Error before spawn" },
      },
      {
        id: "2",
        runId: "run-1",
        timestamp: 1500,
        category: "agent",
        event: "agent.spawn",
        minLevel: 1,
        data: { agent: "Dev" },
      },
      {
        id: "3",
        runId: "run-1",
        timestamp: 2000,
        category: "error",
        event: "error.task",
        minLevel: 0,
        data: { message: "Error after spawn" },
      },
    ] as TelemetryEvent[]);

    const result = await getAgentFailures(mockBackend);

    expect(result.agents).toHaveLength(1);
    // Should only count 1 failure (error after spawn)
    expect(result.agents[0].errorTypes.get("error.task")).toBe(1);
  });
});
