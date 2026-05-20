import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { MockInstance } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

// Mock declarations appear before vi.mock calls in source, but vitest
// hoists vi.mock to the top of the file so the mocks are defined first.
const mockSelect = vi.fn();
const mockInput = vi.fn();
vi.mock("@inquirer/prompts", () => ({
  select: (...args: unknown[]) => mockSelect(...args),
  input: (...args: unknown[]) => mockInput(...args),
}));

const inquirerCoreMock = vi.hoisted(() => {
  class MockExitPromptError extends Error {
    override name = "ExitPromptError";
  }
  return { MockExitPromptError };
});
vi.mock("@inquirer/core", () => ({
  ExitPromptError: inquirerCoreMock.MockExitPromptError,
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(() => ""),
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
vi.mock("../providers/index.js", () => ({
  PROVIDER_NAMES: ["claude", "gemini"],
  getProvider: (name: string) => {
    if (name === "claude") {
      return {
        defaultModel: "claude-default",
        supportedModels: [
          { id: "claude-default", label: "Claude Default" },
          { id: "claude-other", label: "Claude Other" },
        ],
        vertexModels: [
          { id: "claude-vertex", label: "Claude Vertex" },
        ],
      };
    }
    return {
      defaultModel: "gemini-default",
      supportedModels: [],
    };
  },
}));
vi.mock("../knowledge/manager.js", () => ({
  ensureKnowledgeDir: vi.fn(async () => {}),
}));
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
const mockReadFileSync = vi.mocked(readFileSync);
const mockWriteFileSync = vi.mocked(writeFileSync);

import { initCommand } from "./init.js";

describe("initCommand", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: MockInstance<typeof process.exit>;
  let originalIsTTY: boolean | undefined;

  beforeEach(() => {
    vi.resetAllMocks();
    mockReadFileSync.mockReturnValue("");
    // Drive select() based on its prompt message so the same default works for
    // the provider, API platform, and model picks during init.
    mockSelect.mockImplementation(async (opts: { message: string }) => {
      if (/platform/i.test(opts.message)) return "direct";
      if (/provider/i.test(opts.message)) return "claude";
      if (/model/i.test(opts.message)) return "claude-default";
      throw new Error(`Unexpected select prompt: ${opts.message}`);
    });
    mockInput.mockResolvedValue("gemini-default");
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => {
        throw new Error("process.exit");
      });

    // Mock TTY to simulate interactive terminal
    originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    exitSpy.mockRestore();
    // Restore original TTY state
    Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, configurable: true });
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

  it("cancel choice makes no changes when config exists", async () => {
    mockExistsSync.mockReturnValue(true);
    mockSelect.mockResolvedValue("cancel");

    await initCommand({ dryRun: false });

    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("already exists");
    expect(output).toContain("No changes made.");

    expect(mockMkdirSync).not.toHaveBeenCalled();
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it("reset choice overwrites config with defaults", async () => {
    mockExistsSync.mockReturnValue(true);
    // First select() handles the existing-config action, then provider, platform, model.
    mockSelect.mockReset();
    mockSelect
      .mockResolvedValueOnce("reset")
      .mockResolvedValueOnce("claude")
      .mockResolvedValueOnce("direct")
      .mockResolvedValueOnce("claude-default");

    await initCommand({ dryRun: false });

    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("Resetting config to defaults...");

    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining("config.json"),
      expect.any(String),
      "utf-8",
    );

    // All paths already exist on reset — no dirs should be created
    expect(mockMkdirSync).not.toHaveBeenCalled();
  });

  it("edit choice directs user to reygent config", async () => {
    mockExistsSync.mockReturnValue(true);
    mockSelect.mockResolvedValue("edit");

    await initCommand({ dryRun: false });

    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("reygent config");

    expect(mockMkdirSync).not.toHaveBeenCalled();
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it("Ctrl+C exits cleanly with code 0", async () => {
    mockExistsSync.mockReturnValue(true);
    mockSelect.mockRejectedValue(new inquirerCoreMock.MockExitPromptError("User force closed the prompt"));

    await expect(initCommand({ dryRun: false })).rejects.toThrow("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(0);
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

    // Should contain the mocked builtinAgents with provider/model populated from prompt selection
    expect(config.agents).toEqual([
      {
        name: "dev",
        description: "Dev",
        systemPrompt: "You are dev",
        tools: ["read"],
        role: "developer",
        provider: "claude",
        model: "claude-default",
      },
    ]);

    // Should contain skills config
    expect(config.skills).toEqual({ path: "skills" });

    // Provider and model come from the init prompt selection
    expect(config.provider).toBe("claude");
    expect(config.model).toBe("claude-default");
  });

  it("uses vertex model list when user picks Google Vertex AI", async () => {
    mockExistsSync.mockReturnValue(false);
    mockSelect.mockImplementation(async (opts: { message: string }) => {
      if (/platform/i.test(opts.message)) return "vertex";
      if (/provider/i.test(opts.message)) return "claude";
      if (/model/i.test(opts.message)) return "claude-vertex";
      throw new Error(`Unexpected select prompt: ${opts.message}`);
    });

    await initCommand({ dryRun: false });

    const writtenContent = mockWriteFileSync.mock.calls[0]?.[1] as string;
    const config = JSON.parse(writtenContent.trim());
    expect(config.provider).toBe("claude");
    expect(config.model).toBe("claude-vertex");
  });

  it(".reygent/.gitignore includes chesstrace.db", async () => {
    mockExistsSync.mockReturnValue(false);

    await initCommand({ dryRun: false });

    const reygentGitignoreCall = mockWriteFileSync.mock.calls.find((c) =>
      String(c[0]).endsWith(".reygent/.gitignore"),
    );
    expect(reygentGitignoreCall).toBeDefined();
    const content = reygentGitignoreCall?.[1] as string;
    expect(content).toContain("chesstrace.db");
  });

  it("creates root .gitignore with reygent-dashboard.html and chesstrace.db entries when none exists", async () => {
    // Nothing exists — including the root .gitignore
    mockExistsSync.mockReturnValue(false);

    await initCommand({ dryRun: false });

    const rootGitignoreCall = mockWriteFileSync.mock.calls.find((c) => {
      const path = String(c[0]);
      return path.endsWith("/.gitignore") && !path.includes(".reygent/");
    });
    expect(rootGitignoreCall).toBeDefined();
    const content = rootGitignoreCall?.[1] as string;
    expect(content).toContain("reygent-dashboard.html");
    expect(content).toContain(".reygent/chesstrace.db");
    expect(content).toContain(".reygent/chesstrace.db-journal");
    expect(content).toContain(".reygent/chesstrace.db-wal");
    expect(content).toContain(".reygent/chesstrace.db-shm");
  });

  it("appends to existing root .gitignore without duplicating", async () => {
    // .reygent does not exist, but root .gitignore does with ALL entries already present
    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      return path.endsWith("/.gitignore") && !path.includes(".reygent/");
    });
    mockReadFileSync.mockReturnValue(
      "node_modules/\nreygent-dashboard.html\n.reygent/chesstrace.db\n.reygent/chesstrace.db-journal\n.reygent/chesstrace.db-wal\n.reygent/chesstrace.db-shm\n",
    );

    await initCommand({ dryRun: false });

    // No write to root .gitignore because all entries already present
    const rootGitignoreWrites = mockWriteFileSync.mock.calls.filter((c) => {
      const path = String(c[0]);
      return path.endsWith("/.gitignore") && !path.includes(".reygent/");
    });
    expect(rootGitignoreWrites).toHaveLength(0);
  });

  it("appends new entries to a root .gitignore missing the entry", async () => {
    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      return path.endsWith("/.gitignore") && !path.includes(".reygent/");
    });
    mockReadFileSync.mockReturnValue("node_modules/\n");

    await initCommand({ dryRun: false });

    const rootGitignoreCall = mockWriteFileSync.mock.calls.find((c) => {
      const path = String(c[0]);
      return path.endsWith("/.gitignore") && !path.includes(".reygent/");
    });
    expect(rootGitignoreCall).toBeDefined();
    const content = rootGitignoreCall?.[1] as string;
    expect(content).toContain("node_modules/");
    expect(content).toContain("reygent-dashboard.html");
    expect(content).toContain(".reygent/chesstrace.db");
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

  it("exits with code 1 in non-TTY when existing config found", async () => {
    // Simulate non-TTY environment (CI)
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });

    mockExistsSync.mockReturnValue(true);

    await expect(initCommand({ dryRun: false })).rejects.toThrow("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(1);

    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("Cannot prompt in non-interactive mode");
  });

  it("dry-run works in non-TTY environment (as suggested in error message)", async () => {
    // Simulate non-TTY environment (CI)
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });

    mockExistsSync.mockReturnValue(true);

    // dry-run should not require prompts and should not exit
    await initCommand({ dryRun: true });

    // Should complete successfully without calling process.exit
    expect(exitSpy).not.toHaveBeenCalled();

    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("[dry-run]");
    expect(output).toContain("Would create:");

    // No filesystem writes should occur
    expect(mockMkdirSync).not.toHaveBeenCalled();
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });
});
