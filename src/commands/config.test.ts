import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, writeFileSync, mkdirSync, lstatSync, renameSync, unlinkSync } from "node:fs";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  lstatSync: vi.fn(),
  renameSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

const mockSelect = vi.fn();
const mockConfirm = vi.fn();
const mockInput = vi.fn();
vi.mock("@inquirer/prompts", () => ({
  select: (...args: unknown[]) => mockSelect(...args),
  confirm: (...args: unknown[]) => mockConfirm(...args),
  input: (...args: unknown[]) => mockInput(...args),
}));

vi.mock("../config.js", () => ({
  findLocalConfigDir: vi.fn(),
  resolveGlobalConfigPath: vi.fn(() => "/home/user/.reygent/config.json"),
}));

vi.mock("../agents.js", () => ({
  builtinAgents: [
    {
      name: "dev",
      description: "Dev agent",
      systemPrompt: "You are dev",
      tools: ["read", "write"],
      role: "developer",
    },
    {
      name: "qe",
      description: "QE agent",
      systemPrompt: "You are qe",
      tools: ["read"],
      role: "quality-engineer",
    },
  ],
}));

const mockClaudeAvailable = vi.fn().mockResolvedValue({ available: true });
const mockGeminiAvailable = vi.fn().mockResolvedValue({ available: false, reason: "no API key" });
const mockCodexAvailable = vi.fn().mockResolvedValue({ available: false, reason: "not installed" });
const mockOpenrouterAvailable = vi.fn().mockResolvedValue({ available: true });

