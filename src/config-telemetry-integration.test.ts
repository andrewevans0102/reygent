import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { loadConfig } from "./config.js";
import { DEFAULT_TELEMETRY_CONFIG } from "./chesstrace/config.js";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
}));

vi.mock("./skills.js", () => ({
  discoverSkills: vi.fn(() => []),
  skillToAgentConfig: vi.fn(),
}));

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);

describe("Config telemetry integration", () => {
  beforeEach(() => {
    vi.spyOn(process, "cwd").mockReturnValue("/fake/project");
    mockExistsSync.mockReturnValue(false);
  });

  describe("Default telemetry values", () => {
    it("provides default telemetry when no config exists", () => {
      const config = loadConfig();
      expect(config.telemetry).toEqual(DEFAULT_TELEMETRY_CONFIG);
    });

    it("default telemetry has enabled undefined", () => {
      const config = loadConfig();
      expect(config.telemetry?.enabled).toBeUndefined();
    });

    it("default telemetry has level standard", () => {
      const config = loadConfig();
      expect(config.telemetry?.level).toBe("standard");
    });

    it("default telemetry has backend sqlite", () => {
      const config = loadConfig();
      expect(config.telemetry?.backend).toBe("sqlite");
    });

    it("default telemetry has retention 30", () => {
      const config = loadConfig();
      expect(config.telemetry?.retention).toBe(30);
    });
  });

  describe("Telemetry enabled tri-state behavior", () => {
    it("enabled undefined triggers first-run prompt flow", () => {
      mockExistsSync.mockImplementation((p) => String(p).includes(".reygent"));
      mockReadFileSync.mockReturnValue(JSON.stringify({
        telemetry: {
          level: "standard",
          backend: "sqlite",
          retention: 30,
        },
      }));

      const config = loadConfig();
      expect(config.telemetry?.enabled).toBeUndefined();
      // CT-5 should detect undefined and prompt user
    });

    it("enabled true means telemetry opted in", () => {
      mockExistsSync.mockImplementation((p) => String(p).includes(".reygent"));
      mockReadFileSync.mockReturnValue(JSON.stringify({
        telemetry: {
          enabled: true,
          level: "verbose",
          backend: "sqlite",
          retention: 90,
        },
      }));

      const config = loadConfig();
      expect(config.telemetry?.enabled).toBe(true);
    });

    it("enabled false means telemetry opted out", () => {
      mockExistsSync.mockImplementation((p) => String(p).includes(".reygent"));
      mockReadFileSync.mockReturnValue(JSON.stringify({
        telemetry: {
          enabled: false,
          level: "minimal",
          backend: "sqlite",
          retention: 7,
        },
      }));

      const config = loadConfig();
      expect(config.telemetry?.enabled).toBe(false);
    });

    it("distinguishes undefined from false", () => {
      // Test undefined
      mockExistsSync.mockImplementation((p) => String(p).includes(".reygent"));
      mockReadFileSync.mockReturnValue(JSON.stringify({
        telemetry: {
          level: "standard",
          backend: "sqlite",
          retention: 30,
        },
      }));
      const configUndefined = loadConfig();

      // Test false
      mockReadFileSync.mockReturnValue(JSON.stringify({
        telemetry: {
          enabled: false,
          level: "standard",
          backend: "sqlite",
          retention: 30,
        },
      }));
      const configFalse = loadConfig();

      expect(configUndefined.telemetry?.enabled).toBeUndefined();
      expect(configFalse.telemetry?.enabled).toBe(false);
      expect(configUndefined.telemetry?.enabled !== configFalse.telemetry?.enabled).toBe(true);
    });
  });

  describe("Telemetry level variations", () => {
    it("loads minimal level config", () => {
      mockExistsSync.mockImplementation((p) => String(p).includes(".reygent"));
      mockReadFileSync.mockReturnValue(JSON.stringify({
        telemetry: {
          enabled: true,
          level: "minimal",
          backend: "sqlite",
          retention: 7,
        },
      }));

      const config = loadConfig();
      expect(config.telemetry?.level).toBe("minimal");
    });

    it("loads standard level config", () => {
      mockExistsSync.mockImplementation((p) => String(p).includes(".reygent"));
      mockReadFileSync.mockReturnValue(JSON.stringify({
        telemetry: {
          enabled: true,
          level: "standard",
          backend: "sqlite",
          retention: 30,
        },
      }));

      const config = loadConfig();
      expect(config.telemetry?.level).toBe("standard");
    });

    it("loads verbose level config", () => {
      mockExistsSync.mockImplementation((p) => String(p).includes(".reygent"));
      mockReadFileSync.mockReturnValue(JSON.stringify({
        telemetry: {
          enabled: true,
          level: "verbose",
          backend: "sqlite",
          retention: 90,
        },
      }));

      const config = loadConfig();
      expect(config.telemetry?.level).toBe("verbose");
    });
  });

  describe("Telemetry retention edge cases", () => {
    it("accepts minimum retention of 1 day", () => {
      mockExistsSync.mockImplementation((p) => String(p).includes(".reygent"));
      mockReadFileSync.mockReturnValue(JSON.stringify({
        telemetry: {
          level: "minimal",
          backend: "sqlite",
          retention: 1,
        },
      }));

      const config = loadConfig();
      expect(config.telemetry?.retention).toBe(1);
    });

    it("accepts large retention value", () => {
      mockExistsSync.mockImplementation((p) => String(p).includes(".reygent"));
      mockReadFileSync.mockReturnValue(JSON.stringify({
        telemetry: {
          level: "standard",
          backend: "sqlite",
          retention: 365,
        },
      }));

      const config = loadConfig();
      expect(config.telemetry?.retention).toBe(365);
    });

    it("rejects zero retention", () => {
      mockExistsSync.mockImplementation((p) => String(p).includes(".reygent"));
      mockReadFileSync.mockReturnValue(JSON.stringify({
        telemetry: {
          level: "standard",
          backend: "sqlite",
          retention: 0,
        },
      }));

      expect(() => loadConfig()).toThrow();
    });

    it("rejects negative retention", () => {
      mockExistsSync.mockImplementation((p) => String(p).includes(".reygent"));
      mockReadFileSync.mockReturnValue(JSON.stringify({
        telemetry: {
          level: "standard",
          backend: "sqlite",
          retention: -10,
        },
      }));

      expect(() => loadConfig()).toThrow();
    });
  });

  describe("Config precedence with telemetry", () => {
    it("local config telemetry takes precedence over defaults", () => {
      mockExistsSync.mockImplementation((p) => String(p).includes(".reygent"));
      mockReadFileSync.mockReturnValue(JSON.stringify({
        telemetry: {
          enabled: true,
          level: "verbose",
          backend: "sqlite",
          retention: 120,
        },
      }));

      const config = loadConfig();
      expect(config.telemetry?.enabled).toBe(true);
      expect(config.telemetry?.level).toBe("verbose");
      expect(config.telemetry?.retention).toBe(120);
    });

    it("global config provides telemetry when no local config", () => {
      mockExistsSync.mockImplementation((p) => {
        const path = String(p);
        return path.endsWith(".reygent/config.json") && path.includes(require("os").homedir());
      });
      mockReadFileSync.mockReturnValue(JSON.stringify({
        telemetry: {
          enabled: false,
          level: "minimal",
          backend: "sqlite",
          retention: 14,
        },
      }));

      const config = loadConfig();
      expect(config.telemetry?.enabled).toBe(false);
      expect(config.telemetry?.level).toBe("minimal");
      expect(config.telemetry?.retention).toBe(14);
    });

    it("partial telemetry config merges with defaults", () => {
      mockExistsSync.mockImplementation((p) => String(p).includes(".reygent"));
      mockReadFileSync.mockReturnValue(JSON.stringify({
        model: "claude-opus-4-6",
      }));

      const config = loadConfig();
      expect(config.telemetry).toEqual(DEFAULT_TELEMETRY_CONFIG);
      expect(config.model).toBe("claude-opus-4-6");
    });
  });

  describe("Telemetry validation errors", () => {
    it("rejects invalid telemetry level", () => {
      mockExistsSync.mockImplementation((p) => String(p).includes(".reygent"));
      mockReadFileSync.mockReturnValue(JSON.stringify({
        telemetry: {
          level: "debug",
          backend: "sqlite",
          retention: 30,
        },
      }));

      expect(() => loadConfig()).toThrow();
    });

    it("rejects invalid telemetry backend", () => {
      mockExistsSync.mockImplementation((p) => String(p).includes(".reygent"));
      mockReadFileSync.mockReturnValue(JSON.stringify({
        telemetry: {
          level: "standard",
          backend: "postgres",
          retention: 30,
        },
      }));

      expect(() => loadConfig()).toThrow();
    });

    it("rejects non-boolean enabled value", () => {
      mockExistsSync.mockImplementation((p) => String(p).includes(".reygent"));
      mockReadFileSync.mockReturnValue(JSON.stringify({
        telemetry: {
          enabled: "yes",
          level: "standard",
          backend: "sqlite",
          retention: 30,
        },
      }));

      expect(() => loadConfig()).toThrow();
    });

    it("rejects missing required telemetry fields", () => {
      mockExistsSync.mockImplementation((p) => String(p).includes(".reygent"));
      mockReadFileSync.mockReturnValue(JSON.stringify({
        telemetry: {
          enabled: true,
        },
      }));

      expect(() => loadConfig()).toThrow();
    });
  });

  describe("Complete telemetry config scenarios", () => {
    it("loads complete opt-in config", () => {
      mockExistsSync.mockImplementation((p) => String(p).includes(".reygent"));
      mockReadFileSync.mockReturnValue(JSON.stringify({
        agents: [],
        telemetry: {
          enabled: true,
          level: "verbose",
          backend: "sqlite",
          retention: 90,
        },
      }));

      const config = loadConfig();
      expect(config.telemetry).toEqual({
        enabled: true,
        level: "verbose",
        backend: "sqlite",
        retention: 90,
      });
    });

    it("loads complete opt-out config", () => {
      mockExistsSync.mockImplementation((p) => String(p).includes(".reygent"));
      mockReadFileSync.mockReturnValue(JSON.stringify({
        telemetry: {
          enabled: false,
          level: "minimal",
          backend: "sqlite",
          retention: 7,
        },
      }));

      const config = loadConfig();
      expect(config.telemetry).toEqual({
        enabled: false,
        level: "minimal",
        backend: "sqlite",
        retention: 7,
      });
    });

    it("loads complete first-run config with undefined enabled", () => {
      mockExistsSync.mockImplementation((p) => String(p).includes(".reygent"));
      mockReadFileSync.mockReturnValue(JSON.stringify({
        telemetry: {
          level: "standard",
          backend: "sqlite",
          retention: 30,
        },
      }));

      const config = loadConfig();
      expect(config.telemetry).toEqual({
        enabled: undefined,
        level: "standard",
        backend: "sqlite",
        retention: 30,
      });
    });
  });
});
