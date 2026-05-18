import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SqliteBackend } from "../chesstrace/backends/sqlite.js";
import type { TelemetryEvent } from "../chesstrace/events.js";
import { Events, TelemetryLevel } from "../chesstrace/events.js";
import { lastCommandImpl } from "./last.js";
import * as config from "../config.js";

describe("last command", () => {
  let testDir: string;
  let backend: SqliteBackend;
  let originalConsoleLog: typeof console.log;
  let consoleOutput: string[];

  beforeEach(async () => {
    // Create temp directory for test database
    testDir = mkdtempSync(join(tmpdir(), "reygent-last-test-"));
    const dbPath = join(testDir, "chesstrace.db");
    backend = new SqliteBackend("global", dbPath);
    await backend.init();

    // Mock console.log to capture output
    consoleOutput = [];
    originalConsoleLog = console.log;
    console.log = vi.fn((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(" "));
    });

    // Mock config to return enabled telemetry
    vi.spyOn(config, "loadConfig").mockReturnValue({
      telemetry: {
        enabled: true,
        level: "standard",
        backend: "sqlite",
        retention: 30,
      },
    } as ReturnType<typeof config.loadConfig>);
  });

  afterEach(async () => {
    console.log = originalConsoleLog;
    await backend.close();
    rmSync(testDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("should handle empty database gracefully", async () => {
    await lastCommandImpl({}, backend);

    const output = consoleOutput.join("\n");
    expect(output).toContain("Run a reygent command to generate telemetry data");
  });

  it("should display summary for latest run", async () => {
    const runId = "test-run-123";
    const now = Date.now();

    const events: TelemetryEvent[] = [
      {
        id: "evt-1",
        runId,
        timestamp: now,
        category: "pipeline",
        event: Events.PIPELINE_START,
        minLevel: TelemetryLevel.standard,
        data: {},
      },
      {
        id: "evt-2",
        runId,
        timestamp: now + 1000,
        category: "agent",
        event: Events.AGENT_SPAWN,
        minLevel: TelemetryLevel.standard,
        data: { agent: "dev", model: "claude-sonnet-4", provider: "anthropic" },
      },
      {
        id: "evt-3",
        runId,
        timestamp: now + 5000,
        category: "agent",
        event: Events.AGENT_COMPLETE,
        minLevel: TelemetryLevel.standard,
        data: { agent: "dev", success: true, duration: 4000 },
      },
      {
        id: "evt-4",
        runId,
        timestamp: now + 10000,
        category: "pipeline",
        event: Events.PIPELINE_END,
        minLevel: TelemetryLevel.standard,
        data: { success: true },
      },
    ];

    await backend.writeBatch(events);

    // Test should not throw
    await lastCommandImpl({}, backend);

    // Check that summary was displayed
    const output = consoleOutput.join("\n");
    expect(output).toContain("Latest Run Summary");
    expect(output).toContain("Success");
    expect(output).toContain("dev");
  });

  it("should display errors when --errors flag is used", async () => {
    const runId = "test-run-456";
    const now = Date.now();

    const events: TelemetryEvent[] = [
      {
        id: "evt-1",
        runId,
        timestamp: now,
        category: "pipeline",
        event: Events.PIPELINE_START,
        minLevel: TelemetryLevel.standard,
        data: {},
      },
      {
        id: "evt-2",
        runId,
        timestamp: now + 1000,
        category: "error",
        event: Events.ERROR_TASK,
        minLevel: TelemetryLevel.minimal,
        data: { agent: "dev", message: "Test error message" },
      },
      {
        id: "evt-3",
        runId,
        timestamp: now + 5000,
        category: "pipeline",
        event: Events.PIPELINE_END,
        minLevel: TelemetryLevel.standard,
        data: { success: false },
      },
    ];

    await backend.writeBatch(events);
    await lastCommandImpl({ errors: true }, backend);

    const output = consoleOutput.join("\n");
    expect(output).toContain("Errors");
    expect(output).toContain("Test error message");
  });

  it("should output JSON when --json flag is used", async () => {
    const runId = "test-run-789";
    const now = Date.now();

    const events: TelemetryEvent[] = [
      {
        id: "evt-1",
        runId,
        timestamp: now,
        category: "pipeline",
        event: Events.PIPELINE_START,
        minLevel: TelemetryLevel.standard,
        data: {},
      },
      {
        id: "evt-2",
        runId,
        timestamp: now + 5000,
        category: "pipeline",
        event: Events.PIPELINE_END,
        minLevel: TelemetryLevel.standard,
        data: { success: true },
      },
    ];

    await backend.writeBatch(events);
    await lastCommandImpl({ json: true }, backend);

    const output = consoleOutput.join("\n");
    // Should be valid JSON
    expect(() => JSON.parse(output)).not.toThrow();
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("runId");
    expect(parsed).toHaveProperty("events");
    expect(parsed.events).toHaveLength(2);
  });

  it("should show success when only COMMAND_END exists (no PIPELINE_END)", async () => {
    const runId = "test-run-no-pipeline";
    const now = Date.now();

    const events: TelemetryEvent[] = [
      {
        id: "evt-1",
        runId,
        timestamp: now,
        category: "command",
        event: Events.COMMAND_START,
        minLevel: TelemetryLevel.minimal,
        data: { command: "review-comments" },
      },
      {
        id: "evt-2",
        runId,
        timestamp: now + 1000,
        category: "agent",
        event: Events.AGENT_SPAWN,
        minLevel: TelemetryLevel.standard,
        data: { agent: "planner", model: "claude-sonnet-4", provider: "anthropic" },
      },
      {
        id: "evt-3",
        runId,
        timestamp: now + 5000,
        category: "agent",
        event: Events.AGENT_COMPLETE,
        minLevel: TelemetryLevel.standard,
        data: { agent: "planner", exitCode: 0, success: true, duration: 4000 },
      },
      {
        id: "evt-4",
        runId,
        timestamp: now + 10000,
        category: "command",
        event: Events.COMMAND_END,
        minLevel: TelemetryLevel.minimal,
        data: { command: "review-comments", success: true, durationMs: 10000 },
      },
    ];

    await backend.writeBatch(events);
    await lastCommandImpl({}, backend);

    const output = consoleOutput.join("\n");
    expect(output).toContain("Latest Run Summary");
    expect(output).toContain("Success");
    expect(output).not.toContain("Failed");
  });

  it("should show failed when COMMAND_END has success false and no PIPELINE_END", async () => {
    const runId = "test-run-cmd-fail";
    const now = Date.now();

    const events: TelemetryEvent[] = [
      {
        id: "evt-1",
        runId,
        timestamp: now,
        category: "command",
        event: Events.COMMAND_START,
        minLevel: TelemetryLevel.minimal,
        data: { command: "review-comments" },
      },
      {
        id: "evt-2",
        runId,
        timestamp: now + 5000,
        category: "command",
        event: Events.COMMAND_END,
        minLevel: TelemetryLevel.minimal,
        data: { command: "review-comments", success: false, durationMs: 5000 },
      },
    ];

    await backend.writeBatch(events);
    await lastCommandImpl({}, backend);

    const output = consoleOutput.join("\n");
    expect(output).toContain("Failed");
    expect(output).not.toContain("Success");
  });

  it("should prefer PIPELINE_END over COMMAND_END when both exist", async () => {
    const runId = "test-run-both";
    const now = Date.now();

    const events: TelemetryEvent[] = [
      {
        id: "evt-1",
        runId,
        timestamp: now,
        category: "pipeline",
        event: Events.PIPELINE_START,
        minLevel: TelemetryLevel.standard,
        data: {},
      },
      {
        id: "evt-2",
        runId,
        timestamp: now + 5000,
        category: "pipeline",
        event: Events.PIPELINE_END,
        minLevel: TelemetryLevel.standard,
        data: { success: false },
      },
      {
        id: "evt-3",
        runId,
        timestamp: now + 5001,
        category: "command",
        event: Events.COMMAND_END,
        minLevel: TelemetryLevel.minimal,
        data: { command: "run", success: true, durationMs: 5000 },
      },
    ];

    await backend.writeBatch(events);
    await lastCommandImpl({}, backend);

    const output = consoleOutput.join("\n");
    // PIPELINE_END says false, so should be Failed even though COMMAND_END says true
    expect(output).toContain("Failed");
  });

  it("should format costs correctly", async () => {
    const runId = "test-run-cost";
    const now = Date.now();

    const events: TelemetryEvent[] = [
      {
        id: "evt-1",
        runId,
        timestamp: now,
        category: "pipeline",
        event: Events.PIPELINE_START,
        minLevel: TelemetryLevel.standard,
        data: {},
      },
      {
        id: "evt-2",
        runId,
        timestamp: now + 1000,
        category: "usage",
        event: Events.USAGE_COST,
        minLevel: TelemetryLevel.verbose,
        data: { agent: "dev", costUsd: 0.0123 },
      },
      {
        id: "evt-3",
        runId,
        timestamp: now + 5000,
        category: "pipeline",
        event: Events.PIPELINE_END,
        minLevel: TelemetryLevel.standard,
        data: { success: true },
      },
    ];

    await backend.writeBatch(events);
    await lastCommandImpl({}, backend);

    const output = consoleOutput.join("\n");
    expect(output).toContain("Cost");
    expect(output).toContain("$0.0123");
  });
});
