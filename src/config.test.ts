import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { loadConfig, getAgents, findLocalConfigDir, resolveSkillsPath, getSkillsAsAgents } from "./config.js";
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

describe("getSkillsAsAgents", () => {
  beforeEach(() => {
    vi.spyOn(process, "cwd").mockReturnValue("/fake/project");
    mockExistsSync.mockReturnValue(false);
  });

  it("returns empty when no config dir", () => {
    expect(getSkillsAsAgents()).toEqual([]);
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
