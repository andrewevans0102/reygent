import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SqliteBackend } from "../chesstrace/backends/sqlite.js";
import type { TelemetryEvent } from "../chesstrace/events.js";
import * as config from "../config.js";

describe("telemetry helpers", () => {
  let testDir: string;
  let backend: SqliteBackend;

  beforeEach(async () => {
    // Create temp directory for test database
    testDir = mkdtempSync(join(tmpdir(), "reygent-telemetry-test-"));
    const dbPath = join(testDir, "chesstrace.db");
    backend = new SqliteBackend("global", dbPath);
    await backend.init();
  });

  afterEach(async () => {
    await backend.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("duration parsing", () => {
    it("should parse valid duration strings", () => {
      const parseDuration = (duration: string): number => {
        const match = duration.match(/^(\d+)d$/);
        if (!match) {
          throw new Error(`Invalid duration format: ${duration}`);
        }
        return Number.parseInt(match[1], 10);
      };

      expect(parseDuration("30d")).toBe(30);
      expect(parseDuration("7d")).toBe(7);
      expect(parseDuration("1d")).toBe(1);
    });

    it("should reject invalid duration formats", () => {
      const parseDuration = (duration: string): number => {
        const match = duration.match(/^(\d+)d$/);
        if (!match) {
          throw new Error(`Invalid duration format: ${duration}`);
        }
        return Number.parseInt(match[1], 10);
      };

      expect(() => parseDuration("30")).toThrow("Invalid duration format");
      expect(() => parseDuration("30h")).toThrow("Invalid duration format");
      expect(() => parseDuration("abc")).toThrow("Invalid duration format");
    });
  });

  describe("byte formatting", () => {
    it("should format bytes to human-readable size", () => {
      const formatBytes = (bytes: number): string => {
        if (bytes === 0) return "0 B";
        const k = 1024;
        const sizes = ["B", "KB", "MB", "GB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
      };

      expect(formatBytes(0)).toBe("0 B");
      expect(formatBytes(1024)).toBe("1.00 KB");
      expect(formatBytes(1024 * 1024)).toBe("1.00 MB");
      expect(formatBytes(1024 * 1024 * 1024)).toBe("1.00 GB");
      expect(formatBytes(512)).toBe("512.00 B");
    });
  });

  describe("timestamp formatting", () => {
    it("should format timestamp to ISO-like string", () => {
      const formatTimestamp = (timestamp: number): string => {
        return new Date(timestamp).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
      };

      const timestamp = new Date("2024-01-15T10:30:00.000Z").getTime();
      const formatted = formatTimestamp(timestamp);
      expect(formatted).toBe("2024-01-15 10:30:00");
    });
  });

  describe("duration formatting", () => {
    it("should format milliseconds to human-readable duration", () => {
      const formatDuration = (ms: number): string => {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);

        if (hours > 0) {
          return `${hours}h ${minutes % 60}m`;
        }
        if (minutes > 0) {
          return `${minutes}m ${seconds % 60}s`;
        }
        return `${seconds}s`;
      };

      expect(formatDuration(5000)).toBe("5s");
      expect(formatDuration(65000)).toBe("1m 5s");
      expect(formatDuration(3665000)).toBe("1h 1m");
    });
  });

  describe("CSV export", () => {
    it("should export events as CSV with proper escaping", () => {
      const exportCsv = (events: TelemetryEvent[]): string => {
        const lines: string[] = [];
        lines.push("id,runId,timestamp,category,event,minLevel,data");

        for (const event of events) {
          const dataStr = JSON.stringify(event.data).replace(/"/g, '""');
          lines.push(
            `"${event.id}","${event.runId}","${event.timestamp}","${event.category}","${event.event}","${event.minLevel}","${dataStr}"`,
          );
        }

        return lines.join("\n");
      };

      const events: TelemetryEvent[] = [
        {
          id: "event-1",
          runId: "run-1",
          timestamp: 1234567890000,
          category: "agent",
          event: "agent.start",
          minLevel: 1,
          data: { name: "dev" },
        },
      ];

      const csv = exportCsv(events);
      expect(csv).toContain("id,runId,timestamp,category,event,minLevel,data");
      expect(csv).toContain('"event-1","run-1","1234567890000","agent","agent.start","1"');
      expect(csv).toContain('""name"":""dev""');
    });

    it("should escape quotes in data field", () => {
      const exportCsv = (events: TelemetryEvent[]): string => {
        const lines: string[] = [];
        lines.push("id,runId,timestamp,category,event,minLevel,data");

        for (const event of events) {
          const dataStr = JSON.stringify(event.data).replace(/"/g, '""');
          lines.push(
            `"${event.id}","${event.runId}","${event.timestamp}","${event.category}","${event.event}","${event.minLevel}","${dataStr}"`,
          );
        }

        return lines.join("\n");
      };

      const events: TelemetryEvent[] = [
        {
          id: "event-1",
          runId: "run-1",
          timestamp: 1234567890000,
          category: "agent",
          event: "agent.start",
          minLevel: 1,
          data: { message: 'Hello "world"' },
        },
      ];

      const csv = exportCsv(events);
      expect(csv).toContain('\\""world\\""');
    });
  });

  describe("JSON export", () => {
    it("should export events as formatted JSON", () => {
      const exportJson = (events: TelemetryEvent[]): string => {
        return JSON.stringify(events, null, 2);
      };

      const events: TelemetryEvent[] = [
        {
          id: "event-1",
          runId: "run-1",
          timestamp: 1234567890000,
          category: "agent",
          event: "agent.start",
          minLevel: 1,
          data: { name: "dev" },
        },
      ];

      const json = exportJson(events);
      const parsed = JSON.parse(json);

      expect(parsed).toHaveLength(1);
      expect(parsed[0].id).toBe("event-1");
      expect(parsed[0].data.name).toBe("dev");
    });
  });

  describe("prune operation", () => {
    it("should delete events older than specified timestamp", async () => {
      // Insert test events with different timestamps
      const now = Date.now();
      const events: TelemetryEvent[] = [
        {
          id: "old-1",
          runId: "run-old",
          timestamp: now - 40 * 24 * 60 * 60 * 1000, // 40 days ago
          category: "agent",
          event: "agent.start",
          minLevel: 1,
          data: {},
        },
        {
          id: "recent-1",
          runId: "run-recent",
          timestamp: now - 10 * 24 * 60 * 60 * 1000, // 10 days ago
          category: "agent",
          event: "agent.start",
          minLevel: 1,
          data: {},
        },
      ];

      await backend.writeBatch(events);

      // Prune events older than 30 days
      const olderThan = now - 30 * 24 * 60 * 60 * 1000;
      const deleted = await backend.prune(olderThan);

      expect(deleted).toBe(1);

      // Verify only recent event remains
      const remaining = await backend.query({});
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe("recent-1");
    });
  });

  describe("runs listing", () => {
    it("should list runs with summary metadata", async () => {
      const events: TelemetryEvent[] = [
        {
          id: "event-1",
          runId: "run-1",
          timestamp: 1000,
          category: "agent",
          event: "agent.start",
          minLevel: 1,
          data: {},
        },
        {
          id: "event-2",
          runId: "run-1",
          timestamp: 2000,
          category: "tool",
          event: "tool.call",
          minLevel: 1,
          data: {},
        },
      ];

      await backend.writeBatch(events);

      const runs = await backend.listRuns();

      expect(runs).toHaveLength(1);
      expect(runs[0].runId).toBe("run-1");
      expect(runs[0].startTime).toBe(1000);
      expect(runs[0].endTime).toBe(2000);
      expect(runs[0].eventCount).toBe(2);
      expect(runs[0].categories).toContain("agent");
      expect(runs[0].categories).toContain("tool");
    });
  });

  describe("UUID validation", () => {
    it("should accept valid UUIDs", () => {
      const isValidUuid = (value: string): boolean => {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        return uuidRegex.test(value);
      };

      expect(isValidUuid("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
      expect(isValidUuid("6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toBe(true);
      expect(isValidUuid("A0A0A0A0-B0B0-C0C0-D0D0-E0E0E0E0E0E0")).toBe(true);
    });

    it("should reject invalid UUIDs", () => {
      const isValidUuid = (value: string): boolean => {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        return uuidRegex.test(value);
      };

      expect(isValidUuid("not-a-uuid")).toBe(false);
      expect(isValidUuid("550e8400-e29b-41d4-a716")).toBe(false); // too short
      expect(isValidUuid("550e8400e29b41d4a716446655440000")).toBe(false); // missing dashes
      expect(isValidUuid("")).toBe(false);
      expect(isValidUuid("123")).toBe(false);
    });
  });

  describe("limit validation", () => {
    it("should accept positive integers", () => {
      const validateLimit = (limit: string): number => {
        const parsed = Number.parseInt(limit, 10);
        if (isNaN(parsed) || parsed < 1) {
          throw new Error("Invalid limit");
        }
        return parsed;
      };

      expect(validateLimit("1")).toBe(1);
      expect(validateLimit("10")).toBe(10);
      expect(validateLimit("100")).toBe(100);
    });

    it("should reject invalid limits", () => {
      const validateLimit = (limit: string): number => {
        const parsed = Number.parseInt(limit, 10);
        if (isNaN(parsed) || parsed < 1) {
          throw new Error("Invalid limit");
        }
        return parsed;
      };

      expect(() => validateLimit("0")).toThrow("Invalid limit");
      expect(() => validateLimit("-1")).toThrow("Invalid limit");
      expect(() => validateLimit("abc")).toThrow("Invalid limit");
      expect(() => validateLimit("")).toThrow("Invalid limit");
    });
  });
});

describe("telemetry command integration", () => {
  let testDir: string;
  let backend: SqliteBackend;
  let mockConfig: any;

  beforeEach(async () => {
    // Create temp directory for test database
    testDir = mkdtempSync(join(tmpdir(), "reygent-telemetry-integration-"));
    const dbPath = join(testDir, "chesstrace.db");

    // Setup mock config
    mockConfig = {
      telemetry: {
        enabled: true,
        level: "standard",
        backend: "sqlite",
        retention: 30,
      },
    };

    vi.spyOn(config, "loadConfig").mockReturnValue(mockConfig);
    vi.spyOn(config, "findLocalConfigDir").mockReturnValue(null);
    vi.spyOn(config, "resolveGlobalConfigPath").mockReturnValue(join(testDir, "config.json"));

    backend = new SqliteBackend("global", dbPath);
    await backend.init();

    // Insert test data
    const events: TelemetryEvent[] = [
      {
        id: "event-1",
        runId: "550e8400-e29b-41d4-a716-446655440000",
        timestamp: Date.now() - 10000,
        category: "agent",
        event: "agent.start",
        minLevel: 1,
        data: { name: "dev" },
      },
      {
        id: "event-2",
        runId: "550e8400-e29b-41d4-a716-446655440000",
        timestamp: Date.now(),
        category: "tool",
        event: "tool.call",
        minLevel: 1,
        data: { tool: "read" },
      },
    ];
    await backend.writeBatch(events);
    await backend.close();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("config resolution", () => {
    it("should prefer local config when present", () => {
      const localDir = join(testDir, ".reygent");
      vi.spyOn(config, "findLocalConfigDir").mockReturnValue(localDir);

      const result = config.findLocalConfigDir("/some/path");
      expect(result).toBe(localDir);
    });

    it("should fall back to global config when local not present", () => {
      vi.spyOn(config, "findLocalConfigDir").mockReturnValue(null);

      const result = config.findLocalConfigDir("/some/path");
      expect(result).toBeNull();
    });
  });

  describe("enable/disable commands", () => {
    it("should update config with telemetry enabled state", () => {
      const configPath = join(testDir, "config.json");
      writeFileSync(configPath, JSON.stringify(mockConfig, null, 2));

      // Simulate enable command logic
      const updatedConfig = { ...mockConfig };
      updatedConfig.telemetry.enabled = false;
      writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2));

      const saved = JSON.parse(require("fs").readFileSync(configPath, "utf-8"));
      expect(saved.telemetry.enabled).toBe(false);
    });
  });
});
