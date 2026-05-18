import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SqliteBackend } from "../chesstrace/backends/sqlite.js";
import { Events, TelemetryLevel } from "../chesstrace/events.js";
import { randomUUID } from "node:crypto";

describe("Dashboard trend visualization", () => {
  let testDir: string;
  let backend: SqliteBackend;

  beforeEach(async () => {
    testDir = mkdtempSync(join(tmpdir(), "reygent-trend-test-"));
    const dbPath = join(testDir, "chesstrace.db");
    backend = new SqliteBackend("local", dbPath);
    await backend.init();
  });

  afterEach(async () => {
    await backend.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("Success vs failure aggregation", () => {
    it("should calculate success rate from pipeline events", async () => {
      const successRun1 = randomUUID();
      const successRun2 = randomUUID();
      const failureRun = randomUUID();

      await backend.writeBatch([
        {
          id: randomUUID(),
          runId: successRun1,
          timestamp: Date.now() - 10000,
          category: "pipeline",
          event: Events.PIPELINE_END,
          minLevel: TelemetryLevel.standard,
          data: { success: true },
        },
        {
          id: randomUUID(),
          runId: successRun2,
          timestamp: Date.now() - 5000,
          category: "pipeline",
          event: Events.PIPELINE_END,
          minLevel: TelemetryLevel.standard,
          data: { success: true },
        },
        {
          id: randomUUID(),
          runId: failureRun,
          timestamp: Date.now(),
          category: "pipeline",
          event: Events.PIPELINE_END,
          minLevel: TelemetryLevel.standard,
          data: { success: false },
        },
      ]);

      const events = await backend.query({ event: Events.PIPELINE_END });
      const successCount = events.filter(e => e.data.success === true).length;
      const totalCount = events.length;
      const successRate = successCount / totalCount;

      expect(totalCount).toBe(3);
      expect(successCount).toBe(2);
      expect(successRate).toBeCloseTo(0.667, 2);
    });

    it("should aggregate success/failure over time windows", async () => {
      const now = Date.now();
      const dayInMs = 24 * 60 * 60 * 1000;

      // Day 1: 2 success, 0 failure
      await backend.writeBatch([
        {
          id: randomUUID(),
          runId: randomUUID(),
          timestamp: now - 2 * dayInMs,
          category: "pipeline",
          event: Events.PIPELINE_END,
          minLevel: TelemetryLevel.standard,
          data: { success: true },
        },
        {
          id: randomUUID(),
          runId: randomUUID(),
          timestamp: now - 2 * dayInMs + 1000,
          category: "pipeline",
          event: Events.PIPELINE_END,
          minLevel: TelemetryLevel.standard,
          data: { success: true },
        },
      ]);

      // Day 2: 1 success, 2 failure
      await backend.writeBatch([
        {
          id: randomUUID(),
          runId: randomUUID(),
          timestamp: now - dayInMs,
          category: "pipeline",
          event: Events.PIPELINE_END,
          minLevel: TelemetryLevel.standard,
          data: { success: true },
        },
        {
          id: randomUUID(),
          runId: randomUUID(),
          timestamp: now - dayInMs + 1000,
          category: "pipeline",
          event: Events.PIPELINE_END,
          minLevel: TelemetryLevel.standard,
          data: { success: false },
        },
        {
          id: randomUUID(),
          runId: randomUUID(),
          timestamp: now - dayInMs + 2000,
          category: "pipeline",
          event: Events.PIPELINE_END,
          minLevel: TelemetryLevel.standard,
          data: { success: false },
        },
      ]);

      const allEvents = await backend.query({ event: Events.PIPELINE_END });

      // Group by day
      const groupByDay = (timestamp: number): string => {
        const date = new Date(timestamp);
        return date.toISOString().split("T")[0];
      };

      const dayGroups = new Map<string, { success: number; failure: number }>();

      for (const event of allEvents) {
        const day = groupByDay(event.timestamp);
        const current = dayGroups.get(day) ?? { success: 0, failure: 0 };

        if (event.data.success) {
          current.success++;
        } else {
          current.failure++;
        }

        dayGroups.set(day, current);
      }

      expect(dayGroups.size).toBe(2);
      const daysArray = Array.from(dayGroups.values());
      expect(daysArray[0].success).toBeGreaterThan(0);
      expect(daysArray[1].failure).toBeGreaterThan(0);
    });

    it("should filter by time range for trend graph", async () => {
      const now = Date.now();
      const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
      const fourteenDaysAgo = now - 14 * 24 * 60 * 60 * 1000;

      await backend.writeBatch([
        {
          id: randomUUID(),
          runId: randomUUID(),
          timestamp: fourteenDaysAgo,
          category: "pipeline",
          event: Events.PIPELINE_END,
          minLevel: TelemetryLevel.standard,
          data: { success: true },
        },
        {
          id: randomUUID(),
          runId: randomUUID(),
          timestamp: sevenDaysAgo,
          category: "pipeline",
          event: Events.PIPELINE_END,
          minLevel: TelemetryLevel.standard,
          data: { success: false },
        },
        {
          id: randomUUID(),
          runId: randomUUID(),
          timestamp: now,
          category: "pipeline",
          event: Events.PIPELINE_END,
          minLevel: TelemetryLevel.standard,
          data: { success: true },
        },
      ]);

      const lastWeekEvents = await backend.query({
        event: Events.PIPELINE_END,
        startTime: sevenDaysAgo,
      });

      expect(lastWeekEvents.length).toBe(2);
      expect(lastWeekEvents.every(e => e.timestamp >= sevenDaysAgo)).toBe(true);
    });

    it("should handle all-success scenario", async () => {
      await backend.writeBatch([
        {
          id: randomUUID(),
          runId: randomUUID(),
          timestamp: Date.now() - 3000,
          category: "pipeline",
          event: Events.PIPELINE_END,
          minLevel: TelemetryLevel.standard,
          data: { success: true },
        },
        {
          id: randomUUID(),
          runId: randomUUID(),
          timestamp: Date.now() - 2000,
          category: "pipeline",
          event: Events.PIPELINE_END,
          minLevel: TelemetryLevel.standard,
          data: { success: true },
        },
        {
          id: randomUUID(),
          runId: randomUUID(),
          timestamp: Date.now() - 1000,
          category: "pipeline",
          event: Events.PIPELINE_END,
          minLevel: TelemetryLevel.standard,
          data: { success: true },
        },
      ]);

      const events = await backend.query({ event: Events.PIPELINE_END });
      const failures = events.filter(e => e.data.success === false);
      const successes = events.filter(e => e.data.success === true);

      expect(successes.length).toBe(3);
      expect(failures.length).toBe(0);
    });

    it("should handle all-failure scenario", async () => {
      await backend.writeBatch([
        {
          id: randomUUID(),
          runId: randomUUID(),
          timestamp: Date.now() - 3000,
          category: "pipeline",
          event: Events.PIPELINE_END,
          minLevel: TelemetryLevel.standard,
          data: { success: false },
        },
        {
          id: randomUUID(),
          runId: randomUUID(),
          timestamp: Date.now() - 2000,
          category: "pipeline",
          event: Events.PIPELINE_END,
          minLevel: TelemetryLevel.standard,
          data: { success: false },
        },
      ]);

      const events = await backend.query({ event: Events.PIPELINE_END });
      const failures = events.filter(e => e.data.success === false);

      expect(failures.length).toBe(2);
      expect(failures.length).toBe(events.length);
    });

    it("should handle empty dataset", async () => {
      const events = await backend.query({ event: Events.PIPELINE_END });
      expect(events.length).toBe(0);
    });

    it("should fallback to COMMAND_END when no PIPELINE_END exists", async () => {
      const successRun = randomUUID();
      const failureRun = randomUUID();

      await backend.writeBatch([
        {
          id: randomUUID(),
          runId: successRun,
          timestamp: Date.now() - 2000,
          category: "command",
          event: Events.COMMAND_END,
          minLevel: TelemetryLevel.minimal,
          data: { success: true },
        },
        {
          id: randomUUID(),
          runId: failureRun,
          timestamp: Date.now() - 1000,
          category: "command",
          event: Events.COMMAND_END,
          minLevel: TelemetryLevel.minimal,
          data: { success: false },
        },
      ]);

      const pipelineEvents = await backend.query({ event: Events.PIPELINE_END });
      const commandEvents = await backend.query({ event: Events.COMMAND_END });

      expect(pipelineEvents.length).toBe(0);
      expect(commandEvents.length).toBe(2);

      const successCount = commandEvents.filter(e => e.data.success === true).length;
      expect(successCount).toBe(1);
    });
  });
});
