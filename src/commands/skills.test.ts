import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync, mkdirSync, writeFileSync, rmSync, readdirSync, statSync, readFileSync } from "node:fs";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  rmSync: vi.fn(),
  readFileSync: vi.fn(() => JSON.stringify({ version: "0.1.0" })),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
}));

vi.mock("../config.js", () => ({
  findLocalConfigDir: vi.fn(),
  resolveGlobalConfigDir: vi.fn(() => "/home/user/.reygent"),
  resolveSkillsDir: vi.fn(),
}));

vi.mock("../registry.js", () => ({
  listRemoteSkills: vi.fn(),
  fetchSkillManifest: vi.fn(),
  fetchSkillFiles: vi.fn(),
  checkCompatibility: vi.fn(),
}));

vi.mock("../skills.js", () => ({
  validateSkillName: vi.fn(),
}));

vi.mock("../debug.js", () => ({
  isDebug: vi.fn(() => false),
}));

// Mock ora — factory must return fresh spinner each call
vi.mock("ora", () => {
  function createSpinner() {
    const spinner: Record<string, unknown> = { text: "" };
    spinner.start = vi.fn(() => spinner);
    spinner.succeed = vi.fn(() => spinner);
    spinner.fail = vi.fn(() => spinner);
    spinner.warn = vi.fn(() => spinner);
    spinner.stop = vi.fn(() => spinner);
    return spinner;
  }
  const oraFn = vi.fn(() => createSpinner());
  return { default: oraFn };
});

// Mock chalk to pass through
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

import { findLocalConfigDir, resolveGlobalConfigDir, resolveSkillsDir } from "../config.js";
import { listRemoteSkills, fetchSkillManifest, fetchSkillFiles, checkCompatibility } from "../registry.js";
import { validateSkillName } from "../skills.js";

const mockExistsSync = vi.mocked(existsSync);
const mockMkdirSync = vi.mocked(mkdirSync);
const mockWriteFileSync = vi.mocked(writeFileSync);
const mockRmSync = vi.mocked(rmSync);
const mockFindLocalConfigDir = vi.mocked(findLocalConfigDir);
const mockResolveSkillsDir = vi.mocked(resolveSkillsDir);
const mockListRemoteSkills = vi.mocked(listRemoteSkills);
const mockFetchSkillManifest = vi.mocked(fetchSkillManifest);
const mockFetchSkillFiles = vi.mocked(fetchSkillFiles);
const mockCheckCompatibility = vi.mocked(checkCompatibility);
const mockValidateSkillName = vi.mocked(validateSkillName);

// We test the command handlers by importing the module and calling action handlers
// through commander. We'll use a more direct approach by importing the register function
// and invoking commands programmatically.

import { Command } from "commander";
import { registerSkillsCommand } from "./skills.js";

function createProgram(): Command {
  const program = new Command();
  program.exitOverride(); // throw instead of process.exit
  registerSkillsCommand(program);
  return program;
}

describe("skills list", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockResolveSkillsDir.mockReturnValue(null);
  });

  it("lists remote skills", async () => {
    mockListRemoteSkills.mockResolvedValue([
      { name: "code-reviewer", description: "Reviews code", license: "MIT", version: "1.0.0" },
      { name: "test-gen", description: "Generates tests" },
    ]);

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const program = createProgram();
    await program.parseAsync(["node", "reygent", "skills", "list"]);

    expect(mockListRemoteSkills).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("shows [installed] badge for installed skills", async () => {
    mockListRemoteSkills.mockResolvedValue([
      { name: "code-reviewer", description: "Reviews code" },
    ]);
    mockResolveSkillsDir.mockImplementation((scope) => {
      if (scope === "local") return "/project/.reygent/skills";
      return "/home/user/.reygent/skills";
    });
    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      if (path === "/project/.reygent/skills") return true;
      if (path === "/project/.reygent/skills/code-reviewer") return true;
      if (path === "/project/.reygent/skills/code-reviewer/SKILL.md") return true;
      return false;
    });
    vi.mocked(readdirSync).mockReturnValue(["code-reviewer"] as unknown as ReturnType<typeof readdirSync>);
    vi.mocked(statSync).mockReturnValue({ isDirectory: () => true } as ReturnType<typeof statSync>);

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const program = createProgram();
    await program.parseAsync(["node", "reygent", "skills", "list"]);

    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("[installed]");
    consoleSpy.mockRestore();
  });
});

