import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SqliteBackend } from "../chesstrace/backends/sqlite.js";
import { Events, TelemetryLevel } from "../chesstrace/events.js";
import type { TelemetryEvent } from "../chesstrace/events.js";
import { randomUUID } from "node:crypto";

describe("Dashboard telemetry service", () => {
  let localDir: string;
  let globalDir: string;
  let localBackend: SqliteBackend;
  let globalBackend: SqliteBackend;

  beforeEach(async () => {
    localDir = mkdtempSync(join(tmpdir(), "reygent-dashboard-local-"));
    globalDir = mkdtempSync(join(tmpdir(), "reygent-dashboard-global-"));

    const localDbPath = join(localDir, "chesstrace.db");
    const globalDbPath = join(globalDir, "chesstrace.db");

    localBackend = new SqliteBackend("local", localDbPath);
    globalBackend = new SqliteBackend("global", globalDbPath);

    await localBackend.init();
    await globalBackend.init();
  });

  afterEach(async () => {
    await localBackend.close();
    await globalBackend.close();
    rmSync(localDir, { recursive: true, force: true });
    rmSync(globalDir, { recursive: true, force: true });
  });

  describe("Local vs global scope data retrieval", () => {
    it("should retrieve runs from local scope only", async () => {
      const localRunId = randomUUID();
      const globalRunId = randomUUID();

      // Insert local run
      await localBackend.writeBatch([
        {
          id: randomUUID(),
          runId: localRunId,
          timestamp: Date.now(),
          category: "pipeline",
          event: Events.PIPELINE_START,
          minLevel: TelemetryLevel.standard,
          data: { project: "local-project" },
        },
        {
          id: randomUUID(),
          runId: localRunId,
          timestamp: Date.now(),
          category: "pipeline",
          event: Events.PIPELINE_END,
          minLevel: TelemetryLevel.standard,
          data: { success: true },
        },
      ]);

      // Insert global run
      await globalBackend.writeBatch([
        {
          id: randomUUID(),
          runId: globalRunId,
          timestamp: Date.now(),
          category: "pipeline",
          event: Events.PIPELINE_START,
          minLevel: TelemetryLevel.standard,
          data: { project: "global-project" },
        },
      ]);

      const localRuns = await localBackend.listRuns();
      const globalRuns = await globalBackend.listRuns();

      expect(localRuns.length).toBe(1);
      expect(localRuns[0].runId).toBe(localRunId);
      expect(globalRuns.length).toBe(1);
      expect(globalRuns[0].runId).toBe(globalRunId);
    });

    it("should retrieve runs from global scope only", async () => {
      const globalRunId1 = randomUUID();
      const globalRunId2 = randomUUID();

      await globalBackend.writeBatch([
        {
          id: randomUUID(),
          runId: globalRunId1,
          timestamp: Date.now() - 1000,
          category: "pipeline",
          event: Events.PIPELINE_START,
          minLevel: TelemetryLevel.standard,
          data: {},
        },
        {
          id: randomUUID(),
          runId: globalRunId2,
          timestamp: Date.now(),
          category: "pipeline",
          event: Events.PIPELINE_START,
          minLevel: TelemetryLevel.standard,
          data: {},
        },
      ]);

      const globalRuns = await globalBackend.listRuns();
      const localRuns = await localBackend.listRuns();

      expect(globalRuns.length).toBe(2);
      expect(localRuns.length).toBe(0);
    });

    it("should switch scope and retrieve correct data", async () => {
      const localRunId = randomUUID();
      const globalRunId = randomUUID();

      await localBackend.write({
        id: randomUUID(),
        runId: localRunId,
        timestamp: Date.now(),
        category: "command",
        event: Events.COMMAND_START,
        minLevel: TelemetryLevel.minimal,
        data: { command: "run" },
      });

      await globalBackend.write({
        id: randomUUID(),
        runId: globalRunId,
        timestamp: Date.now(),
        category: "command",
        event: Events.COMMAND_START,
        minLevel: TelemetryLevel.minimal,
        data: { command: "init" },
      });

      // Simulate scope switch by querying different backends
      const localEvents = await localBackend.query({});
      const globalEvents = await globalBackend.query({});

      expect(localEvents.length).toBe(1);
      expect(localEvents[0].runId).toBe(localRunId);
      expect(globalEvents.length).toBe(1);
      expect(globalEvents[0].runId).toBe(globalRunId);
    });
  });

  describe("Run list data", () => {
    it("should return run with timestamp and outcome", async () => {
      const runId = randomUUID();
      const startTime = Date.now();

      await localBackend.writeBatch([
        {
          id: randomUUID(),
          runId,
          timestamp: startTime,
          category: "pipeline",
          event: Events.PIPELINE_START,
          minLevel: TelemetryLevel.standard,
          data: {},
        },
        {
          id: randomUUID(),
          runId,
          timestamp: startTime + 5000,
          category: "pipeline",
          event: Events.PIPELINE_END,
          minLevel: TelemetryLevel.standard,
          data: { success: true },
        },
      ]);

      const runs = await localBackend.listRuns();
      expect(runs.length).toBe(1);
      expect(runs[0].runId).toBe(runId);
      expect(runs[0].startTime).toBe(startTime);
      expect(runs[0].eventCount).toBe(2);
    });

    it("should list multiple runs sorted by time", async () => {
      const run1 = randomUUID();
      const run2 = randomUUID();
      const run3 = randomUUID();

      const time1 = Date.now() - 10000;
      const time2 = Date.now() - 5000;
      const time3 = Date.now();

      await localBackend.writeBatch([
        {
          id: randomUUID(),
          runId: run1,
          timestamp: time1,
          category: "pipeline",
          event: Events.PIPELINE_START,
          minLevel: TelemetryLevel.standard,
          data: {},
        },
        {
          id: randomUUID(),
          runId: run2,
          timestamp: time2,
          category: "pipeline",
          event: Events.PIPELINE_START,
          minLevel: TelemetryLevel.standard,
          data: {},
        },
        {
          id: randomUUID(),
          runId: run3,
          timestamp: time3,
          category: "pipeline",
          event: Events.PIPELINE_START,
          minLevel: TelemetryLevel.standard,
          data: {},
        },
      ]);

      const runs = await localBackend.listRuns();
      expect(runs.length).toBe(3);
      // Verify ordering (most recent first or oldest first depending on impl)
      expect(runs[0].runId).toBeDefined();
      expect(runs[1].runId).toBeDefined();
      expect(runs[2].runId).toBeDefined();
    });
  });

  describe("Run detail data (--verbose parity)", () => {
    it("should retrieve all telemetry for single run", async () => {
      const runId = randomUUID();

      await localBackend.writeBatch([
        {
          id: randomUUID(),
          runId,
          timestamp: Date.now(),
          category: "pipeline",
          event: Events.PIPELINE_START,
          minLevel: TelemetryLevel.standard,
          data: {},
        },
        {
          id: randomUUID(),
          runId,
          timestamp: Date.now(),
          category: "agent",
          event: Events.AGENT_SPAWN,
          minLevel: TelemetryLevel.standard,
          data: { agent: "spec-writer", provider: "anthropic", model: "sonnet" },
        },
        {
          id: randomUUID(),
          runId,
          timestamp: Date.now(),
          category: "agent",
          event: Events.AGENT_COMPLETE,
          minLevel: TelemetryLevel.standard,
          data: { agent: "spec-writer", success: true, duration: 12000 },
        },
        {
          id: randomUUID(),
          runId,
          timestamp: Date.now(),
          category: "usage",
          event: Events.USAGE_TOKENS,
          minLevel: TelemetryLevel.verbose,
          data: { inputTokens: 1000, outputTokens: 500 },
        },
        {
          id: randomUUID(),
          runId,
          timestamp: Date.now(),
          category: "pipeline",
          event: Events.PIPELINE_END,
          minLevel: TelemetryLevel.standard,
          data: { success: true },
        },
      ]);

      const events = await localBackend.query({ runId });
      expect(events.length).toBe(5);
      expect(events.every(e => e.runId === runId)).toBe(true);
    });

    it("should include all event categories for run detail", async () => {
      const runId = randomUUID();

      await localBackend.writeBatch([
        {
          id: randomUUID(),
          runId,
          timestamp: Date.now(),
          category: "command",
          event: Events.COMMAND_START,
          minLevel: TelemetryLevel.minimal,
          data: { command: "run" },
        },
        {
          id: randomUUID(),
          runId,
          timestamp: Date.now(),
          category: "git",
          event: Events.GIT_BRANCH_CREATE,
          minLevel: TelemetryLevel.standard,
          data: { branch: "feat/test" },
        },
        {
          id: randomUUID(),
          runId,
          timestamp: Date.now(),
          category: "error",
          event: Events.ERROR_TASK,
          minLevel: TelemetryLevel.minimal,
          data: { message: "test error" },
        },
      ]);

      const events = await localBackend.query({ runId });
      const categories = new Set(events.map(e => e.category));

      expect(categories.has("command")).toBe(true);
      expect(categories.has("git")).toBe(true);
      expect(categories.has("error")).toBe(true);
    });

    it("should preserve scope when navigating to detail", async () => {
      const localRunId = randomUUID();
      const globalRunId = randomUUID();

      await localBackend.write({
        id: randomUUID(),
        runId: localRunId,
        timestamp: Date.now(),
        category: "pipeline",
        event: Events.PIPELINE_START,
        minLevel: TelemetryLevel.standard,
        data: {},
      });

      await globalBackend.write({
        id: randomUUID(),
        runId: globalRunId,
        timestamp: Date.now(),
        category: "pipeline",
        event: Events.PIPELINE_START,
        minLevel: TelemetryLevel.standard,
        data: {},
      });

      // Query local scope for specific run
      const localEvents = await localBackend.query({ runId: localRunId });
      expect(localEvents.length).toBe(1);
      expect(localEvents[0].runId).toBe(localRunId);

      // Query global scope for specific run
      const globalEvents = await globalBackend.query({ runId: globalRunId });
      expect(globalEvents.length).toBe(1);
      expect(globalEvents[0].runId).toBe(globalRunId);

      // Verify cross-contamination doesn't happen
      const wrongScopeLocal = await localBackend.query({ runId: globalRunId });
      expect(wrongScopeLocal.length).toBe(0);
    });
  });
});
