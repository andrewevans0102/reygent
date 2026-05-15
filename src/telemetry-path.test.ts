import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getLocalTelemetryPath } from "./telemetry-path.js";
import { SqliteBackend } from "./chesstrace/backends/sqlite.js";

describe("telemetry-path", () => {
  let testDir: string;
  let projectDir: string;

  beforeEach(() => {
    // Create temp test directory
    testDir = mkdtempSync(join(tmpdir(), "reygent-telemetry-path-test-"));

    // Create mock project directory with .reygent marker
    projectDir = join(testDir, "project");
    mkdirSync(projectDir);
    mkdirSync(join(projectDir, ".reygent"));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("getLocalTelemetryPath", () => {
    it("should return project-local path when in project", () => {
      const dbPath = getLocalTelemetryPath(projectDir);
      expect(dbPath).toBe(`${projectDir}/.reygent/chesstrace.db`);
    });

    it("should return undefined when not in project", () => {
      const noProjectDir = join(testDir, "no-project");
      mkdirSync(noProjectDir);

      const dbPath = getLocalTelemetryPath(noProjectDir);
      expect(dbPath).toBeUndefined();
    });

    it("should return path when in nested subdirectory of project", () => {
      const nestedDir = join(projectDir, "src", "commands");
      mkdirSync(join(projectDir, "src"));
      mkdirSync(nestedDir);

      const dbPath = getLocalTelemetryPath(nestedDir);
      expect(dbPath).toBe(`${projectDir}/.reygent/chesstrace.db`);
    });
  });

  describe("analyze and last commands use identical path", () => {
    it("should resolve to same path for both analyze and last commands", async () => {
      // Simulate what getBackend() does in analyze.ts
      const analyzePath = getLocalTelemetryPath(projectDir);
      const analyzeBackend = new SqliteBackend("local", analyzePath);

      // Simulate what lastCommandImpl() does in last.ts
      const lastPath = getLocalTelemetryPath(projectDir);
      const lastBackend = new SqliteBackend("local", lastPath);

      // Both should resolve to same path
      expect(analyzePath).toBe(lastPath);
      expect(analyzePath).toBe(`${projectDir}/.reygent/chesstrace.db`);

      // Initialize and verify they can access same database
      await analyzeBackend.init();
      await lastBackend.init();

      // Write with one, read with other
      const testRunId = "test-run-123";
      await analyzeBackend.writeBatch([
        {
          id: "test-event",
          runId: testRunId,
          timestamp: Date.now(),
          category: "test",
          event: "test_event",
          minLevel: 0,
          data: { test: true },
        },
      ]);

      const runs = await lastBackend.listRuns();
      expect(runs.length).toBe(1);
      expect(runs[0].runId).toBe(testRunId);

      await analyzeBackend.close();
      await lastBackend.close();
    });

    it("should both fallback to global when not in project", async () => {
      const noProjectDir = join(testDir, "no-project");
      mkdirSync(noProjectDir);

      // Both should return undefined for global fallback
      const analyzePath = getLocalTelemetryPath(noProjectDir);
      const lastPath = getLocalTelemetryPath(noProjectDir);

      expect(analyzePath).toBeUndefined();
      expect(lastPath).toBeUndefined();
      expect(analyzePath).toBe(lastPath);
    });
  });
});