describe("skills add", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockValidateSkillName.mockReturnValue(true);
    mockCheckCompatibility.mockReturnValue(true);
  });

  it("installs skill to local dir", async () => {
    mockFindLocalConfigDir.mockReturnValue("/project/.reygent");
    mockExistsSync.mockReturnValue(false); // skill not already installed
    mockFetchSkillManifest.mockResolvedValue({
      name: "code-reviewer",
      description: "Reviews code",
      body: "# Instructions",
      skillPath: "code-reviewer",
    });
    mockFetchSkillFiles.mockResolvedValue([
      { path: "SKILL.md", content: "---\nname: code-reviewer\n---\n# Instructions" },
    ]);

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const program = createProgram();
    await program.parseAsync(["node", "reygent", "skills", "add", "code-reviewer"]);

    expect(mockMkdirSync).toHaveBeenCalled();
    expect(mockWriteFileSync).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("installs skill to global dir with --global", async () => {
    mockExistsSync.mockReturnValue(false);
    mockFetchSkillManifest.mockResolvedValue({
      name: "code-reviewer",
      description: "Reviews code",
      body: "# Instructions",
      skillPath: "code-reviewer",
    });
    mockFetchSkillFiles.mockResolvedValue([
      { path: "SKILL.md", content: "content" },
    ]);

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const program = createProgram();
    await program.parseAsync(["node", "reygent", "skills", "add", "code-reviewer", "--global"]);

    const writePath = mockWriteFileSync.mock.calls[0]?.[0] as string;
    expect(writePath).toContain(".reygent/skills/code-reviewer");
    consoleSpy.mockRestore();
  });

  it("errors when skill already installed", async () => {
    mockFindLocalConfigDir.mockReturnValue("/project/.reygent");
    mockExistsSync.mockReturnValue(true); // already exists

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });

    const program = createProgram();
    await expect(
      program.parseAsync(["node", "reygent", "skills", "add", "code-reviewer"]),
    ).rejects.toThrow();

    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("already installed");
    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("errors when no local .reygent and not --global", async () => {
    mockFindLocalConfigDir.mockReturnValue(null);
    mockExistsSync.mockReturnValue(false);

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });

    const program = createProgram();
    await expect(
      program.parseAsync(["node", "reygent", "skills", "add", "code-reviewer"]),
    ).rejects.toThrow();

    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("reygent init");
    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("errors on invalid skill name", async () => {
    mockValidateSkillName.mockReturnValue(false);

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });

    const program = createProgram();
    await expect(
      program.parseAsync(["node", "reygent", "skills", "add", "BAD NAME"]),
    ).rejects.toThrow();

    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("Invalid skill name");
    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });
});

describe("skills remove", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockValidateSkillName.mockReturnValue(true);
  });

  it("removes installed skill", async () => {
    mockFindLocalConfigDir.mockReturnValue("/project/.reygent");
    mockExistsSync.mockReturnValue(true);

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const program = createProgram();
    await program.parseAsync(["node", "reygent", "skills", "remove", "code-reviewer"]);

    expect(mockRmSync).toHaveBeenCalledWith(
      expect.stringContaining("code-reviewer"),
      { recursive: true, force: true },
    );
    consoleSpy.mockRestore();
  });

  it("errors when skill not found", async () => {
    mockFindLocalConfigDir.mockReturnValue("/project/.reygent");
    mockExistsSync.mockReturnValue(false);

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit"); });

    const program = createProgram();
    await expect(
      program.parseAsync(["node", "reygent", "skills", "remove", "nonexistent"]),
    ).rejects.toThrow();

    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("not found");
    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("removes from global dir with --global", async () => {
    mockExistsSync.mockReturnValue(true);

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const program = createProgram();
    await program.parseAsync(["node", "reygent", "skills", "remove", "code-reviewer", "--global"]);

    const rmPath = mockRmSync.mock.calls[0]?.[0] as string;
    expect(rmPath).toContain(".reygent/skills/code-reviewer");
    consoleSpy.mockRestore();
  });
});
