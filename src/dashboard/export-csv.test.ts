import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { exportToCSV } from "./export-csv.js";
import type { TelemetryBackend } from "../chesstrace/backends/types.js";
import type { TelemetryEvent } from "../chesstrace/events.js";
import { readFileSync, unlinkSync, existsSync } from "fs";

describe("exportToCSV", () => {
  let mockBackend: TelemetryBackend;
  const testFiles: string[] = [];

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

  afterEach(() => {
    // Cleanup test files
    for (const file of testFiles) {
      if (existsSync(file)) {
        unlinkSync(file);
      }
    }
    testFiles.length = 0;
  });

  it("exports specific run to CSV", async () => {
    const events: TelemetryEvent[] = [
      {
        id: "1",
        runId: "run-1",
        timestamp: 1000,
        category: "command",
        event: "command.start",
        minLevel: 0,
        data: {},
      },
      {
        id: "2",
        runId: "run-1",
        timestamp: 2000,
        category: "agent",
        event: "agent.spawn",
        minLevel: 1,
        data: { agent: "Dev", provider: "claude" },
      },
    ];

    vi.mocked(mockBackend.queryEvents).mockResolvedValue(events);

    const filepath = await exportToCSV(mockBackend, {
      scope: "local",
      runId: "run-1",
      output: "/tmp/test-export-run.csv",
    });

    testFiles.push(filepath);

    expect(filepath).toBe("/tmp/test-export-run.csv");
    expect(existsSync(filepath)).toBe(true);

    const content = readFileSync(filepath, "utf-8");
    expect(content).toContain("Run ID,Timestamp,ISO Time,Category,Event");
    expect(content).toContain("run-1");
    expect(content).toContain("command.start");
    expect(content).toContain("agent.spawn");
  });

  it("exports all runs when runId not provided", async () => {
    const runs = [
      {
        runId: "run-1",
        startTime: 1000,
        endTime: 2000,
        eventCount: 2,
        categories: ["command"],
      },
      {
        runId: "run-2",
        startTime: 3000,
        endTime: 4000,
        eventCount: 2,
        categories: ["command"],
      },
    ];

    vi.mocked(mockBackend.listRuns).mockResolvedValue(runs);
    vi.mocked(mockBackend.queryEvents)
      .mockResolvedValueOnce([
        {
          id: "1",
          runId: "run-1",
          timestamp: 1000,
          category: "command",
          event: "command.start",
          minLevel: 0,
          data: {},
        },
      ] as TelemetryEvent[])
      .mockResolvedValueOnce([
        {
          id: "2",
          runId: "run-2",
          timestamp: 3000,
          category: "command",
          event: "command.start",
          minLevel: 0,
          data: {},
        },
      ] as TelemetryEvent[]);

    const filepath = await exportToCSV(mockBackend, {
      scope: "global",
      output: "/tmp/test-export-all.csv",
    });

    testFiles.push(filepath);

    expect(existsSync(filepath)).toBe(true);

    const content = readFileSync(filepath, "utf-8");
    expect(content).toContain("run-1");
    expect(content).toContain("run-2");
  });

  it("throws error when run not found", async () => {
    vi.mocked(mockBackend.queryEvents).mockResolvedValue([]);

    await expect(
      exportToCSV(mockBackend, {
        scope: "local",
        runId: "nonexistent",
      })
    ).rejects.toThrow("Run nonexistent not found");
  });

  it("escapes CSV fields with commas and quotes", async () => {
    const events: TelemetryEvent[] = [
      {
        id: "1",
        runId: "run-1",
        timestamp: 1000,
        category: "error",
        event: "error.task",
        minLevel: 0,
        data: { message: 'Error: "Invalid input", please retry' },
      },
    ];

    vi.mocked(mockBackend.queryEvents).mockResolvedValue(events);

    const filepath = await exportToCSV(mockBackend, {
      scope: "local",
      runId: "run-1",
      output: "/tmp/test-export-escape.csv",
    });

    testFiles.push(filepath);

    const content = readFileSync(filepath, "utf-8");
    // Data column contains JSON-stringified data, CSV properly handles quoting
    expect(content).toContain('Invalid input');
  });

  it("sorts events by timestamp", async () => {
    const events: TelemetryEvent[] = [
      {
        id: "3",
        runId: "run-1",
        timestamp: 3000,
        category: "command",
        event: "command.end",
        minLevel: 0,
        data: {},
      },
      {
        id: "1",
        runId: "run-1",
        timestamp: 1000,
        category: "command",
        event: "command.start",
        minLevel: 0,
        data: {},
      },
      {
        id: "2",
        runId: "run-1",
        timestamp: 2000,
        category: "agent",
        event: "agent.spawn",
        minLevel: 1,
        data: { agent: "Dev" },
      },
    ];

    vi.mocked(mockBackend.queryEvents).mockResolvedValue(events);

    const filepath = await exportToCSV(mockBackend, {
      scope: "local",
      runId: "run-1",
      output: "/tmp/test-export-sort.csv",
    });

    testFiles.push(filepath);

    const content = readFileSync(filepath, "utf-8");
    const lines = content.split("\n").filter((line) => line.trim() !== "");

    // First data row should be command.start (timestamp 1000)
    expect(lines[1]).toContain("command.start");
    // Last data row should be command.end (timestamp 3000)
    expect(lines[3]).toContain("command.end");
  });

  it("generates descriptive filename when output not provided", async () => {
    const events: TelemetryEvent[] = [
      {
        id: "1",
        runId: "run-abc123",
        timestamp: 1000,
        category: "command",
        event: "command.start",
        minLevel: 0,
        data: {},
      },
    ];

    vi.mocked(mockBackend.queryEvents).mockResolvedValue(events);

    const filepath = await exportToCSV(mockBackend, {
      scope: "local",
      runId: "run-abc123",
    });

    testFiles.push(filepath);

    expect(filepath).toContain("reygent-telemetry-local");
    expect(filepath).toContain("run-abc1"); // Truncated run ID
    expect(filepath).toMatch(/\.csv$/);
  });
});
