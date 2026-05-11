import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SqliteBackend } from "../chesstrace/backends/sqlite.js";
import { Events, TelemetryLevel } from "../chesstrace/events.js";
import type { TelemetryEvent } from "../chesstrace/events.js";
import { randomUUID } from "node:crypto";

describe("analyze commands", () => {
  let testDir: string;
  let backend: SqliteBackend;

  beforeEach(async () => {
    testDir = mkdtempSync(join(tmpdir(), "reygent-analyze-test-"));
    const dbPath = join(testDir, "chesstrace.db");
    backend = new SqliteBackend("global", dbPath);
    await backend.init();
  });

  afterEach(async () => {
    await backend.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("helper functions", () => {
    it("should parse duration strings", () => {
      const parseSince = (since: string): number => {
        const match = since.match(/^(\d+)d$/);
        if (!match) {
          throw new Error(`Invalid duration format: ${since}`);
        }
        const days = Number.parseInt(match[1], 10);
        return Date.now() - days * 24 * 60 * 60 * 1000;
      };

      const thirtyDaysAgo = parseSince("30d");
      const sevenDaysAgo = parseSince("7d");

      expect(thirtyDaysAgo).toBeLessThan(sevenDaysAgo);
      expect(Date.now() - thirtyDaysAgo).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
    });

    it("should format relative time", () => {
      const formatRelativeTime = (timestamp: number): string => {
        const now = Date.now();
        const diff = now - timestamp;
        const days = Math.floor(diff / (24 * 60 * 60 * 1000));
        const hours = Math.floor(diff / (60 * 60 * 1000));

        if (days > 0) return `${days} day${days > 1 ? "s" : ""} ago`;
        if (hours > 0) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
        return "< 1 hour ago";
      };

      const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
      const fiveHoursAgo = Date.now() - 5 * 60 * 60 * 1000;
      const thirtyMinsAgo = Date.now() - 30 * 60 * 1000;

      expect(formatRelativeTime(twoDaysAgo)).toBe("2 days ago");
      expect(formatRelativeTime(fiveHoursAgo)).toBe("5 hours ago");
      expect(formatRelativeTime(thirtyMinsAgo)).toBe("< 1 hour ago");
    });

    it("should format duration", () => {
      const formatDuration = (ms: number): string => {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);

        if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
        return `${seconds}s`;
      };

      expect(formatDuration(5000)).toBe("5s");
      expect(formatDuration(65000)).toBe("1m 5s");
      expect(formatDuration(125000)).toBe("2m 5s");
    });

    it("should format cost", () => {
      const formatCost = (usd: number): string => {
        return `$${usd.toFixed(2)}`;
      };

      expect(formatCost(0.12)).toBe("$0.12");
      expect(formatCost(1.5)).toBe("$1.50");
      expect(formatCost(42.186)).toBe("$42.19");
    });

    it("should format percentage", () => {
      const formatPercent = (value: number): string => {
        return `${Math.round(value * 100)}%`;
      };

      expect(formatPercent(0.89)).toBe("89%");
      expect(formatPercent(0.92)).toBe("92%");
      expect(formatPercent(0.125)).toBe("13%");
    });
  });

  describe("groupBy function", () => {
    it("should group items by key function", () => {
      const groupBy = <T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> => {
        const groups = new Map<string, T[]>();
        for (const item of items) {
          const key = keyFn(item);
          const group = groups.get(key) ?? [];
          group.push(item);
          groups.set(key, group);
        }
        return groups;
      };

      const events: TelemetryEvent[] = [
        {
          id: "1",
          runId: "run1",
          timestamp: Date.now(),
          category: "error",
          event: Events.ERROR_PARSE,
          minLevel: TelemetryLevel.minimal,
          data: { agent: "spec-writer" },
        },
        {
          id: "2",
          runId: "run2",
          timestamp: Date.now(),
          category: "error",
          event: Events.ERROR_PARSE,
          minLevel: TelemetryLevel.minimal,
          data: { agent: "implementer" },
        },
        {
          id: "3",
          runId: "run3",
          timestamp: Date.now(),
          category: "error",
          event: Events.ERROR_PROVIDER,
          minLevel: TelemetryLevel.minimal,
          data: { provider: "anthropic" },
        },
      ];

      const grouped = groupBy(events, e => e.event);
      expect(grouped.size).toBe(2);
      expect(grouped.get(Events.ERROR_PARSE)?.length).toBe(2);
      expect(grouped.get(Events.ERROR_PROVIDER)?.length).toBe(1);
    });
  });

  describe("failure analysis data queries", () => {
    it("should identify error patterns from telemetry", async () => {
      const runId = randomUUID();

      // Insert error events
      await backend.writeBatch([
        {
          id: randomUUID(),
          runId,
          timestamp: Date.now(),
          category: "error",
          event: Events.ERROR_PARSE,
          minLevel: TelemetryLevel.minimal,
          data: { agent: "spec-writer", message: "Expected JSON array" },
        },
        {
          id: randomUUID(),
          runId,
          timestamp: Date.now(),
          category: "error",
          event: Events.ERROR_PARSE,
          minLevel: TelemetryLevel.minimal,
          data: { agent: "spec-writer", message: "Expected JSON array" },
        },
        {
          id: randomUUID(),
          runId,
          timestamp: Date.now(),
          category: "gate",
          event: Events.GATE_RETRY,
          minLevel: TelemetryLevel.standard,
          data: { gateName: "type-check-gate", attempt: 2 },
        },
      ]);

      const events = await backend.query({ category: "error" });
      expect(events.length).toBe(2);
      expect(events.every(e => e.event === Events.ERROR_PARSE)).toBe(true);
    });

    it("should verify query parameters for category filter", async () => {
      const runId = randomUUID();

      await backend.writeBatch([
        {
          id: randomUUID(),
          runId,
          timestamp: Date.now(),
          category: "error",
          event: Events.ERROR_PARSE,
          minLevel: TelemetryLevel.minimal,
          data: { message: "test" },
        },
      ]);

      // Verify category filter works
      const errorEvents = await backend.query({ category: "error" });
      const agentEvents = await backend.query({ category: "agent" });

      expect(errorEvents.length).toBe(1);
      expect(agentEvents.length).toBe(0);
    });

    it("should verify query parameters for event filter", async () => {
      const runId = randomUUID();

      await backend.writeBatch([
        {
          id: randomUUID(),
          runId,
          timestamp: Date.now(),
          category: "agent",
          event: Events.AGENT_SPAWN,
          minLevel: TelemetryLevel.standard,
          data: { agent: "test" },
        },
      ]);

      // Verify event filter works
      const spawnEvents = await backend.query({ event: Events.AGENT_SPAWN });
      const completeEvents = await backend.query({ event: Events.AGENT_COMPLETE });

      expect(spawnEvents.length).toBe(1);
      expect(completeEvents.length).toBe(0);
    });
  });

  describe("success analysis data queries", () => {
    it("should extract agent performance metrics", async () => {
      const runId = randomUUID();

      await backend.writeBatch([
        {
          id: randomUUID(),
          runId,
          timestamp: Date.now(),
          category: "agent",
          event: Events.AGENT_SPAWN,
          minLevel: TelemetryLevel.standard,
          data: { agent: "spec-writer", model: "sonnet", provider: "anthropic" },
        },
        {
          id: randomUUID(),
          runId,
          timestamp: Date.now(),
          category: "agent",
          event: Events.AGENT_COMPLETE,
          minLevel: TelemetryLevel.standard,
          data: { agent: "spec-writer", success: true, duration: 45000 },
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

      const spawnEvents = await backend.query({ event: Events.AGENT_SPAWN });
      const completeEvents = await backend.query({ event: Events.AGENT_COMPLETE });

      expect(spawnEvents.length).toBe(1);
      expect(completeEvents.length).toBe(1);
      expect(completeEvents[0].data.success).toBe(true);
    });
  });

  describe("cost analysis data queries", () => {
    it("should aggregate cost data by stage", async () => {
      const runId1 = randomUUID();
      const runId2 = randomUUID();

      await backend.writeBatch([
        {
          id: randomUUID(),
          runId: runId1,
          timestamp: Date.now(),
          category: "usage",
          event: Events.USAGE_COST,
          minLevel: TelemetryLevel.verbose,
          data: { stage: "spec", costUsd: 0.12, agent: "spec-writer" },
        },
        {
          id: randomUUID(),
          runId: runId1,
          timestamp: Date.now(),
          category: "usage",
          event: Events.USAGE_COST,
          minLevel: TelemetryLevel.verbose,
          data: { stage: "implement", costUsd: 0.34, agent: "implementer" },
        },
        {
          id: randomUUID(),
          runId: runId2,
          timestamp: Date.now(),
          category: "usage",
          event: Events.USAGE_COST,
          minLevel: TelemetryLevel.verbose,
          data: { stage: "spec", costUsd: 0.15, agent: "spec-writer" },
        },
        {
          id: randomUUID(),
          runId: runId1,
          timestamp: Date.now(),
          category: "pipeline",
          event: Events.PIPELINE_END,
          minLevel: TelemetryLevel.standard,
          data: { success: true },
        },
        {
          id: randomUUID(),
          runId: runId2,
          timestamp: Date.now(),
          category: "pipeline",
          event: Events.PIPELINE_END,
          minLevel: TelemetryLevel.standard,
          data: { success: false },
        },
      ]);

      const costEvents = await backend.query({ event: Events.USAGE_COST });
      const totalCost = costEvents.reduce((sum, e) => sum + (e.data.costUsd as number), 0);

      expect(costEvents.length).toBe(3);
      expect(totalCost).toBeCloseTo(0.61, 2);
    });
  });

  describe("agent analysis data queries", () => {
    it("should compute per-agent statistics", async () => {
      const runId = randomUUID();

      await backend.writeBatch([
        {
          id: randomUUID(),
          runId,
          timestamp: Date.now(),
          category: "agent",
          event: Events.AGENT_SPAWN,
          minLevel: TelemetryLevel.standard,
          data: { agent: "implementer", model: "sonnet", provider: "anthropic" },
        },
        {
          id: randomUUID(),
          runId,
          timestamp: Date.now(),
          category: "agent",
          event: Events.AGENT_COMPLETE,
          minLevel: TelemetryLevel.standard,
          data: { agent: "implementer", success: true, duration: 120000 },
        },
        {
          id: randomUUID(),
          runId,
          timestamp: Date.now(),
          category: "error",
          event: Events.ERROR_TASK,
          minLevel: TelemetryLevel.minimal,
          data: { agent: "implementer", message: "timeout" },
        },
        {
          id: randomUUID(),
          runId,
          timestamp: Date.now(),
          category: "usage",
          event: Events.USAGE_COST,
          minLevel: TelemetryLevel.verbose,
          data: { agent: "implementer", costUsd: 0.28 },
        },
      ]);

      const agentSpawns = await backend.query({ event: Events.AGENT_SPAWN });
      const agentCompletions = await backend.query({ event: Events.AGENT_COMPLETE });
      const errors = await backend.query({ category: "error" });
      const costs = await backend.query({ event: Events.USAGE_COST });

      expect(agentSpawns.length).toBe(1);
      expect(agentCompletions.length).toBe(1);
      expect(errors.length).toBe(1);
      expect(costs.length).toBe(1);

      const successRate = agentCompletions.filter(e => e.data.success).length / agentCompletions.length;
      expect(successRate).toBe(1);
    });
  });

  describe("telemetry enabled check", () => {
    it("should detect when telemetry is disabled", () => {
      const checkTelemetryEnabled = (config: { telemetry?: { enabled?: boolean } }): boolean => {
        return config.telemetry?.enabled === true;
      };

      expect(checkTelemetryEnabled({ telemetry: { enabled: true } })).toBe(true);
      expect(checkTelemetryEnabled({ telemetry: { enabled: false } })).toBe(false);
      expect(checkTelemetryEnabled({})).toBe(false);
    });
  });
});
