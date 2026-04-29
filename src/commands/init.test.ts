import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));
vi.mock("../agents.js", () => ({
  builtinAgents: [
    {
      name: "dev",
      description: "Dev",
      systemPrompt: "You are dev",
      tools: ["read"],
      role: "developer",
    },
  ],
}));
vi.mock("../debug.js", () => ({ isDebug: vi.fn(() => false) }));
vi.mock("../model.js", () => ({ DEFAULT_MODEL: "test-model" }));
vi.mock("ora", () => {
  function createSpinner() {
    const spinner: Record<string, unknown> = { text: "" };
    spinner.start = vi.fn(() => spinner);
    spinner.succeed = vi.fn(() => spinner);
    spinner.fail = vi.fn(() => spinner);
    spinner.stop = vi.fn(() => spinner);
    return spinner;
  }
  return { default: vi.fn(() => createSpinner()) };
});
vi.mock("chalk", () => {
  const handler: ProxyHandler<object> = {
    get: (_target, _prop) => {
      const fn = (s: string) => s;
      return new Proxy(fn, handler);
    },
    apply: (_target, _thisArg, args) => args[0],
  };
  return { default: new Proxy({}, handler) };
});

const mockExistsSync = vi.mocked(existsSync);
const mockMkdirSync = vi.mocked(mkdirSync);
const mockWriteFileSync = vi.mocked(writeFileSync);

import { initCommand } from "./init.js";

describe("initCommand", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetAllMocks();
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => {
        throw new Error("process.exit");
      });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("dry run prints preview without creating files", async () => {
    await initCommand({ dryRun: true });

    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("[dry-run]");
    expect(output).toContain("Would create:");
    expect(output).toContain(".reygent");
    expect(output).toContain("config.json");
    expect(output).toContain("Config preview:");

    // No filesystem writes should occur
    expect(mockMkdirSync).not.toHaveBeenCalled();
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it("creates .reygent dir and config.json when nothing exists", async () => {
    // Nothing exists yet
    mockExistsSync.mockReturnValue(false);

    await initCommand({ dryRun: false });

    // Should create directories
    expect(mockMkdirSync).toHaveBeenCalledWith(
      expect.stringContaining(".reygent"),
      { recursive: true },
    );
    // Should create the skills subdirectory
    expect(mockMkdirSync).toHaveBeenCalledWith(
      expect.stringContaining("skills"),
      { recursive: true },
    );
    // Should write config
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining("config.json"),
      expect.any(String),
      "utf-8",
    );
  });

  it("skips when .reygent/config.json already exists", async () => {
    // Both .reygent dir and config.json exist
    mockExistsSync.mockReturnValue(true);

    await initCommand({ dryRun: false });

    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("already exists");
    expect(output).toContain("Existing config found. Skipping initialization.");

    // Should not write any files
    expect(mockMkdirSync).not.toHaveBeenCalled();
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it("creates config.json when .reygent exists but no config.json", async () => {
    // .reygent dir exists, config.json does not, skills dir exists
    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      if (path.endsWith("config.json")) return false;
      // .reygent dir and skills dir exist
      return true;
    });

    await initCommand({ dryRun: false });

    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("already exists");
    expect(output).toContain("No config.json found. Creating default config...");

    // Should not create directories that already exist
    expect(mockMkdirSync).not.toHaveBeenCalled();

    // Should write config.json
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining("config.json"),
      expect.any(String),
      "utf-8",
    );
  });

  it("creates skills dir when .reygent exists but skills dir missing", async () => {
    // .reygent dir exists, config.json does not, skills dir does NOT exist
    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      if (path.endsWith("config.json")) return false;
      if (path.endsWith("skills")) return false;
      // .reygent dir exists
      if (path.endsWith(".reygent")) return true;
      return false;
    });

    await initCommand({ dryRun: false });

    // Should create the skills directory
    expect(mockMkdirSync).toHaveBeenCalledWith(
      expect.stringContaining("skills"),
      { recursive: true },
    );

    // Should write config.json
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining("config.json"),
      expect.any(String),
      "utf-8",
    );
  });

  it("config includes builtinAgents, skills config, and model", async () => {
    mockExistsSync.mockReturnValue(false);

    await initCommand({ dryRun: false });

    const writtenContent = mockWriteFileSync.mock.calls[0]?.[1] as string;
    const config = JSON.parse(writtenContent.trim());

    // Should contain the mocked builtinAgents
    expect(config.agents).toEqual([
      {
        name: "dev",
        description: "Dev",
        systemPrompt: "You are dev",
        tools: ["read"],
        role: "developer",
      },
    ]);

    // Should contain skills config
    expect(config.skills).toEqual({ path: "skills" });

    // Should contain the mocked DEFAULT_MODEL
    expect(config.model).toBe("test-model");
  });

  it("calls process.exit(2) on filesystem errors", async () => {
    // .reygent dir does not exist, so mkdirSync will be called
    mockExistsSync.mockReturnValue(false);
    mockMkdirSync.mockImplementation(() => {
      throw new Error("EACCES: permission denied");
    });

    await expect(initCommand({ dryRun: false })).rejects.toThrow("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(2);
  });
});