vi.mock("../providers/index.js", () => ({
  PROVIDER_NAMES: ["claude", "gemini", "codex", "openrouter"],
  getProvider: vi.fn((name: string) => {
    const providers: Record<string, unknown> = {
      claude: {
        name: "claude",
        defaultModel: "claude-sonnet-4-5",
        supportedModels: [
          { id: "claude-sonnet-4-5", label: "Sonnet 4.5" },
          { id: "claude-opus-4-6", label: "Opus 4.6" },
        ],
        isAvailable: mockClaudeAvailable,
      },
      gemini: {
        name: "gemini",
        defaultModel: "gemini-2.5-pro",
        supportedModels: [{ id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" }],
        isAvailable: mockGeminiAvailable,
      },
      codex: {
        name: "codex",
        defaultModel: "o4-mini",
        supportedModels: [{ id: "o4-mini", label: "o4-mini" }],
        isAvailable: mockCodexAvailable,
      },
      openrouter: {
        name: "openrouter",
        defaultModel: "anthropic/claude-sonnet-4-5",
        supportedModels: [],
        isAvailable: mockOpenrouterAvailable,
      },
    };
    return providers[name];
  }),
}));

vi.mock("../debug.js", () => ({ isDebug: vi.fn(() => false) }));

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

import { findLocalConfigDir } from "../config.js";
import { configCommand } from "./config.js";

const mockFindLocalConfigDir = vi.mocked(findLocalConfigDir);
const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockWriteFileSync = vi.mocked(writeFileSync);
const mockMkdirSync = vi.mocked(mkdirSync);
const mockLstatSync = vi.mocked(lstatSync);
const mockRenameSync = vi.mocked(renameSync);
const mockUnlinkSync = vi.mocked(unlinkSync);

describe("configCommand", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetAllMocks();
    // Default: proceed with unavailable providers (tests override as needed)
    mockConfirm.mockResolvedValue(true);
    // Default: file exists
    mockExistsSync.mockReturnValue(true);
    // Default: lstatSync returns non-symlink stats
    mockLstatSync.mockReturnValue({
      isSymbolicLink: () => false,
    } as ReturnType<typeof lstatSync>);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("errors when no .reygent/ dir found (local scope)", async () => {
    mockSelect.mockResolvedValueOnce("local"); // scope
    mockFindLocalConfigDir.mockReturnValue(null);

    await expect(configCommand()).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);

    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("No .reygent/ directory found");
    expect(output).toContain("reygent init");
  });

  it("walks prompts and writes correct config", async () => {
    mockSelect.mockResolvedValueOnce("local"); // scope
    mockFindLocalConfigDir.mockReturnValue("/proj/.reygent");
    mockReadFileSync.mockReturnValue(JSON.stringify({
      provider: "claude",
      model: "claude-sonnet-4-5",
      agents: [
        { name: "dev", description: "Dev", systemPrompt: "sp", tools: ["read"], role: "developer" },
      ],
    }));

    // Default provider → claude
    mockSelect.mockResolvedValueOnce("claude");
    // Default model → claude-opus-4-6
    mockSelect.mockResolvedValueOnce("claude-opus-4-6");
    // Configure dev? → keep
    mockSelect.mockResolvedValueOnce("keep");

    await configCommand();

    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    const written = JSON.parse((mockWriteFileSync.mock.calls[0]![1] as string).trim());
    expect(written.provider).toBe("claude");
    expect(written.model).toBe("claude-opus-4-6");
  });

  it("preserves unknown fields in raw config", async () => {
    mockSelect.mockResolvedValueOnce("local"); // scope
    mockFindLocalConfigDir.mockReturnValue("/proj/.reygent");
    mockReadFileSync.mockReturnValue(JSON.stringify({
      provider: "claude",
      model: "claude-sonnet-4-5",
      customField: "preserve-me",
      skills: { path: "my-skills" },
      agents: [
        { name: "dev", description: "Dev", systemPrompt: "sp", tools: ["read"], role: "developer", extraField: 42 },
      ],
    }));

    mockSelect.mockResolvedValueOnce("gemini");
    mockSelect.mockResolvedValueOnce("gemini-2.5-pro");
    // Warn about unavailable provider
    mockConfirm.mockResolvedValueOnce(true); // proceed with unavailable provider
    mockSelect.mockResolvedValueOnce("keep");

    await configCommand();

    const written = JSON.parse((mockWriteFileSync.mock.calls[0]![1] as string).trim());
    expect(written.customField).toBe("preserve-me");
    expect(written.skills).toEqual({ path: "my-skills" });
    expect(written.agents[0].extraField).toBe(42);
    expect(written.agents[0].systemPrompt).toBe("sp");
  });

  it("uses input prompt for OpenRouter model", async () => {
    mockSelect.mockResolvedValueOnce("local"); // scope
    mockFindLocalConfigDir.mockReturnValue("/proj/.reygent");
    mockReadFileSync.mockReturnValue(JSON.stringify({
      provider: "openrouter",
      model: "anthropic/claude-sonnet-4-5",
      agents: [],
    }));

    mockSelect.mockResolvedValueOnce("openrouter"); // available, no warning
    mockInput.mockResolvedValueOnce("meta-llama/llama-3-70b");

    await configCommand();

    // Verify input was called (not select for model)
    expect(mockInput).toHaveBeenCalledTimes(1);
    const written = JSON.parse((mockWriteFileSync.mock.calls[0]![1] as string).trim());
    expect(written.model).toBe("meta-llama/llama-3-70b");
  });

  it("skipping agent customization preserves existing values", async () => {
    mockSelect.mockResolvedValueOnce("local"); // scope
    mockFindLocalConfigDir.mockReturnValue("/proj/.reygent");
    mockReadFileSync.mockReturnValue(JSON.stringify({
      provider: "claude",
      model: "claude-sonnet-4-5",
      agents: [
        { name: "dev", description: "Dev", systemPrompt: "sp", tools: ["read"], role: "developer", provider: "gemini", model: "gemini-2.5-pro" },
      ],
    }));

    mockSelect.mockResolvedValueOnce("claude");
    mockSelect.mockResolvedValueOnce("claude-sonnet-4-5");
    mockSelect.mockResolvedValueOnce("keep"); // keep current config

    await configCommand();

    const written = JSON.parse((mockWriteFileSync.mock.calls[0]![1] as string).trim());
    // Agent provider/model stay unchanged since we chose "keep"
    expect(written.agents[0].provider).toBe("gemini");
    expect(written.agents[0].model).toBe("gemini-2.5-pro");
  });

  it("applies per-agent overrides correctly", async () => {
    mockSelect.mockResolvedValueOnce("local"); // scope
    mockFindLocalConfigDir.mockReturnValue("/proj/.reygent");
    mockReadFileSync.mockReturnValue(JSON.stringify({
      provider: "claude",
      model: "claude-sonnet-4-5",
      agents: [
        { name: "dev", description: "Dev", systemPrompt: "sp", tools: ["read"], role: "developer" },
        { name: "qe", description: "QE", systemPrompt: "sp2", tools: ["read"], role: "quality-engineer" },
      ],
    }));

    // Default
    mockSelect.mockResolvedValueOnce("claude");
    mockSelect.mockResolvedValueOnce("claude-sonnet-4-5");
    // Agent: dev → customize
    mockSelect.mockResolvedValueOnce("customize");
    mockSelect.mockResolvedValueOnce("gemini");
    mockConfirm.mockResolvedValueOnce(true); // proceed with unavailable provider
    mockSelect.mockResolvedValueOnce("gemini-2.5-pro");
    // Agent: qe → keep
    mockSelect.mockResolvedValueOnce("keep");

    await configCommand();

    const written = JSON.parse((mockWriteFileSync.mock.calls[0]![1] as string).trim());
    expect(written.agents[0].provider).toBe("gemini");
    expect(written.agents[0].model).toBe("gemini-2.5-pro");
    // qe unchanged
    expect(written.agents[1].provider).toBeUndefined();
    expect(written.agents[1].model).toBeUndefined();
  });

  it("exits 2 on write error", async () => {
    mockSelect.mockResolvedValueOnce("local"); // scope
    mockFindLocalConfigDir.mockReturnValue("/proj/.reygent");
    mockReadFileSync.mockReturnValue(JSON.stringify({
      provider: "claude",
      model: "claude-sonnet-4-5",
      agents: [],
    }));

    mockSelect.mockResolvedValueOnce("claude"); // available, no warning
    mockSelect.mockResolvedValueOnce("claude-sonnet-4-5");

    mockWriteFileSync.mockImplementation(() => {
      throw new Error("EACCES: permission denied");
    });

    await expect(configCommand()).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(2);
  });

  it("exits 0 on Ctrl+C", async () => {
    const exitError = new Error("prompt cancelled");
    (exitError as Error & { name: string }).name = "ExitPromptError";
    mockSelect.mockRejectedValueOnce(exitError); // scope prompt cancelled

    await expect(configCommand()).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(0);

    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("cancelled");
  });

  it("uses builtinAgents when rawConfig has no agents array", async () => {
    mockSelect.mockResolvedValueOnce("local"); // scope
    mockFindLocalConfigDir.mockReturnValue("/proj/.reygent");
    mockReadFileSync.mockReturnValue(JSON.stringify({
      provider: "claude",
      model: "claude-sonnet-4-5",
    }));

    mockSelect.mockResolvedValueOnce("claude");
    mockSelect.mockResolvedValueOnce("claude-sonnet-4-5");
    // builtinAgents mock has 2 agents
    mockSelect.mockResolvedValueOnce("keep");
    mockSelect.mockResolvedValueOnce("keep");

    await configCommand();

    const written = JSON.parse((mockWriteFileSync.mock.calls[0]![1] as string).trim());
    expect(written.agents).toHaveLength(2);
    expect(written.agents[0].name).toBe("dev");
    expect(written.agents[1].name).toBe("qe");
  });

  it("warns and confirms when selecting unavailable provider", async () => {
    mockSelect.mockResolvedValueOnce("local"); // scope
    mockFindLocalConfigDir.mockReturnValue("/proj/.reygent");
    mockReadFileSync.mockReturnValue(JSON.stringify({
      provider: "claude",
      model: "claude-sonnet-4-5",
      agents: [],
    }));

    // Select unavailable provider (gemini)
    mockSelect.mockResolvedValueOnce("gemini");
    // Should prompt to proceed
    mockConfirm.mockResolvedValueOnce(true);
    mockSelect.mockResolvedValueOnce("gemini-2.5-pro");

    await configCommand();

    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Continue with this provider anyway?",
      })
    );
    const written = JSON.parse((mockWriteFileSync.mock.calls[0]![1] as string).trim());
    expect(written.provider).toBe("gemini");
  });

  it("cancels when user declines unavailable provider", async () => {
    mockSelect.mockResolvedValueOnce("local"); // scope
    mockFindLocalConfigDir.mockReturnValue("/proj/.reygent");
    mockReadFileSync.mockReturnValue(JSON.stringify({
      provider: "claude",
      model: "claude-sonnet-4-5",
      agents: [],
    }));

    mockSelect.mockResolvedValueOnce("gemini");
    mockConfirm.mockResolvedValueOnce(false); // decline

    await expect(configCommand()).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("handles clearing agent overrides", async () => {
    mockSelect.mockResolvedValueOnce("local"); // scope
    mockFindLocalConfigDir.mockReturnValue("/proj/.reygent");
    mockReadFileSync.mockReturnValue(JSON.stringify({
      provider: "claude",
      model: "claude-sonnet-4-5",
      agents: [
        { name: "dev", description: "Dev", systemPrompt: "sp", tools: ["read"], role: "developer", provider: "gemini", model: "gemini-2.5-pro" },
      ],
    }));

    mockSelect.mockResolvedValueOnce("claude");
    mockSelect.mockResolvedValueOnce("claude-sonnet-4-5");
    mockSelect.mockResolvedValueOnce("clear"); // clear overrides

    await configCommand();

    const written = JSON.parse((mockWriteFileSync.mock.calls[0]![1] as string).trim());
    expect(written.agents[0].provider).toBeUndefined();
    expect(written.agents[0].model).toBeUndefined();
    // Other fields preserved
    expect(written.agents[0].name).toBe("dev");
    expect(written.agents[0].systemPrompt).toBe("sp");
  });

  it("handles extra agents in config.json not in builtinAgents", async () => {
    mockSelect.mockResolvedValueOnce("local"); // scope
    mockFindLocalConfigDir.mockReturnValue("/proj/.reygent");
    mockReadFileSync.mockReturnValue(JSON.stringify({
      provider: "claude",
      model: "claude-sonnet-4-5",
      agents: [
        { name: "dev", description: "Dev", systemPrompt: "sp", tools: ["read"], role: "developer" },
        { name: "custom", description: "Custom", systemPrompt: "custom", tools: ["read"], role: "custom" },
      ],
    }));

    mockSelect.mockResolvedValueOnce("claude");
    mockSelect.mockResolvedValueOnce("claude-sonnet-4-5");
    mockSelect.mockResolvedValueOnce("keep"); // dev
    mockSelect.mockResolvedValueOnce("keep"); // custom

    await configCommand();

    const written = JSON.parse((mockWriteFileSync.mock.calls[0]![1] as string).trim());
    expect(written.agents).toHaveLength(2);
    expect(written.agents[0].name).toBe("dev");
    expect(written.agents[1].name).toBe("custom");
    // Custom agent preserved
    expect(written.agents[1].systemPrompt).toBe("custom");
  });

  it("distinguishes JSON parse errors from file read errors", async () => {
    mockSelect.mockResolvedValueOnce("local"); // scope
    mockFindLocalConfigDir.mockReturnValue("/proj/.reygent");
    mockReadFileSync.mockImplementation(() => {
      throw new SyntaxError("Unexpected token } in JSON at position 42");
    });

    await expect(configCommand()).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(2);

    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("Invalid JSON");
    expect(output).toContain("Parse error:");
  });

  it("handles permission denied error", async () => {
    mockSelect.mockResolvedValueOnce("local"); // scope
    mockFindLocalConfigDir.mockReturnValue("/proj/.reygent");
    const err = new Error("EACCES: permission denied");
    (err as Error & { code: string }).code = "EACCES";
    mockReadFileSync.mockImplementation(() => {
      throw err;
    });

    await expect(configCommand()).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(2);

    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("Permission denied");
  });

  // --- Global scope tests ---

  it("creates global config file when global scope selected", async () => {
    mockSelect.mockResolvedValueOnce("global"); // scope
    // Global dir exists but config file does not
    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      if (path.endsWith("config.json")) return false;
      return true;
    });

    mockSelect.mockResolvedValueOnce("claude"); // provider
    mockSelect.mockResolvedValueOnce("claude-sonnet-4-5"); // model
    // builtinAgents mock has 2 agents
    mockSelect.mockResolvedValueOnce("keep");
    mockSelect.mockResolvedValueOnce("keep");

    await configCommand();

    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    const writtenPath = mockWriteFileSync.mock.calls[0]![0];
    expect(writtenPath).toContain(".reygent/config.json");
  });

  it("creates ~/.reygent dir if it does not exist (global scope)", async () => {
    mockSelect.mockResolvedValueOnce("global"); // scope
    mockExistsSync.mockReturnValue(false); // neither dir nor file exist

    mockSelect.mockResolvedValueOnce("claude");
    mockSelect.mockResolvedValueOnce("claude-sonnet-4-5");
    mockSelect.mockResolvedValueOnce("keep");
    mockSelect.mockResolvedValueOnce("keep");

    await configCommand();

    expect(mockMkdirSync).toHaveBeenCalledWith(
      expect.stringContaining(".reygent"),
      { recursive: true },
    );
  });

  it("starts with empty config when global file does not exist", async () => {
    mockSelect.mockResolvedValueOnce("global"); // scope
    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      if (path.endsWith("config.json")) return false;
      return true; // dir exists
    });

    mockSelect.mockResolvedValueOnce("claude");
    mockSelect.mockResolvedValueOnce("claude-opus-4-6");
    mockSelect.mockResolvedValueOnce("keep");
    mockSelect.mockResolvedValueOnce("keep");

    await configCommand();

    const written = JSON.parse((mockWriteFileSync.mock.calls[0]![1] as string).trim());
    expect(written.provider).toBe("claude");
    expect(written.model).toBe("claude-opus-4-6");
    // Should have builtinAgents since config started empty
    expect(written.agents).toHaveLength(2);
  });

  // --- Agent grouping tests ---

  it("shows agent role badges and tools in output", async () => {
    mockSelect.mockResolvedValueOnce("local"); // scope
    mockFindLocalConfigDir.mockReturnValue("/proj/.reygent");
    mockReadFileSync.mockReturnValue(JSON.stringify({
      provider: "claude",
      model: "claude-sonnet-4-5",
      agents: [
        { name: "dev", description: "Dev agent", systemPrompt: "sp", tools: ["read", "write"], role: "developer" },
      ],
    }));

    mockSelect.mockResolvedValueOnce("claude");
    mockSelect.mockResolvedValueOnce("claude-sonnet-4-5");
    mockSelect.mockResolvedValueOnce("keep");

    await configCommand();

    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("developer");
    expect(output).toContain("Development");
    expect(output).toContain("read");
    expect(output).toContain("write");
  });

  it("groups agents by category", async () => {
    mockSelect.mockResolvedValueOnce("local"); // scope
    mockFindLocalConfigDir.mockReturnValue("/proj/.reygent");
    mockReadFileSync.mockReturnValue(JSON.stringify({
      provider: "claude",
      model: "claude-sonnet-4-5",
      agents: [
        { name: "dev", description: "Dev", systemPrompt: "sp", tools: ["read"], role: "developer" },
        { name: "qe", description: "QE", systemPrompt: "sp", tools: ["read"], role: "quality-engineer" },
      ],
    }));

    mockSelect.mockResolvedValueOnce("claude");
    mockSelect.mockResolvedValueOnce("claude-sonnet-4-5");
    mockSelect.mockResolvedValueOnce("keep");
    mockSelect.mockResolvedValueOnce("keep");

    await configCommand();

    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("Development");
    expect(output).toContain("Testing & Review");
  });

  it("puts uncategorized agents in Other group", async () => {
    mockSelect.mockResolvedValueOnce("local"); // scope
    mockFindLocalConfigDir.mockReturnValue("/proj/.reygent");
    mockReadFileSync.mockReturnValue(JSON.stringify({
      provider: "claude",
      model: "claude-sonnet-4-5",
      agents: [
        { name: "custom", description: "Custom", systemPrompt: "sp", tools: ["read"], role: "unknown-role" },
      ],
    }));

    mockSelect.mockResolvedValueOnce("claude");
    mockSelect.mockResolvedValueOnce("claude-sonnet-4-5");
    mockSelect.mockResolvedValueOnce("keep");

    await configCommand();

    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("Other");
  });

  it("shows scope and file path in summary", async () => {
    mockSelect.mockResolvedValueOnce("local"); // scope
    mockFindLocalConfigDir.mockReturnValue("/proj/.reygent");
    mockReadFileSync.mockReturnValue(JSON.stringify({
      provider: "claude",
      model: "claude-sonnet-4-5",
      agents: [],
    }));

    mockSelect.mockResolvedValueOnce("claude");
    mockSelect.mockResolvedValueOnce("claude-sonnet-4-5");

    await configCommand();

    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("local");
    expect(output).toContain("/proj/.reygent/config.json");
  });

  it("rejects symlink temp file (security)", async () => {
    mockSelect.mockResolvedValueOnce("local"); // scope
    mockFindLocalConfigDir.mockReturnValue("/proj/.reygent");
    mockReadFileSync.mockReturnValue(JSON.stringify({
      provider: "claude",
      model: "claude-sonnet-4-5",
      agents: [],
    }));

    mockSelect.mockResolvedValueOnce("claude");
    mockSelect.mockResolvedValueOnce("claude-sonnet-4-5");

    // Temp file write succeeds, but lstatSync reports it as symlink
    mockLstatSync.mockReturnValueOnce({
      isSymbolicLink: () => true,
    } as ReturnType<typeof lstatSync>);

    await expect(configCommand()).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(2);

    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("Security: temp file became symlink");
    expect(mockUnlinkSync).toHaveBeenCalled(); // cleanup
  });

  it("shows global scope path in summary", async () => {
    mockSelect.mockResolvedValueOnce("global"); // scope
    mockExistsSync.mockImplementation((p) => {
      const path = String(p);
      if (path.endsWith("config.json")) return false;
      return true; // dir exists
    });

    mockSelect.mockResolvedValueOnce("claude");
    mockSelect.mockResolvedValueOnce("claude-opus-4-6");
    mockSelect.mockResolvedValueOnce("keep");
    mockSelect.mockResolvedValueOnce("keep");

    await configCommand();

    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("global");
    expect(output).toContain(".reygent/config.json");
  });
});
