import { describe, it, expect, vi, beforeEach } from "vitest";
import { getRunsList } from "./runs-list.js";
import type { StorageBackend } from "../chesstrace/backends/types.js";
import type { TelemetryEvent, TelemetryCategory } from "../chesstrace/events.js";

describe("getRunsList", () => {
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
      categories: ["command"] as TelemetryCategory[],
    };
    const run2 = {
      runId: "run-2",
      startTime: 3000,
      endTime: 4000,
      eventCount: 15,
      categories: ["command"] as TelemetryCategory[],
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

    const result = await getRunsList(mockBackend);

    expect(result.runs[0].status).toBe("success");
  });

  it("correctly identifies failure status", async () => {
    const run = {
      runId: "run-1",
      startTime: 1000,
      endTime: 2000,
      eventCount: 5,
      categories: ["command", "error"] as TelemetryCategory[],
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
      endTime: undefined as unknown as number,
      eventCount: 3,
      categories: ["agent"] as TelemetryCategory[],
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
      categories: ["agent"] as TelemetryCategory[],
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
      categories: ["command"] as TelemetryCategory[],
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

  it("marks command.error runs as failure", async () => {
    const run = {
      runId: "run-1",
      startTime: 1000,
      endTime: 2000,
      eventCount: 2,
      categories: ["command"] as TelemetryCategory[],
    };

    vi.mocked(mockBackend.listRuns).mockResolvedValue([run]);
    vi.mocked(mockBackend.query).mockResolvedValue([
      {
        id: "1",
        runId: "run-1",
        timestamp: 1000,
        category: "command",
        event: "command.start",
        minLevel: 0,
        data: { command: "spec" },
      },
      {
        id: "2",
        runId: "run-1",
        timestamp: 1500,
        category: "command",
        event: "command.error",
        minLevel: 0,
        data: { command: "spec", error: "boom" },
      },
    ] as TelemetryEvent[]);

    const result = await getRunsList(mockBackend);

    expect(result.runs[0].status).toBe("failure");
  });

  it("includeErrors keeps error runs that fall outside the limit window", async () => {
    // 12 runs total, the oldest two have errors. With limit=10 the error runs
    // would normally be dropped; includeErrors should bring them back.
    const runs = Array.from({ length: 12 }, (_, i) => ({
      runId: `run-${i}`,
      startTime: 1000 + i, // newer = higher index
      endTime: 2000 + i,
      eventCount: 5,
      categories: ["command"] as TelemetryCategory[],
    }));

    vi.mocked(mockBackend.listRuns).mockResolvedValue(runs);
    vi.mocked(mockBackend.query).mockImplementation(async (q) => {
      const runId = (q as { runId: string }).runId;
      // run-0 and run-1 are the two oldest and have errors
      if (runId === "run-0" || runId === "run-1") {
        return [
          {
            id: `${runId}-1`,
            runId,
            timestamp: 1000,
            category: "command",
            event: "command.end",
            minLevel: 0,
            data: {},
          },
          {
            id: `${runId}-2`,
            runId,
            timestamp: 1500,
            category: "error",
            event: "error.task",
            minLevel: 0,
            data: { message: "x" },
          },
        ] as TelemetryEvent[];
      }
      return [
        {
          id: `${runId}-1`,
          runId,
          timestamp: 1000,
          category: "command",
          event: "command.end",
          minLevel: 0,
          data: {},
        },
      ] as TelemetryEvent[];
    });

    const withoutFlag = await getRunsList(mockBackend, { limit: 10 });
    expect(withoutFlag.runs).toHaveLength(10);
    expect(withoutFlag.runs.some((r) => r.runId === "run-0")).toBe(false);
    expect(withoutFlag.runs.some((r) => r.runId === "run-1")).toBe(false);

    const withFlag = await getRunsList(mockBackend, {
      limit: 10,
      includeErrors: true,
    });
    expect(withFlag.runs).toHaveLength(12);
    expect(withFlag.runs.some((r) => r.runId === "run-0")).toBe(true);
    expect(withFlag.runs.some((r) => r.runId === "run-1")).toBe(true);
  });

  it("filters by time range when since is provided", async () => {
    const run1 = {
      runId: "run-1",
      startTime: Date.now() - 86400000 * 40, // 40 days ago
      endTime: Date.now() - 86400000 * 40 + 1000,
      eventCount: 5,
      categories: ["command"] as TelemetryCategory[],
    };
    const run2 = {
      runId: "run-2",
      startTime: Date.now() - 86400000 * 20, // 20 days ago
      endTime: Date.now() - 86400000 * 20 + 1000,
      eventCount: 5,
      categories: ["command"] as TelemetryCategory[],
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
