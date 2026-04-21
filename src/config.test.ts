import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { loadConfig, getAgents } from "./config.js";
import { builtinAgents } from "./agents.js";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
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
      return String(p).includes(".reygent/config.json");
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
      return String(p).includes(".reygent/config.json");
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({ model: "claude-opus-4-6" }));

    const config = loadConfig();
    expect(config.agents).toEqual(builtinAgents);
  });

  it("throws on invalid JSON", () => {
    mockExistsSync.mockImplementation((p) => {
      return String(p).includes(".reygent/config.json");
    });
    mockReadFileSync.mockReturnValue("not json{");

    expect(() => loadConfig()).toThrow(/failed to parse/i);
  });

  it("searches upward from cwd", () => {
    // First call for /fake/project/.reygent/config.json returns false
    // Second call for /fake/.reygent/config.json returns true
    let callCount = 0;
    mockExistsSync.mockImplementation(() => {
      callCount++;
      return callCount === 2; // found on second directory
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({}));

    loadConfig();
    expect(mockExistsSync).toHaveBeenCalledTimes(2);
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
      return String(p).includes(".reygent/config.json");
    });
    mockReadFileSync.mockReturnValue(JSON.stringify({
      agents: [{ name: "a", description: "d", systemPrompt: "s", tools: [], role: "r" }],
    }));

    const agents = getAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe("a");
  });
});
