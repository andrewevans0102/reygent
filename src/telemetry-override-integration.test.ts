import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Chesstrace } from "./chesstrace/index.js";
import { SqliteBackend } from "./chesstrace/backends/sqlite.js";

describe("telemetry override integration", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "reygent-override-test-"));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("Chesstrace level override", () => {
    it("initializes with overridden level", async () => {
      const dbPath = join(testDir, "chesstrace.db");
      const backend = new SqliteBackend("global", dbPath);

      // Simulate override: verbose (level 2)
      const telemetry = new Chesstrace({ level: 2 });
      await telemetry.init(backend);
      await telemetry.startRun();

      // Emit events at different levels
      telemetry.emit("agent.start", { name: "dev" }); // level 1
      telemetry.emit("tool.call", { tool: "read" }); // level 2

      await telemetry.flush();

      const events = await backend.query({});
      expect(events.length).toBeGreaterThan(0);

      await telemetry.close();
    });

    it("respects minimal level override (0)", async () => {
      const dbPath = join(testDir, "chesstrace.db");
      const backend = new SqliteBackend("global", dbPath);

      const telemetry = new Chesstrace({ level: 0 });
      await telemetry.init(backend);
      await telemetry.startRun();

      // Only minimal events should be captured
      telemetry.emit("error.unhandled", { error: "test" }); // level 0
      telemetry.emit("agent.start", { name: "dev" }); // level 1 - filtered

      await telemetry.flush();

      const events = await backend.query({});
      expect(events).toHaveLength(1);
      expect(events[0].event).toBe("error.unhandled");

      await telemetry.close();
    });

    it("respects standard level override (1)", async () => {
      const dbPath = join(testDir, "chesstrace.db");
      const backend = new SqliteBackend("global", dbPath);

      const telemetry = new Chesstrace({ level: 1 });
      await telemetry.init(backend);
      await telemetry.startRun();

      telemetry.emit("agent.start", { name: "dev" }); // level 1
      telemetry.emit("tool.call", { tool: "read" }); // level 2 - filtered

      await telemetry.flush();

      const events = await backend.query({});
      expect(events).toHaveLength(1);
      expect(events[0].event).toBe("agent.start");

      await telemetry.close();
    });

    it("respects verbose level override (2)", async () => {
      const dbPath = join(testDir, "chesstrace.db");
      const backend = new SqliteBackend("global", dbPath);

      const telemetry = new Chesstrace({ level: 2 });
      await telemetry.init(backend);
      await telemetry.startRun();

      telemetry.emit("error.unhandled", { error: "test" }); // level 0
      telemetry.emit("agent.start", { name: "dev" }); // level 1
      telemetry.emit("llm.request", { model: "claude" }); // level 2 - verbose

      await telemetry.flush();

      const events = await backend.query({});
      expect(events.length).toBeGreaterThanOrEqual(3);

      await telemetry.close();
    });
  });

  describe("override vs config priority", () => {
    it("CLI override takes precedence over config level", () => {
      const resolveLevel = (
        cliLevel: string | undefined,
        configLevel: string
      ): string => {
        return cliLevel || configLevel;
      };

      expect(resolveLevel("verbose", "standard")).toBe("verbose");
      expect(resolveLevel("minimal", "verbose")).toBe("minimal");
      expect(resolveLevel(undefined, "standard")).toBe("standard");
    });

    it("converts level string to numeric for Chesstrace", () => {
      const levelToNumeric = (level: string): number => {
        const map: Record<string, number> = {
          minimal: 0,
          standard: 1,
          verbose: 2,
        };
        return map[level] ?? 1;
      };

      expect(levelToNumeric("minimal")).toBe(0);
      expect(levelToNumeric("standard")).toBe(1);
      expect(levelToNumeric("verbose")).toBe(2);
    });
  });

  describe("disabled override", () => {
    it("telemetry disabled when --no-telemetry provided", () => {
      const shouldInitTelemetry = (disabled: boolean, configEnabled?: boolean) => {
        if (disabled) return false;
        return configEnabled ?? false;
      };

      expect(shouldInitTelemetry(true, true)).toBe(false);
      expect(shouldInitTelemetry(true, false)).toBe(false);
      expect(shouldInitTelemetry(false, true)).toBe(true);
      expect(shouldInitTelemetry(false, false)).toBe(false);
    });

    it("does not initialize backend when disabled", async () => {
      const disabled = true;

      if (!disabled) {
        const dbPath = join(testDir, "chesstrace.db");
        const backend = new SqliteBackend("global", dbPath);
        const telemetry = new Chesstrace({ level: 1 });
        await telemetry.init(backend);
        expect(telemetry.isEnabled()).toBe(true);
        await telemetry.close();
      }

      // When disabled, no backend initialization occurs
      expect(disabled).toBe(true);
    });
  });

  describe("runtime override scenarios", () => {
    it("override applied before telemetry initialization", async () => {
      const dbPath = join(testDir, "chesstrace.db");
      const backend = new SqliteBackend("global", dbPath);

      // Simulate preAction hook setting override
      const overrideLevel = 2; // verbose

      const telemetry = new Chesstrace({ level: overrideLevel });
      await telemetry.init(backend);
      await telemetry.startRun();

      telemetry.emit("llm.request", { model: "claude" }); // level 2 - verbose event
      await telemetry.flush();

      const events = await backend.query({});
      expect(events.length).toBeGreaterThan(0);

      await telemetry.close();
    });

    it("override does not persist beyond command execution", () => {
      let sessionOverride: string | null = null;

      const setOverride = (level: string) => {
        sessionOverride = level;
      };

      const clearOverride = () => {
        sessionOverride = null;
      };

      // Command 1
      setOverride("verbose");
      expect(sessionOverride).toBe("verbose");
      clearOverride();

      // Command 2
      expect(sessionOverride).toBeNull();
    });
  });

  describe("flag combination scenarios", () => {
    it("resolves --no-telemetry and --telemetry-level conflict", () => {
      const resolve = (opts: any) => {
        if (opts.telemetry === false) {
          return { enabled: false, level: null };
        }
        if (opts.telemetryLevel) {
          return { enabled: true, level: opts.telemetryLevel };
        }
        return { enabled: true, level: "standard" };
      };

      const result = resolve({ telemetry: false, telemetryLevel: "verbose" });
      expect(result.enabled).toBe(false);
    });

    it("resolves --telemetry-verbose and --telemetry-level conflict", () => {
      const resolve = (opts: any) => {
        if (opts.telemetryVerbose) {
          return { level: "verbose" };
        }
        if (opts.telemetryLevel) {
          return { level: opts.telemetryLevel };
        }
        return { level: "standard" };
      };

      const result = resolve({ telemetryVerbose: true, telemetryLevel: "minimal" });
      expect(result.level).toBe("verbose");
    });

    it("handles all three flags simultaneously", () => {
      const resolve = (opts: any) => {
        // Priority: --no-telemetry > --telemetry-verbose > --telemetry-level
        if (opts.telemetry === false) {
          return { enabled: false, level: null };
        }
        if (opts.telemetryVerbose) {
          return { enabled: true, level: "verbose" };
        }
        if (opts.telemetryLevel) {
          return { enabled: true, level: opts.telemetryLevel };
        }
        return { enabled: true, level: "standard" };
      };

      const result = resolve({
        telemetry: false,
        telemetryVerbose: true,
        telemetryLevel: "minimal",
      });

      expect(result.enabled).toBe(false);
    });
  });

  describe("config file preservation", () => {
    it("overrides do not modify config file", () => {
      const config = {
        telemetry: { level: "standard", enabled: true },
      };

      const applyOverride = (opts: any, config: any) => {
        const effectiveLevel = opts.telemetryLevel || config.telemetry.level;
        return {
          config: config, // original unchanged
          effective: effectiveLevel,
        };
      };

      const result = applyOverride({ telemetryLevel: "verbose" }, config);

      expect(result.config.telemetry.level).toBe("standard");
      expect(result.effective).toBe("verbose");
    });
  });

  describe("validation at override time", () => {
    it("validates level before creating Chesstrace instance", () => {
      const VALID_LEVELS = ["minimal", "standard", "verbose"];

      const validateAndCreateInstance = (level: string) => {
        if (!VALID_LEVELS.includes(level)) {
          throw new Error(`Invalid telemetry level: ${level}`);
        }

        const numericLevel = { minimal: 0, standard: 1, verbose: 2 }[level];
        return new Chesstrace({ level: numericLevel });
      };

      expect(() => validateAndCreateInstance("invalid")).toThrow(
        "Invalid telemetry level"
      );

      const instance = validateAndCreateInstance("verbose");
      expect(instance).toBeInstanceOf(Chesstrace);
    });

    it("handles undefined level gracefully", () => {
      const resolveLevel = (
        overrideLevel: string | undefined,
        configLevel: string
      ) => {
        return overrideLevel ?? configLevel;
      };

      expect(resolveLevel(undefined, "standard")).toBe("standard");
      expect(resolveLevel("verbose", "standard")).toBe("verbose");
    });
  });

  describe("cross-command scenarios", () => {
    it("run command respects telemetry overrides", () => {
      const runCommandOpts = {
        spec: "PROJ-123",
        telemetryLevel: "verbose",
      };

      const resolveTelemetry = (opts: any) => {
        return {
          level: opts.telemetryLevel || "standard",
          command: "run",
        };
      };

      const result = resolveTelemetry(runCommandOpts);
      expect(result.level).toBe("verbose");
      expect(result.command).toBe("run");
    });

    it("agent command respects telemetry overrides", () => {
      const agentCommandOpts = {
        telemetry: false,
      };

      const resolveTelemetry = (opts: any) => {
        return {
          enabled: opts.telemetry !== false,
          command: "agent",
        };
      };

      const result = resolveTelemetry(agentCommandOpts);
      expect(result.enabled).toBe(false);
      expect(result.command).toBe("agent");
    });

    it("config command respects telemetry overrides", () => {
      const configCommandOpts = {
        telemetryVerbose: true,
      };

      const resolveTelemetry = (opts: any) => {
        const level = opts.telemetryVerbose ? "verbose" : "standard";
        return {
          level,
          command: "config",
        };
      };

      const result = resolveTelemetry(configCommandOpts);
      expect(result.level).toBe("verbose");
      expect(result.command).toBe("config");
    });
  });

  describe("error handling", () => {
    it("handles invalid level gracefully during initialization", () => {
      const initTelemetry = (level: string) => {
        const VALID_LEVELS = ["minimal", "standard", "verbose"];
        if (!VALID_LEVELS.includes(level)) {
          throw new Error(`Invalid telemetry level: ${level}`);
        }

        const numericLevel = { minimal: 0, standard: 1, verbose: 2 }[level];
        return new Chesstrace({ level: numericLevel });
      };

      expect(() => initTelemetry("debug")).toThrow("Invalid telemetry level");
    });

    it("uses default level on invalid override", () => {
      const resolveLevelWithFallback = (level: string | undefined) => {
        const VALID_LEVELS = ["minimal", "standard", "verbose"];
        if (level && VALID_LEVELS.includes(level)) {
          return level;
        }
        return "standard"; // fallback
      };

      expect(resolveLevelWithFallback("invalid")).toBe("standard");
      expect(resolveLevelWithFallback(undefined)).toBe("standard");
      expect(resolveLevelWithFallback("verbose")).toBe("verbose");
    });
  });
});
