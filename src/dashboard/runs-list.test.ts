import { describe, it, expect, vi, beforeEach } from "vitest";
import { getRunsList } from "./runs-list.js";
import type { TelemetryBackend } from "../chesstrace/backends/types.js";
import type { TelemetryEvent } from "../chesstrace/events.js";

describe("getRunsList", () => {
  let mockBackend: TelemetryBackend;

  beforeEach(() => {
    mockBackend = {
      init: vi.fn(),
      emit: vi.fn(),
      flush: vi.fn(),
      close: vi.fn(),
      listRuns: vi.fn(),
      query: vi.fn(),
    };
  });

  it("returns empty list when no runs exist", async () => {
    vi.mocked(mockBackend.listRuns).mockResolvedValue([]);

    const result = await getRunsList(mockBackend);

    expect(result.runs).toHaveLength(0);
    expect(result.table).toContain("Run ID");
  });

  it("lists runs sorted by start time descending", async () => {
    const run1 = {
      runId: "run-1",
      startTime: 1000,
      endTime: 2000,
      eventCount: 10,
      categories: ["command"],
    };
    const run2 = {
      runId: "run-2",
      startTime: 3000,
      endTime: 4000,
      eventCount: 15,
      categories: ["command"],
    };

    vi.mocked(mockBackend.listRuns).mockResolvedValue([run1, run2]);
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

    const result = await getRunsList(mockBackend);

    expect(result.runs).toHaveLength(2);
    expect(result.runs[0].runId).toBe("run-2"); // Newer first
    expect(result.runs[1].runId).toBe("run-1");
  });

  it("correctly identifies success status", async () => {
    const run = {
      runId: "run-1",
      startTime: 1000,
      endTime: 2000,
      eventCount: 5,
      categories: ["command"],
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

    const result = await getRunsList(mockBackend);

    expect(result.runs[0].status).toBe("success");
  });

  it("correctly identifies failure status", async () => {
    const run = {
      runId: "run-1",
      startTime: 1000,
      endTime: 2000,
      eventCount: 5,
      categories: ["command", "error"],
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
      {
        id: "2",
        runId: "run-1",
        timestamp: 1500,
        category: "error",
        event: "error.task",
        minLevel: 0,
        data: { message: "Test error" },
      },
    ] as TelemetryEvent[]);

    const result = await getRunsList(mockBackend);

    expect(result.runs[0].status).toBe("failure");
    expect(result.runs[0].errorCount).toBe(1);
  });

  it("correctly identifies incomplete status", async () => {
    const run = {
      runId: "run-1",
      startTime: 1000,
      endTime: undefined,
      eventCount: 3,
      categories: ["agent"],
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
    ] as TelemetryEvent[]);

    const result = await getRunsList(mockBackend);

    expect(result.runs[0].status).toBe("incomplete");
  });

  it("counts agents correctly", async () => {
    const run = {
      runId: "run-1",
      startTime: 1000,
      endTime: 2000,
      eventCount: 10,
      categories: ["agent"],
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
        timestamp: 1500,
        category: "agent",
        event: "agent.spawn",
        minLevel: 1,
        data: { agent: "QE" },
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

    const result = await getRunsList(mockBackend);

    expect(result.runs[0].agentCount).toBe(2);
  });

  it("respects limit option", async () => {
    const runs = Array.from({ length: 100 }, (_, i) => ({
      runId: `run-${i}`,
      startTime: 1000 + i,
      endTime: 2000 + i,
      eventCount: 5,
      categories: ["command"],
    }));

    vi.mocked(mockBackend.listRuns).mockResolvedValue(runs);
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

    const result = await getRunsList(mockBackend, { limit: 10 });

    expect(result.runs).toHaveLength(10);
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
    vi.mocked(mockBackend.query).mockResolvedValue([
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

    const result = await getRunsList(mockBackend, { since: "30d" });

    expect(result.runs).toHaveLength(1);
    expect(result.runs[0].runId).toBe("run-2");
  });
});
