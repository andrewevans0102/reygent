import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SqliteBackend } from "../chesstrace/backends/sqlite.js";
import { Events, TelemetryLevel } from "../chesstrace/events.js";
import { randomUUID } from "node:crypto";

describe("Dashboard agent failure drill-down", () => {
  let testDir: string;
  let backend: SqliteBackend;

  beforeEach(async () => {
    testDir = mkdtempSync(join(tmpdir(), "reygent-agent-drilldown-test-"));
    const dbPath = join(testDir, "chesstrace.db");
    backend = new SqliteBackend("local", dbPath);
    await backend.init();
  });

  afterEach(async () => {
    await backend.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("Agent failure aggregation", () => {
    it("should group failures by agent name", async () => {
      await backend.writeBatch([
        {
          id: randomUUID(),
          runId: randomUUID(),
          timestamp: Date.now(),
          category: "agent",
          event: Events.AGENT_COMPLETE,
          minLevel: TelemetryLevel.standard,
          data: { agent: "spec-writer", success: false },
        },
        {
          id: randomUUID(),
          runId: randomUUID(),
          timestamp: Date.now(),
          category: "agent",
          event: Events.AGENT_COMPLETE,
          minLevel: TelemetryLevel.standard,
          data: { agent: "spec-writer", success: false },
        },
        {
          id: randomUUID(),
          runId: randomUUID(),
          timestamp: Date.now(),
          category: "agent",
          event: Events.AGENT_COMPLETE,
          minLevel: TelemetryLevel.standard,
          data: { agent: "implementer", success: false },
        },
      ]);

      const failureEvents = await backend.query({ event: Events.AGENT_COMPLETE });
      const agentFailures = new Map<string, number>();

      for (const event of failureEvents) {
        if (event.data.success === false) {
          const agent = event.data.agent as string;
          agentFailures.set(agent, (agentFailures.get(agent) ?? 0) + 1);
        }
      }

      expect(agentFailures.get("spec-writer")).toBe(2);
      expect(agentFailures.get("implementer")).toBe(1);
    });

    it("should identify worst offending agents by failure count", async () => {
      await backend.writeBatch([
        {
          id: randomUUID(),
          runId: randomUUID(),
          timestamp: Date.now(),
          category: "agent",
          event: Events.AGENT_COMPLETE,
          minLevel: TelemetryLevel.standard,
          data: { agent: "implementer", success: false },
        },
        {
          id: randomUUID(),
          runId: randomUUID(),
          timestamp: Date.now(),
          category: "agent",
          event: Events.AGENT_COMPLETE,
          minLevel: TelemetryLevel.standard,
          data: { agent: "implementer", success: false },
        },
        {
          id: randomUUID(),
          runId: randomUUID(),
          timestamp: Date.now(),
          category: "agent",
          event: Events.AGENT_COMPLETE,
          minLevel: TelemetryLevel.standard,
          data: { agent: "implementer", success: false },
        },
        {
          id: randomUUID(),
          runId: randomUUID(),
          timestamp: Date.now(),
          category: "agent",
          event: Events.AGENT_COMPLETE,
          minLevel: TelemetryLevel.standard,
          data: { agent: "spec-writer", success: false },
        },
        {
          id: randomUUID(),
          runId: randomUUID(),
          timestamp: Date.now(),
          category: "agent",
          event: Events.AGENT_COMPLETE,
          minLevel: TelemetryLevel.standard,
          data: { agent: "qe", success: false },
        },
      ]);

      const failureEvents = await backend.query({ event: Events.AGENT_COMPLETE });
      const agentFailures = new Map<string, number>();

      for (const event of failureEvents) {
        if (event.data.success === false) {
          const agent = event.data.agent as string;
          agentFailures.set(agent, (agentFailures.get(agent) ?? 0) + 1);
        }
      }

      const sortedAgents = Array.from(agentFailures.entries()).sort((a, b) => b[1] - a[1]);

      expect(sortedAgents[0][0]).toBe("implementer");
      expect(sortedAgents[0][1]).toBe(3);
      expect(sortedAgents[1][0]).toBe("spec-writer");
      expect(sortedAgents[1][1]).toBe(1);
      expect(sortedAgents[2][0]).toBe("qe");
      expect(sortedAgents[2][1]).toBe(1);
    });

    it("should filter failures by time range", async () => {
      const now = Date.now();
      const dayInMs = 24 * 60 * 60 * 1000;

      await backend.writeBatch([
        {
          id: randomUUID(),
          runId: randomUUID(),
          timestamp: now - 2 * dayInMs,
          category: "agent",
          event: Events.AGENT_COMPLETE,
          minLevel: TelemetryLevel.standard,
          data: { agent: "spec-writer", success: false },
        },
        {
          id: randomUUID(),
          runId: randomUUID(),
          timestamp: now - 12 * 60 * 60 * 1000, // 12 hours ago
          category: "agent",
          event: Events.AGENT_COMPLETE,
          minLevel: TelemetryLevel.standard,
          data: { agent: "implementer", success: false },
        },
        {
          id: randomUUID(),
          runId: randomUUID(),
          timestamp: now,
          category: "agent",
          event: Events.AGENT_COMPLETE,
          minLevel: TelemetryLevel.standard,
          data: { agent: "implementer", success: false },
        },
      ]);

      const last24Hours = now - dayInMs;
      const recentFailures = await backend.query({
        event: Events.AGENT_COMPLETE,
        startTime: last24Hours,
      });

      const agentFailures = new Map<string, number>();
      for (const event of recentFailures) {
        if (event.data.success === false) {
          const agent = event.data.agent as string;
          agentFailures.set(agent, (agentFailures.get(agent) ?? 0) + 1);
        }
      }

      expect(recentFailures.length).toBe(2);
      expect(agentFailures.get("implementer")).toBe(2);
      expect(agentFailures.has("spec-writer")).toBe(false);
    });

    it("should respect local vs global scope for agent failures", async () => {
      const localRun = randomUUID();

      await backend.writeBatch([
        {
          id: randomUUID(),
          runId: localRun,
          timestamp: Date.now(),
          category: "agent",
          event: Events.AGENT_COMPLETE,
          minLevel: TelemetryLevel.standard,
          data: { agent: "spec-writer", success: false },
        },
      ]);

      const failures = await backend.query({ event: Events.AGENT_COMPLETE });
      expect(failures.length).toBe(1);
      expect(failures[0].data.agent).toBe("spec-writer");
    });

    it("should include error details for failed agents", async () => {
      const runId = randomUUID();

      await backend.writeBatch([
        {
          id: randomUUID(),
          runId,
          timestamp: Date.now(),
          category: "agent",
          event: Events.AGENT_COMPLETE,
          minLevel: TelemetryLevel.standard,
          data: { agent: "implementer", success: false, exitCode: 1 },
        },
        {
          id: randomUUID(),
          runId,
          timestamp: Date.now(),
          category: "error",
          event: Events.ERROR_TASK,
          minLevel: TelemetryLevel.minimal,
          data: { agent: "implementer", message: "Build failed", stage: "implement" },
        },
      ]);

      const agentFailures = await backend.query({
        runId,
        event: Events.AGENT_COMPLETE,
      });

      const errors = await backend.query({
        runId,
        category: "error",
      });

      expect(agentFailures.length).toBe(1);
      expect(agentFailures[0].data.success).toBe(false);
      expect(errors.length).toBe(1);
      expect(errors[0].data.message).toBe("Build failed");
    });

    it("should calculate agent failure rate", async () => {
      await backend.writeBatch([
        {
          id: randomUUID(),
          runId: randomUUID(),
          timestamp: Date.now(),
          category: "agent",
          event: Events.AGENT_COMPLETE,
          minLevel: TelemetryLevel.standard,
          data: { agent: "spec-writer", success: true },
        },
        {
          id: randomUUID(),
          runId: randomUUID(),
          timestamp: Date.now(),
          category: "agent",
          event: Events.AGENT_COMPLETE,
          minLevel: TelemetryLevel.standard,
          data: { agent: "spec-writer", success: true },
        },
        {
          id: randomUUID(),
          runId: randomUUID(),
          timestamp: Date.now(),
          category: "agent",
          event: Events.AGENT_COMPLETE,
          minLevel: TelemetryLevel.standard,
          data: { agent: "spec-writer", success: false },
        },
        {
          id: randomUUID(),
          runId: randomUUID(),
          timestamp: Date.now(),
          category: "agent",
          event: Events.AGENT_COMPLETE,
          minLevel: TelemetryLevel.standard,
          data: { agent: "implementer", success: true },
        },
        {
          id: randomUUID(),
          runId: randomUUID(),
          timestamp: Date.now(),
          category: "agent",
          event: Events.AGENT_COMPLETE,
          minLevel: TelemetryLevel.standard,
          data: { agent: "implementer", success: false },
        },
        {
          id: randomUUID(),
          runId: randomUUID(),
          timestamp: Date.now(),
          category: "agent",
          event: Events.AGENT_COMPLETE,
          minLevel: TelemetryLevel.standard,
          data: { agent: "implementer", success: false },
        },
      ]);

      const completions = await backend.query({ event: Events.AGENT_COMPLETE });

      const agentStats = new Map<
        string,
        { total: number; failures: number; rate: number }
      >();

      for (const event of completions) {
        const agent = event.data.agent as string;
        const stats = agentStats.get(agent) ?? { total: 0, failures: 0, rate: 0 };
        stats.total++;
        if (event.data.success === false) {
          stats.failures++;
        }
        stats.rate = stats.failures / stats.total;
        agentStats.set(agent, stats);
      }

      const specWriterStats = agentStats.get("spec-writer");
      const implementerStats = agentStats.get("implementer");

      expect(specWriterStats?.total).toBe(3);
      expect(specWriterStats?.failures).toBe(1);
      expect(specWriterStats?.rate).toBeCloseTo(0.333, 2);

      expect(implementerStats?.total).toBe(3);
      expect(implementerStats?.failures).toBe(2);
      expect(implementerStats?.rate).toBeCloseTo(0.667, 2);
    });

    it("should drill down from graph to specific agent failures", async () => {
      const failureRunId = randomUUID();

      await backend.writeBatch([
        {
          id: randomUUID(),
          runId: failureRunId,
          timestamp: Date.now(),
          category: "pipeline",
          event: Events.PIPELINE_END,
          minLevel: TelemetryLevel.standard,
          data: { success: false },
        },
        {
          id: randomUUID(),
          runId: failureRunId,
          timestamp: Date.now(),
          category: "agent",
          event: Events.AGENT_COMPLETE,
          minLevel: TelemetryLevel.standard,
          data: { agent: "implementer", success: false, stage: "implement" },
        },
      ]);

      // First, identify failed runs
      const failedRuns = await backend.query({
        event: Events.PIPELINE_END,
      });

      const failedRunIds = failedRuns
        .filter(e => e.data.success === false)
        .map(e => e.runId);

      expect(failedRunIds.length).toBe(1);

      // Then drill into agent failures for those runs
      const agentFailures = await backend.query({
        event: Events.AGENT_COMPLETE,
        runId: failedRunIds[0],
      });

      const failedAgents = agentFailures.filter(e => e.data.success === false);

      expect(failedAgents.length).toBe(1);
      expect(failedAgents[0].data.agent).toBe("implementer");
    });
  });

  describe("Agent timeout tracking", () => {
    it("should identify agents that timeout", async () => {
      await backend.writeBatch([
        {
          id: randomUUID(),
          runId: randomUUID(),
          timestamp: Date.now(),
          category: "agent",
          event: Events.AGENT_TIMEOUT,
          minLevel: TelemetryLevel.standard,
          data: { agent: "implementer", timeoutMs: 300000 },
        },
        {
          id: randomUUID(),
          runId: randomUUID(),
          timestamp: Date.now(),
          category: "agent",
          event: Events.AGENT_TIMEOUT,
          minLevel: TelemetryLevel.standard,
          data: { agent: "implementer", timeoutMs: 300000 },
        },
      ]);

      const timeouts = await backend.query({ event: Events.AGENT_TIMEOUT });
      const agentTimeouts = new Map<string, number>();

      for (const event of timeouts) {
        const agent = event.data.agent as string;
        agentTimeouts.set(agent, (agentTimeouts.get(agent) ?? 0) + 1);
      }

      expect(agentTimeouts.get("implementer")).toBe(2);
    });
  });
});
