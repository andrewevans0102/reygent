import { describe, it, expect, vi, beforeEach } from "vitest";
import { getRunDetail } from "./run-detail.js";
import type { TelemetryBackend } from "../chesstrace/backends/types.js";
import type { TelemetryEvent } from "../chesstrace/events.js";

describe("getRunDetail", () => {
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

  it("returns null when run not found", async () => {
    vi.mocked(mockBackend.queryEvents).mockResolvedValue([]);

    const result = await getRunDetail(mockBackend, "nonexistent-run");

    expect(result).toBeNull();
  });

  it("returns run detail with summary and events", async () => {
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
        data: { agent: "Dev", provider: "claude", model: "claude-sonnet-4-5" },
      },
      {
        id: "3",
        runId: "run-1",
        timestamp: 3000,
        category: "command",
        event: "command.end",
        minLevel: 0,
        data: {},
      },
    ];

    vi.mocked(mockBackend.queryEvents).mockResolvedValue(events);

    const result = await getRunDetail(mockBackend, "run-1");

    expect(result).not.toBeNull();
    expect(result!.runId).toBe("run-1");
    expect(result!.eventCount).toBe(3);
    expect(result!.summary).toContain("Run ID:");
    expect(result!.summary).toContain("Status:");
    expect(result!.events).toContain("command.start");
  });

  it("identifies success status correctly", async () => {
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
        category: "command",
        event: "command.end",
        minLevel: 0,
        data: {},
      },
    ];

    vi.mocked(mockBackend.queryEvents).mockResolvedValue(events);

    const result = await getRunDetail(mockBackend, "run-1");

    expect(result!.summary).toContain("success");
  });

  it("identifies failure status correctly", async () => {
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
        category: "error",
        event: "error.task",
        minLevel: 0,
        data: { message: "Test error" },
      },
      {
        id: "3",
        runId: "run-1",
        timestamp: 3000,
        category: "command",
        event: "command.end",
        minLevel: 0,
        data: {},
      },
    ];

    vi.mocked(mockBackend.queryEvents).mockResolvedValue(events);

    const result = await getRunDetail(mockBackend, "run-1");

    expect(result!.summary).toContain("failure");
    expect(result!.summary).toContain("Errors:");
  });

  it("shows cost when available", async () => {
    const events: TelemetryEvent[] = [
      {
        id: "1",
        runId: "run-1",
        timestamp: 1000,
        category: "usage",
        event: "usage.cost",
        minLevel: 1,
        data: { cost: 0.1234 },
      },
      {
        id: "2",
        runId: "run-1",
        timestamp: 2000,
        category: "usage",
        event: "usage.cost",
        minLevel: 1,
        data: { cost: 0.0566 },
      },
      {
        id: "3",
        runId: "run-1",
        timestamp: 3000,
        category: "command",
        event: "command.end",
        minLevel: 0,
        data: {},
      },
    ];

    vi.mocked(mockBackend.queryEvents).mockResolvedValue(events);

    const result = await getRunDetail(mockBackend, "run-1");

    expect(result!.summary).toContain("Cost:");
    expect(result!.summary).toContain("$0.1800");
  });

  it("counts agents correctly", async () => {
    const events: TelemetryEvent[] = [
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
        timestamp: 2000,
        category: "agent",
        event: "agent.spawn",
        minLevel: 1,
        data: { agent: "QE" },
      },
      {
        id: "3",
        runId: "run-1",
        timestamp: 3000,
        category: "command",
        event: "command.end",
        minLevel: 0,
        data: {},
      },
    ];

    vi.mocked(mockBackend.queryEvents).mockResolvedValue(events);

    const result = await getRunDetail(mockBackend, "run-1");

    expect(result!.summary).toContain("Agents: 2");
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

    const result = await getRunDetail(mockBackend, "run-1");

    // Events table should have command.start first
    const eventsTable = result!.events;
    const startIdx = eventsTable.indexOf("command.start");
    const endIdx = eventsTable.indexOf("command.end");
    expect(startIdx).toBeLessThan(endIdx);
  });
});
