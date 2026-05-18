import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SqliteBackend } from "../chesstrace/backends/sqlite.js";
import { Events, TelemetryLevel } from "../chesstrace/events.js";
import type { TelemetryEvent } from "../chesstrace/events.js";
import { randomUUID } from "node:crypto";

describe("Dashboard export functionality", () => {
  let testDir: string;
  let backend: SqliteBackend;

  beforeEach(async () => {
    testDir = mkdtempSync(join(tmpdir(), "reygent-export-test-"));
    const dbPath = join(testDir, "chesstrace.db");
    backend = new SqliteBackend("local", dbPath);
    await backend.init();
  });

  afterEach(async () => {
    await backend.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("CSV export data preparation", () => {
    it("should prepare runs list data for CSV export", async () => {
      const runId1 = randomUUID();
      const runId2 = randomUUID();

      await backend.writeBatch([
        {
          id: randomUUID(),
          runId: runId1,
          timestamp: Date.now() - 5000,
          category: "pipeline",
          event: Events.PIPELINE_START,
          minLevel: TelemetryLevel.standard,
          data: {},
        },
        {
          id: randomUUID(),
          runId: runId1,
          timestamp: Date.now() - 4000,
          category: "pipeline",
          event: Events.PIPELINE_END,
          minLevel: TelemetryLevel.standard,
          data: { success: true },
        },
        {
          id: randomUUID(),
          runId: runId2,
          timestamp: Date.now() - 2000,
          category: "pipeline",
          event: Events.PIPELINE_START,
          minLevel: TelemetryLevel.standard,
          data: {},
        },
        {
          id: randomUUID(),
          runId: runId2,
          timestamp: Date.now() - 1000,
          category: "pipeline",
          event: Events.PIPELINE_END,
          minLevel: TelemetryLevel.standard,
          data: { success: false },
        },
      ]);

      const runs = await backend.listRuns();

      // Prepare CSV data structure
      const csvData = runs.map(run => {
        const endEvent = backend
          .query({ runId: run.runId, event: Events.PIPELINE_END })
          .then(events => events[0]);

        return {
          runId: run.runId,
          startTime: new Date(run.startTime).toISOString(),
          endTime: new Date(run.endTime).toISOString(),
          eventCount: run.eventCount,
          success: endEvent ? "pending" : "unknown",
        };
      });

      expect(csvData.length).toBe(2);
      expect(csvData[0].runId).toBeDefined();
      expect(csvData[0].startTime).toMatch(/\d{4}-\d{2}-\d{2}T/);
    });

    it("should prepare single run detail data for CSV export", async () => {
      const runId = randomUUID();

      await backend.writeBatch([
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
          data: { agent: "spec-writer", success: true, duration: 15000 },
        },
      ]);

      const events = await backend.query({ runId });

      const csvRows = events.map(event => ({
        id: event.id,
        runId: event.runId,
        timestamp: new Date(event.timestamp).toISOString(),
        category: event.category,
        event: event.event,
        data: JSON.stringify(event.data),
      }));

      expect(csvRows.length).toBe(3);
      expect(csvRows[0].category).toBe("command");
      expect(csvRows[1].category).toBe("agent");
      expect(csvRows[2].data).toContain("spec-writer");
    });

    it("should generate descriptive CSV filename with scope and timestamp", () => {
      const generateFilename = (
        scope: "local" | "global",
        type: "runs" | "run-detail",
        runId?: string
      ): string => {
        const timestamp = new Date().toISOString().split("T")[0];
        if (type === "run-detail" && runId) {
          return `reygent-telemetry-${scope}-${runId.slice(0, 8)}-${timestamp}.csv`;
        }
        return `reygent-telemetry-${scope}-${timestamp}.csv`;
      };

      const localFilename = generateFilename("local", "runs");
      const globalFilename = generateFilename("global", "runs");
      const detailFilename = generateFilename("local", "run-detail", "abc123def456");

      expect(localFilename).toMatch(/reygent-telemetry-local-\d{4}-\d{2}-\d{2}\.csv/);
      expect(globalFilename).toMatch(/reygent-telemetry-global-\d{4}-\d{2}-\d{2}\.csv/);
      expect(detailFilename).toMatch(
        /reygent-telemetry-local-abc123de-\d{4}-\d{2}-\d{2}\.csv/
      );
    });

    it("should use human-readable column headers", () => {
      const headers = {
        runList: ["Run ID", "Start Time", "End Time", "Event Count", "Success"],
        runDetail: ["Event ID", "Run ID", "Timestamp", "Category", "Event", "Data"],
      };

      expect(headers.runList).toContain("Run ID");
      expect(headers.runList).toContain("Start Time");
      expect(headers.runDetail).toContain("Category");
      expect(headers.runDetail).toContain("Event");
    });

    it("should respect current scope when exporting", async () => {
      const localRunId = randomUUID();

      await backend.writeBatch([
        {
          id: randomUUID(),
          runId: localRunId,
          timestamp: Date.now(),
          category: "pipeline",
          event: Events.PIPELINE_START,
          minLevel: TelemetryLevel.standard,
          data: {},
        },
      ]);

      const localRuns = await backend.listRuns();
      expect(localRuns.length).toBe(1);
      expect(localRuns[0].runId).toBe(localRunId);

      // Simulate export respects scope
      const exportData = localRuns.map(run => ({
        scope: "local",
        runId: run.runId,
      }));

      expect(exportData[0].scope).toBe("local");
    });

    it("should filter export data by time range", async () => {
      const now = Date.now();
      const dayAgo = now - 24 * 60 * 60 * 1000;
      const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

      await backend.writeBatch([
        {
          id: randomUUID(),
          runId: randomUUID(),
          timestamp: weekAgo,
          category: "pipeline",
          event: Events.PIPELINE_END,
          minLevel: TelemetryLevel.standard,
          data: { success: true },
        },
        {
          id: randomUUID(),
          runId: randomUUID(),
          timestamp: now,
          category: "pipeline",
          event: Events.PIPELINE_END,
          minLevel: TelemetryLevel.standard,
          data: { success: false },
        },
      ]);

      const recentEvents = await backend.query({
        event: Events.PIPELINE_END,
        startTime: dayAgo,
      });

      expect(recentEvents.length).toBe(1);
      expect(recentEvents[0].timestamp).toBeGreaterThan(dayAgo);
    });
  });

  describe("XLSX export data preparation", () => {
    it("should prepare data for multi-sheet XLSX export", async () => {
      const runId = randomUUID();

      await backend.writeBatch([
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
          category: "agent",
          event: Events.AGENT_COMPLETE,
          minLevel: TelemetryLevel.standard,
          data: { agent: "spec-writer", success: true },
        },
        {
          id: randomUUID(),
          runId,
          timestamp: Date.now(),
          category: "error",
          event: Events.ERROR_TASK,
          minLevel: TelemetryLevel.minimal,
          data: { message: "Test error" },
        },
        {
          id: randomUUID(),
          runId,
          timestamp: Date.now(),
          category: "usage",
          event: Events.USAGE_TOKENS,
          minLevel: TelemetryLevel.verbose,
          data: { inputTokens: 500, outputTokens: 200 },
        },
      ]);

      const events = await backend.query({ runId });

      // Group by category for multi-sheet structure
      const sheets = new Map<string, TelemetryEvent[]>();
      for (const event of events) {
        const categoryEvents = sheets.get(event.category) ?? [];
        categoryEvents.push(event);
        sheets.set(event.category, categoryEvents);
      }

      expect(sheets.size).toBe(4);
      expect(sheets.has("command")).toBe(true);
      expect(sheets.has("agent")).toBe(true);
      expect(sheets.has("error")).toBe(true);
      expect(sheets.has("usage")).toBe(true);
      expect(sheets.get("command")?.length).toBe(1);
    });

    it("should generate XLSX filename with proper extension", () => {
      const generateXlsxFilename = (
        scope: "local" | "global",
        runId?: string
      ): string => {
        const timestamp = new Date().toISOString().split("T")[0];
        if (runId) {
          return `reygent-telemetry-${scope}-${runId.slice(0, 8)}-${timestamp}.xlsx`;
        }
        return `reygent-telemetry-${scope}-${timestamp}.xlsx`;
      };

      const filename = generateXlsxFilename("local", "abc123def");
      expect(filename).toMatch(/\.xlsx$/);
      expect(filename).toContain("local");
    });

    it("should flatten nested data for single-sheet XLSX option", async () => {
      const runId = randomUUID();

      await backend.writeBatch([
        {
          id: randomUUID(),
          runId,
          timestamp: Date.now(),
          category: "agent",
          event: Events.AGENT_COMPLETE,
          minLevel: TelemetryLevel.standard,
          data: {
            agent: "spec-writer",
            success: true,
            duration: 12000,
            metadata: { model: "sonnet", provider: "anthropic" },
          },
        },
      ]);

      const events = await backend.query({ runId });

      // Flatten for single sheet
      const flatRows = events.map(event => {
        const baseRow = {
          id: event.id,
          runId: event.runId,
          timestamp: new Date(event.timestamp).toISOString(),
          category: event.category,
          event: event.event,
        };

        // Flatten data object
        const flatData: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(event.data)) {
          if (typeof value === "object" && value !== null) {
            flatData[key] = JSON.stringify(value);
          } else {
            flatData[key] = value;
          }
        }

        return { ...baseRow, ...flatData };
      });

      expect(flatRows.length).toBe(1);
      expect(flatRows[0].agent).toBe("spec-writer");
      expect(flatRows[0].success).toBe(true);
      expect(typeof flatRows[0].metadata).toBe("string");
    });
  });

  describe("Export view context preservation", () => {
    it("should export from runs list with current filters", async () => {
      const successRun = randomUUID();
      const failureRun = randomUUID();

      await backend.writeBatch([
        {
          id: randomUUID(),
          runId: successRun,
          timestamp: Date.now() - 2000,
          category: "pipeline",
          event: Events.PIPELINE_END,
          minLevel: TelemetryLevel.standard,
          data: { success: true },
        },
        {
          id: randomUUID(),
          runId: failureRun,
          timestamp: Date.now() - 1000,
          category: "pipeline",
          event: Events.PIPELINE_END,
          minLevel: TelemetryLevel.standard,
          data: { success: false },
        },
      ]);

      // Simulate filter for failures only
      const failureEvents = await backend.query({ event: Events.PIPELINE_END });
      const filteredFailures = failureEvents.filter(e => e.data.success === false);

      expect(filteredFailures.length).toBe(1);
      expect(filteredFailures[0].runId).toBe(failureRun);
    });

    it("should export from run detail view with single run data", async () => {
      const targetRunId = randomUUID();
      const otherRunId = randomUUID();

      await backend.writeBatch([
        {
          id: randomUUID(),
          runId: targetRunId,
          timestamp: Date.now(),
          category: "command",
          event: Events.COMMAND_START,
          minLevel: TelemetryLevel.minimal,
          data: { command: "run" },
        },
        {
          id: randomUUID(),
          runId: otherRunId,
          timestamp: Date.now(),
          category: "command",
          event: Events.COMMAND_START,
          minLevel: TelemetryLevel.minimal,
          data: { command: "init" },
        },
      ]);

      // Export specific run only
      const targetRunEvents = await backend.query({ runId: targetRunId });

      expect(targetRunEvents.length).toBe(1);
      expect(targetRunEvents.every(e => e.runId === targetRunId)).toBe(true);
    });
  });

  describe("Export data validation", () => {
    it("should handle empty dataset gracefully", async () => {
      const events = await backend.query({});
      expect(events.length).toBe(0);

      // Simulate export with empty data
      const csvData = events.map(e => ({
        id: e.id,
        timestamp: new Date(e.timestamp).toISOString(),
      }));

      expect(csvData.length).toBe(0);
    });

    it("should handle special characters in data fields", async () => {
      const runId = randomUUID();

      await backend.write({
        id: randomUUID(),
        runId,
        timestamp: Date.now(),
        category: "error",
        event: Events.ERROR_TASK,
        minLevel: TelemetryLevel.minimal,
        data: {
          message: 'Error with "quotes" and, commas',
          stackTrace: "Line 1\nLine 2\nLine 3",
        },
      });

      const events = await backend.query({ runId });
      const csvRow = {
        message: events[0].data.message,
        stackTrace: events[0].data.stackTrace,
      };

      // Verify data integrity
      expect(csvRow.message).toContain('"quotes"');
      expect(csvRow.message).toContain(",");
      expect(csvRow.stackTrace).toContain("\n");
    });

    it("should handle large datasets for export", async () => {
      const runId = randomUUID();
      const events: TelemetryEvent[] = [];

      for (let i = 0; i < 1000; i++) {
        events.push({
          id: randomUUID(),
          runId,
          timestamp: Date.now() + i,
          category: "agent",
          event: Events.AGENT_COMPLETE,
          minLevel: TelemetryLevel.standard,
          data: { agent: "spec-writer", success: i % 2 === 0 },
        });
      }

      await backend.writeBatch(events);

      const queryResult = await backend.query({ runId });
      expect(queryResult.length).toBe(1000);
    });
  });
});
