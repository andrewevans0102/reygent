import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { loadConfig, getAgents, findLocalConfigDir, resolveSkillsPath, resolveSkillsDir, resolveGlobalConfigDir, getSkillsAsAgents, findGlobalConfig, resolveGlobalConfigPath } from "./config.js";
import { builtinAgents } from "./agents.js";
import type { SkillManifest } from "./skills.js";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
}));

vi.mock("./skills.js", () => ({
  discoverSkills: vi.fn(() => []),
  skillToAgentConfig: vi.fn((s: SkillManifest) => ({
    name: s.name,
    description: s.description,
    systemPrompt: s.body,
    tools: ["read"],
    role: "skill",
  })),
}));

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);

describe("loadConfig", () => {
  beforeEach(() => {
    vi.spyOn(process, "cwd").mockReturnValue("/fake/project");
    mockExistsSync.mockReturnValue(false);
  });

  it("returns builtin agents when no local config", () => {
    const config = loadConfig();
    expect(config.agents).toEqual(builtinAgents);
  });

  it("returns empty skills when no local config", () => {
    const config = loadConfig();
    expect(config.skills).toEqual({});
  });

  it("returns default telemetry config when no local config", () => {
    const config = loadConfig();
    expect(config.telemetry).toEqual({
      enabled: undefined,
      level: 'standard',
      backend: 'sqlite',
      retention: 30,
    });
  });

  it("loads local config when found", () => {
    mockExistsSync.mockImplementation((p) => {
      return String(p).includes(".reygent");
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({
      agents: [{ name: "custom", description: "d", systemPrompt: "s", tools: ["read"], role: "dev" }],
      model: "claude-opus-4-6",
    }));

    const config = loadConfig();
    expect(config.agents).toHaveLength(1);
    expect(config.agents![0].name).toBe("custom");
    expect(config.model).toBe("claude-opus-4-6");
  });

  it("falls back to builtins when config has no agents", () => {
    mockExistsSync.mockImplementation((p) => {
      return String(p).includes(".reygent");
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ model: "claude-opus-4-6" }));

    const config = loadConfig();
    expect(config.agents).toEqual(builtinAgents);
  });

  it("loads custom telemetry config when provided", () => {
    mockExistsSync.mockImplementation((p) => {
      return String(p).includes(".reygent");
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({
      telemetry: {
        enabled: true,
        level: 'verbose',
        backend: 'sqlite',
        retention: 90,
      },
    }));

    const config = loadConfig();
    expect(config.telemetry).toEqual({
      enabled: true,
      level: 'verbose',
      backend: 'sqlite',
      retention: 90,
    });
  });

  it("applies default telemetry when config has no telemetry field", () => {
    mockExistsSync.mockImplementation((p) => {
      return String(p).includes(".reygent");
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({
      agents: [{ name: "custom", description: "d", systemPrompt: "s", tools: ["read"], role: "dev" }],
    }));

    const config = loadConfig();
    expect(config.telemetry).toEqual({
      enabled: undefined,
      level: 'standard',
      backend: 'sqlite',
      retention: 30,
    });
  });

  it("throws on invalid JSON", () => {
    mockExistsSync.mockImplementation((p) => {
      return String(p).includes(".reygent");
    });
    mockReadFileSync.mockReturnValue("not json{");

    expect(() => loadConfig()).toThrow(/failed to parse/i);
  });

  it("searches upward from cwd", () => {
    let callCount = 0;
    mockExistsSync.mockImplementation(() => {
      callCount++;
      // .reygent dir found on second check, config.json found on third
      return callCount >= 2;
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({}));

    loadConfig();
    expect(mockExistsSync).toHaveBeenCalled();
  });

  it("falls back to global config when no local config exists", () => {
    // No local .reygent dir, but global config.json exists
    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      return path.endsWith(".reygent/config.json") && path.includes(require("os").homedir());
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({
      provider: "gemini",
      model: "gemini-2.5-pro",
    }));

    const config = loadConfig();
    expect(config.provider).toBe("gemini");
    expect(config.model).toBe("gemini-2.5-pro");
    expect(config.agents).toEqual(builtinAgents);
    expect(config.telemetry).toEqual({
      enabled: undefined,
      level: 'standard',
      backend: 'sqlite',
      retention: 30,
    });
  });

  it("local config takes precedence over global config", () => {
    // Both local and global exist
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({
      provider: "claude",
      model: "claude-opus-4-6",
    }));

    const config = loadConfig();
    expect(config.provider).toBe("claude");
  });

  it("throws on invalid global config JSON", () => {
    // No local .reygent dir, but global config exists
    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      return path.endsWith(".reygent/config.json") && path.includes(require("os").homedir());
    });
    mockReadFileSync.mockReturnValue("invalid json{");

    expect(() => loadConfig()).toThrow(/failed to parse global config/i);
  });

  it("validates telemetry schema and rejects invalid config", () => {
    mockExistsSync.mockImplementation((p) => {
      return String(p).includes(".reygent");
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({
      telemetry: {
        enabled: true,
        level: 'invalid-level',
        backend: 'sqlite',
        retention: 30,
      },
    }));

    expect(() => loadConfig()).toThrow();
  });

  it("loads telemetry with enabled false from local config", () => {
    mockExistsSync.mockImplementation((p) => {
      return String(p).includes(".reygent");
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({
      telemetry: {
        enabled: false,
        level: 'minimal',
        backend: 'sqlite',
        retention: 7,
      },
    }));

    const config = loadConfig();
    expect(config.telemetry?.enabled).toBe(false);
    expect(config.telemetry?.level).toBe('minimal');
    expect(config.telemetry?.retention).toBe(7);
  });

  it("distinguishes telemetry enabled undefined vs false", () => {
    mockExistsSync.mockImplementation((p) => {
      return String(p).includes(".reygent");
    });

    mockReadFileSync.mockReturnValue(JSON.stringify({
      telemetry: {
        level: 'standard',
        backend: 'sqlite',
        retention: 30,
      },
    }));
    const configUndefined = loadConfig();

    mockReadFileSync.mockReturnValue(JSON.stringify({
      telemetry: {
        enabled: false,
        level: 'standard',
        backend: 'sqlite',
        retention: 30,
      },
    }));
    const configFalse = loadConfig();

    expect(configUndefined.telemetry?.enabled).toBeUndefined();
    expect(configFalse.telemetry?.enabled).toBe(false);
    expect(configUndefined.telemetry?.enabled === configFalse.telemetry?.enabled).toBe(false);
  });

  it("loads telemetry from global config with all fields", () => {
    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      return path.endsWith(".reygent/config.json") && path.includes(require("os").homedir());
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({
      telemetry: {
        enabled: true,
        level: 'verbose',
        backend: 'sqlite',
        retention: 14,
      },
    }));

    const config = loadConfig();
    expect(config.telemetry?.enabled).toBe(true);
    expect(config.telemetry?.level).toBe('verbose');
    expect(config.telemetry?.retention).toBe(14);
  });

  it("rejects telemetry with invalid backend", () => {
    mockExistsSync.mockImplementation((p) => {
      return String(p).includes(".reygent");
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({
      telemetry: {
        level: 'standard',
        backend: 'postgres',
        retention: 30,
      },
    }));

    expect(() => loadConfig()).toThrow();
  });

  it("rejects telemetry with negative retention", () => {
    mockExistsSync.mockImplementation((p) => {
      return String(p).includes(".reygent");
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({
      telemetry: {
        level: 'standard',
        backend: 'sqlite',
        retention: -10,
      },
    }));

    expect(() => loadConfig()).toThrow();
  });

  it("rejects telemetry with zero retention", () => {
    mockExistsSync.mockImplementation((p) => {
      return String(p).includes(".reygent");
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({
      telemetry: {
        level: 'standard',
        backend: 'sqlite',
        retention: 0,
      },
    }));

    expect(() => loadConfig()).toThrow();
  });

  it("accepts telemetry with retention 1 day", () => {
    mockExistsSync.mockImplementation((p) => {
      return String(p).includes(".reygent");
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({
      telemetry: {
        level: 'minimal',
        backend: 'sqlite',
        retention: 1,
      },
    }));

    const config = loadConfig();
    expect(config.telemetry?.retention).toBe(1);
  });

  it("accepts telemetry with large retention value", () => {
    mockExistsSync.mockImplementation((p) => {
      return String(p).includes(".reygent");
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({
      telemetry: {
        enabled: true,
        level: 'verbose',
        backend: 'sqlite',
        retention: 365,
      },
    }));

    const config = loadConfig();
    expect(config.telemetry?.retention).toBe(365);
  });

  it("loads all three telemetry levels correctly", () => {
    mockExistsSync.mockImplementation((p) => {
      return String(p).includes(".reygent");
    });

    const levels = ['minimal', 'standard', 'verbose'] as const;
    for (const level of levels) {
      mockReadFileSync.mockReturnValue(JSON.stringify({
        telemetry: {
          level,
          backend: 'sqlite',
          retention: 30,
        },
      }));
      const config = loadConfig();
      expect(config.telemetry?.level).toBe(level);
    }
  });

  it("local telemetry config takes precedence over global", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({
      telemetry: {
        enabled: true,
        level: 'verbose',
        backend: 'sqlite',
        retention: 90,
      },
    }));

    const config = loadConfig();
    expect(config.telemetry?.level).toBe('verbose');
    expect(config.telemetry?.retention).toBe(90);
  });
});

describe("findLocalConfigDir", () => {
  beforeEach(() => {
    mockExistsSync.mockReturnValue(false);
  });

  it("returns null when no .reygent dir found", () => {
    expect(findLocalConfigDir("/fake/project")).toBeNull();
  });

  it("returns .reygent dir when found", () => {
    mockExistsSync.mockImplementation((p) => {
      return String(p) === "/fake/project/.reygent";
    });
    expect(findLocalConfigDir("/fake/project")).toBe("/fake/project/.reygent");
  });

  it("searches parent directories", () => {
    mockExistsSync.mockImplementation((p) => {
      return String(p) === "/fake/.reygent";
    });
    expect(findLocalConfigDir("/fake/project")).toBe("/fake/.reygent");
  });
});

describe("resolveSkillsPath", () => {
  it("uses default 'skills' when no path configured", () => {
    const result = resolveSkillsPath({}, "/fake/.reygent");
    expect(result).toBe("/fake/.reygent/skills");
  });

  it("uses configured path", () => {
    const result = resolveSkillsPath({ skills: { path: "custom-skills" } }, "/fake/.reygent");
    expect(result).toBe("/fake/.reygent/custom-skills");
  });
});

describe("resolveGlobalConfigDir", () => {
  it("returns ~/.reygent path", () => {
    const result = resolveGlobalConfigDir();
    expect(result).toMatch(/\.reygent$/);
  });
});

describe("resolveGlobalConfigPath", () => {
  it("returns canonical path regardless of existence", () => {
    const result = resolveGlobalConfigPath();
    expect(result).toMatch(/\.reygent\/config\.json$/);
  });
});

describe("findGlobalConfig", () => {
  it("returns path when global config exists", () => {
    mockExistsSync.mockImplementation((p) =>
      String(p).endsWith(".reygent/config.json"),
    );
    const result = findGlobalConfig();
    expect(result).toMatch(/\.reygent\/config\.json$/);
  });

  it("returns null when no global config", () => {
    mockExistsSync.mockReturnValue(false);
    expect(findGlobalConfig()).toBeNull();
  });
});

describe("resolveSkillsDir", () => {
  beforeEach(() => {
    vi.spyOn(process, "cwd").mockReturnValue("/fake/project");
    mockExistsSync.mockReturnValue(false);
  });

  it("returns global skills path for global scope", () => {
    const result = resolveSkillsDir("global");
    expect(result).toMatch(/\.reygent\/skills$/);
  });

  it("returns null for local scope when no .reygent dir", () => {
    expect(resolveSkillsDir("local")).toBeNull();
  });

  it("returns local skills path when .reygent dir exists", () => {
    mockExistsSync.mockImplementation((p) => String(p).includes(".reygent"));
    mockReadFileSync.mockReturnValue(JSON.stringify({}));
    const result = resolveSkillsDir("local");
    expect(result).toMatch(/\.reygent\/skills$/);
  });
});

describe("getSkillsAsAgents", () => {
  beforeEach(() => {
    vi.spyOn(process, "cwd").mockReturnValue("/fake/project");
    mockExistsSync.mockReturnValue(false);
  });

  it("returns empty when no config dir and no global skills", () => {
    expect(getSkillsAsAgents()).toEqual([]);
  });

  it("discovers global skills when no local config dir", async () => {
    const { discoverSkills } = await import("./skills.js");
    const mockDiscover = vi.mocked(discoverSkills);

    // No local .reygent dir
    mockExistsSync.mockReturnValue(false);
    mockDiscover.mockImplementation((path) => {
      if (String(path).includes(".reygent/skills")) {
        return [{ name: "global-skill", description: "from global", body: "body", skillPath: "/g" }];
      }
      return [];
    });

    const agents = getSkillsAsAgents();
    expect(agents.some((a) => a.name === "global-skill")).toBe(true);
  });

  it("local skills take precedence over global on name conflict", async () => {
    const { discoverSkills, skillToAgentConfig } = await import("./skills.js");
    const mockDiscover = vi.mocked(discoverSkills);
    const mockConvert = vi.mocked(skillToAgentConfig);

    mockExistsSync.mockImplementation((p) => String(p).includes(".reygent"));
    mockReadFileSync.mockReturnValue(JSON.stringify({}));

    let callIndex = 0;
    mockDiscover.mockImplementation(() => {
      callIndex++;
      // First call = local, second call = global
      if (callIndex === 1) {
        return [{ name: "shared-skill", description: "local version", body: "local", skillPath: "/l" }];
      }
      return [{ name: "shared-skill", description: "global version", body: "global", skillPath: "/g" }];
    });

    mockConvert.mockImplementation((s) => ({
      name: s.name,
      description: s.description,
      systemPrompt: s.body,
      tools: ["read"],
      role: "skill",
    }));

    const agents = getSkillsAsAgents();
    const shared = agents.filter((a) => a.name === "shared-skill");
    expect(shared).toHaveLength(1);
    expect(shared[0].description).toBe("local version");
  });

  it("applies disabled list across both scopes", async () => {
    const { discoverSkills } = await import("./skills.js");
    const mockDiscover = vi.mocked(discoverSkills);

    mockExistsSync.mockImplementation((p) => String(p).includes(".reygent"));
    mockReadFileSync.mockReturnValue(JSON.stringify({ skills: { disabled: ["blocked-skill"] } }));

    mockDiscover.mockReturnValue([
      { name: "blocked-skill", description: "should be disabled", body: "body", skillPath: "/x" },
      { name: "allowed-skill", description: "should appear", body: "body", skillPath: "/y" },
    ]);

    const agents = getSkillsAsAgents();
    expect(agents.some((a) => a.name === "blocked-skill")).toBe(false);
    expect(agents.some((a) => a.name === "allowed-skill")).toBe(true);
  });
});

describe("getAgents", () => {
  beforeEach(() => {
    vi.spyOn(process, "cwd").mockReturnValue("/fake/project");
    mockExistsSync.mockReturnValue(false);
  });

  it("returns builtin agents by default", () => {
    const agents = getAgents();
    expect(agents).toEqual(builtinAgents);
  });

  it("returns agents from local config", () => {
    mockExistsSync.mockImplementation((p) => {
      return String(p).includes(".reygent");
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({
      agents: [{ name: "a", description: "d", systemPrompt: "s", tools: [], role: "r" }],
    }));

    const agents = getAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe("a");
  });

  it("merges skill agents with config agents", async () => {
    const { discoverSkills } = await import("./skills.js");
    const mockDiscover = vi.mocked(discoverSkills);

    mockExistsSync.mockImplementation((p) => {
      return String(p).includes(".reygent");
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({
      agents: [{ name: "dev", description: "d", systemPrompt: "s", tools: ["read"], role: "developer" }],
      skills: { path: "skills" },
    }));
    mockDiscover.mockReturnValue([
      { name: "my-skill", description: "skill desc", body: "instructions", skillPath: "/x", allowedTools: ["read"] },
    ]);

    const agents = getAgents();
    expect(agents.some((a) => a.name === "dev")).toBe(true);
    expect(agents.some((a) => a.name === "my-skill")).toBe(true);
  });

  it("config agent takes precedence over skill with same name", async () => {
    const { discoverSkills } = await import("./skills.js");
    const mockDiscover = vi.mocked(discoverSkills);
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    mockExistsSync.mockImplementation((p) => {
      return String(p).includes(".reygent");
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({
      agents: [{ name: "overlap", description: "config version", systemPrompt: "s", tools: ["read"], role: "dev" }],
      skills: { path: "skills" },
    }));
    mockDiscover.mockReturnValue([
      { name: "overlap", description: "skill version", body: "instructions", skillPath: "/x" },
    ]);

    const agents = getAgents();
    const overlap = agents.filter((a) => a.name === "overlap");
    expect(overlap).toHaveLength(1);
    expect(overlap[0].description).toBe("config version");
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("shadowed"));

    consoleSpy.mockRestore();
  });
});
