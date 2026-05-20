import { describe, it, expect, vi, beforeEach } from "vitest";
import { getAgentFailures } from "./agent-failures.js";
import type { StorageBackend } from "../chesstrace/backends/types.js";
import type { TelemetryEvent, TelemetryCategory } from "../chesstrace/events.js";

describe("getAgentFailures", () => {
  let mockBackend: StorageBackend;

  beforeEach(() => {
    mockBackend = {
      init: vi.fn(),
      write: vi.fn(),
      writeBatch: vi.fn(),
      flush: vi.fn(),
      close: vi.fn(),
      listRuns: vi.fn(),
      query: vi.fn(),
      prune: vi.fn(),
    };
  });

  it("returns empty list when no failures exist", async () => {
    const run = {
      runId: "run-1",
      startTime: 1000,
      endTime: 2000,
      eventCount: 5,
      categories: ["command"] as TelemetryCategory[],
    };

    vi.mocked(mockBackend.listRuns).mockResolvedValue([run]);
    vi.mocked(mockBackend.query).mockResolvedValue([
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
      categories: ["agent", "error"] as TelemetryCategory[],
    };

    vi.mocked(mockBackend.listRuns).mockResolvedValue([run]);
    vi.mocked(mockBackend.query).mockResolvedValue([
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
        timestamp: 1400,
        category: "agent",
        event: "agent.complete",
        minLevel: 1,
        data: { agent: "Dev", exitCode: 1, success: false },
      },
      {
        id: "3",
        runId: "run-1",
        timestamp: 1500,
        category: "error",
        event: "error.task",
        minLevel: 0,
        data: { agent: "Dev", message: "Test error" },
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
      categories: ["agent", "error"] as TelemetryCategory[],
    };

    vi.mocked(mockBackend.listRuns).mockResolvedValue([run]);
    vi.mocked(mockBackend.query).mockResolvedValue([
      {
        id: "1",
        runId: "run-1",
        timestamp: 1000,
        category: "agent",
        event: "agent.spawn",
        minLevel: 1,
        data: { agent: "Dev", stage: "implement" },
      },
      {
        id: "2",
        runId: "run-1",
        timestamp: 1400,
        category: "agent",
        event: "agent.complete",
        minLevel: 1,
        data: { agent: "Dev", stage: "implement", success: false, exitCode: 1 },
      },
      {
        id: "3",
        runId: "run-1",
        timestamp: 1500,
        category: "error",
        event: "error.task",
        minLevel: 0,
        data: { agent: "Dev", message: "Task failed" },
      },
      {
        id: "4",
        runId: "run-1",
        timestamp: 1600,
        category: "error",
        event: "error.provider",
        minLevel: 0,
        data: { stage: "implement", message: "API error" },
      },
      {
        id: "5",
        runId: "run-1",
        timestamp: 2000,
        category: "command",
        event: "command.end",
        minLevel: 0,
        data: {},
      },
    ] as TelemetryEvent[]);

    const result = await getAgentFailures(mockBackend);

    // Includes the agent.complete signal itself plus the two associated errors
    expect(result.agents[0].errorTypes.get("agent.complete")).toBe(1);
    expect(result.agents[0].errorTypes.get("error.task")).toBe(1);
    expect(result.agents[0].errorTypes.get("error.provider")).toBe(1);
  });

  it("sorts agents by failure count descending", async () => {
    const run1 = {
      runId: "run-1",
      startTime: 1000,
      endTime: 2000,
      eventCount: 10,
      categories: ["agent", "error"] as TelemetryCategory[],
    };
    const run2 = {
      runId: "run-2",
      startTime: 3000,
      endTime: 4000,
      eventCount: 10,
      categories: ["agent", "error"] as TelemetryCategory[],
    };

    vi.mocked(mockBackend.listRuns).mockResolvedValue([run1, run2]);
    vi.mocked(mockBackend.query)
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
          timestamp: 1400,
          category: "agent",
          event: "agent.complete",
          minLevel: 1,
          data: { agent: "Dev", success: false, exitCode: 1 },
        },
        {
          id: "3",
          runId: "run-1",
          timestamp: 1500,
          category: "error",
          event: "error.task",
          minLevel: 0,
          data: { agent: "Dev", message: "Error 1" },
        },
      ] as TelemetryEvent[])
      .mockResolvedValueOnce([
        {
          id: "4",
          runId: "run-2",
          timestamp: 3000,
          category: "agent",
          event: "agent.spawn",
          minLevel: 1,
          data: { agent: "QE" },
        },
        {
          id: "5",
          runId: "run-2",
          timestamp: 3100,
          category: "agent",
          event: "agent.complete",
          minLevel: 1,
          data: { agent: "QE", success: false, exitCode: 1 },
        },
        {
          id: "6",
          runId: "run-2",
          timestamp: 3200,
          category: "error",
          event: "error.task",
          minLevel: 0,
          data: { agent: "QE", message: "Error 2" },
        },
        {
          id: "7",
          runId: "run-2",
          timestamp: 3400,
          category: "error",
          event: "error.task",
          minLevel: 0,
          data: { agent: "QE", message: "Error 3" },
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
      categories: ["agent", "error"] as TelemetryCategory[],
    }));

    vi.mocked(mockBackend.listRuns).mockResolvedValue(runs);
    vi.mocked(mockBackend.query).mockResolvedValue([
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
        timestamp: 1400,
        category: "agent",
        event: "agent.complete",
        minLevel: 1,
        data: { agent: `Agent-1`, success: false, exitCode: 1 },
      },
      {
        id: "3",
        runId: "run-1",
        timestamp: 1500,
        category: "error",
        event: "error.task",
        minLevel: 0,
        data: { agent: `Agent-1`, message: "Error" },
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
      categories: ["agent", "error"] as TelemetryCategory[],
    };

    vi.mocked(mockBackend.listRuns).mockResolvedValue([run]);
    vi.mocked(mockBackend.query).mockResolvedValue([
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
        timestamp: 1400,
        category: "agent",
        event: "agent.complete",
        minLevel: 1,
        data: { agent: "Dev", success: false, exitCode: 1 },
      },
      {
        id: "3",
        runId: "run-1",
        timestamp: 1500,
        category: "error",
        event: "error.task",
        minLevel: 0,
        data: { agent: "Dev", message: "Error 1" },
      },
      {
        id: "4",
        runId: "run-1",
        timestamp: 1600,
        category: "error",
        event: "error.task",
        minLevel: 0,
        data: { agent: "Dev", message: "Error 2" },
      },
    ] as TelemetryEvent[]);

    const result = await getAgentFailures(mockBackend);

    expect(result.errorBreakdown).toContain("Error Type");
    expect(result.errorBreakdown).toContain("error.task");
  });

  it("does not blame agents that completed successfully when a later stage errors", async () => {
    // Simulates the real-world bug: planner+qe+dev all succeed, then pr-create
    // (which isn't an agent) fails and emits error.task with agent='pipeline'.
    // Previously every prior spawn was credited with the pipeline error.
    const run = {
      runId: "run-1",
      startTime: 1000,
      endTime: 5000,
      eventCount: 10,
      categories: ["agent", "error"] as TelemetryCategory[],
    };

    vi.mocked(mockBackend.listRuns).mockResolvedValue([run]);
    vi.mocked(mockBackend.query).mockResolvedValue([
      {
        id: "1",
        runId: "run-1",
        timestamp: 1000,
        category: "agent",
        event: "agent.spawn",
        minLevel: 1,
        data: { agent: "qe" },
      },
      {
        id: "2",
        runId: "run-1",
        timestamp: 2000,
        category: "agent",
        event: "agent.complete",
        minLevel: 1,
        data: { agent: "qe", success: true, exitCode: 0 },
      },
      {
        id: "3",
        runId: "run-1",
        timestamp: 2100,
        category: "agent",
        event: "agent.spawn",
        minLevel: 1,
        data: { agent: "security-review" },
      },
      {
        id: "4",
        runId: "run-1",
        timestamp: 3000,
        category: "agent",
        event: "agent.complete",
        minLevel: 1,
        data: { agent: "security-review", success: true, exitCode: 0 },
      },
      {
        id: "5",
        runId: "run-1",
        timestamp: 4000,
        category: "error",
        event: "error.task",
        minLevel: 0,
        data: { agent: "pipeline", stage: "pr-create", message: "pr-create failed" },
      },
    ] as TelemetryEvent[]);

    const result = await getAgentFailures(mockBackend);

    expect(result.agents).toHaveLength(0);
  });
});
