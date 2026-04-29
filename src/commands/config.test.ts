import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
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
const mockReadFileSync = vi.mocked(readFileSync);
const mockWriteFileSync = vi.mocked(writeFileSync);

describe("configCommand", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetAllMocks();
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("errors when no .reygent/ dir found", async () => {
    mockFindLocalConfigDir.mockReturnValue(null);

    await expect(configCommand()).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(1);

    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("No .reygent/ directory found");
    expect(output).toContain("reygent init");
  });

  it("walks prompts and writes correct config", async () => {
    mockFindLocalConfigDir.mockReturnValue("/proj/.reygent");
    mockReadFileSync.mockReturnValue(JSON.stringify({
      provider: "claude",
      model: "claude-sonnet-4-5",
      agents: [
        { name: "dev", description: "Dev", systemPrompt: "sp", tools: ["read"], role: "developer" },
      ],
    }));

    // Global provider → claude
    mockSelect.mockResolvedValueOnce("claude");
    // Global model → claude-opus-4-6
    mockSelect.mockResolvedValueOnce("claude-opus-4-6");
    // Customize dev? → no
    mockConfirm.mockResolvedValueOnce(false);

    await configCommand();

    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    const written = JSON.parse((mockWriteFileSync.mock.calls[0]![1] as string).trim());
    expect(written.provider).toBe("claude");
    expect(written.model).toBe("claude-opus-4-6");
  });

  it("preserves unknown fields in raw config", async () => {
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
    mockConfirm.mockResolvedValueOnce(false);

    await configCommand();

    const written = JSON.parse((mockWriteFileSync.mock.calls[0]![1] as string).trim());
    expect(written.customField).toBe("preserve-me");
    expect(written.skills).toEqual({ path: "my-skills" });
    expect(written.agents[0].extraField).toBe(42);
    expect(written.agents[0].systemPrompt).toBe("sp");
  });

  it("uses input prompt for OpenRouter model", async () => {
    mockFindLocalConfigDir.mockReturnValue("/proj/.reygent");
    mockReadFileSync.mockReturnValue(JSON.stringify({
      provider: "openrouter",
      model: "anthropic/claude-sonnet-4-5",
      agents: [],
    }));

    mockSelect.mockResolvedValueOnce("openrouter");
    mockInput.mockResolvedValueOnce("meta-llama/llama-3-70b");

    await configCommand();

    // Verify input was called (not select for model)
    expect(mockInput).toHaveBeenCalledTimes(1);
    const written = JSON.parse((mockWriteFileSync.mock.calls[0]![1] as string).trim());
    expect(written.model).toBe("meta-llama/llama-3-70b");
  });

  it("skipping agent customization preserves existing values", async () => {
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
    mockConfirm.mockResolvedValueOnce(false);

    await configCommand();

    const written = JSON.parse((mockWriteFileSync.mock.calls[0]![1] as string).trim());
    // Agent provider/model stay unchanged since we skipped customization
    expect(written.agents[0].provider).toBe("gemini");
    expect(written.agents[0].model).toBe("gemini-2.5-pro");
  });

  it("applies per-agent overrides correctly", async () => {
    mockFindLocalConfigDir.mockReturnValue("/proj/.reygent");
    mockReadFileSync.mockReturnValue(JSON.stringify({
      provider: "claude",
      model: "claude-sonnet-4-5",
      agents: [
        { name: "dev", description: "Dev", systemPrompt: "sp", tools: ["read"], role: "developer" },
        { name: "qe", description: "QE", systemPrompt: "sp2", tools: ["read"], role: "qe" },
      ],
    }));

    // Global
    mockSelect.mockResolvedValueOnce("claude");
    mockSelect.mockResolvedValueOnce("claude-sonnet-4-5");
    // Agent: dev → customize
    mockConfirm.mockResolvedValueOnce(true);
    mockSelect.mockResolvedValueOnce("gemini");
    mockSelect.mockResolvedValueOnce("gemini-2.5-pro");
    // Agent: qe → skip
    mockConfirm.mockResolvedValueOnce(false);

    await configCommand();

    const written = JSON.parse((mockWriteFileSync.mock.calls[0]![1] as string).trim());
    expect(written.agents[0].provider).toBe("gemini");
    expect(written.agents[0].model).toBe("gemini-2.5-pro");
    // qe unchanged
    expect(written.agents[1].provider).toBeUndefined();
    expect(written.agents[1].model).toBeUndefined();
  });

  it("exits 2 on write error", async () => {
    mockFindLocalConfigDir.mockReturnValue("/proj/.reygent");
    mockReadFileSync.mockReturnValue(JSON.stringify({
      provider: "claude",
      model: "claude-sonnet-4-5",
      agents: [],
    }));

    mockSelect.mockResolvedValueOnce("claude");
    mockSelect.mockResolvedValueOnce("claude-sonnet-4-5");

    mockWriteFileSync.mockImplementation(() => {
      throw new Error("EACCES: permission denied");
    });

    await expect(configCommand()).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(2);
  });

  it("exits 0 on Ctrl+C", async () => {
    mockFindLocalConfigDir.mockReturnValue("/proj/.reygent");
    mockReadFileSync.mockReturnValue(JSON.stringify({
      provider: "claude",
      model: "claude-sonnet-4-5",
      agents: [],
    }));

    const exitError = new Error("prompt cancelled");
    (exitError as Error & { name: string }).name = "ExitPromptError";
    mockSelect.mockRejectedValueOnce(exitError);

    await expect(configCommand()).rejects.toThrow("process.exit");
    expect(exitSpy).toHaveBeenCalledWith(0);

    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("cancelled");
  });

  it("uses builtinAgents when rawConfig has no agents array", async () => {
    mockFindLocalConfigDir.mockReturnValue("/proj/.reygent");
    mockReadFileSync.mockReturnValue(JSON.stringify({
      provider: "claude",
      model: "claude-sonnet-4-5",
    }));

    mockSelect.mockResolvedValueOnce("claude");
    mockSelect.mockResolvedValueOnce("claude-sonnet-4-5");
    // builtinAgents mock has 2 agents
    mockConfirm.mockResolvedValueOnce(false);
    mockConfirm.mockResolvedValueOnce(false);

    await configCommand();

    const written = JSON.parse((mockWriteFileSync.mock.calls[0]![1] as string).trim());
    expect(written.agents).toHaveLength(2);
    expect(written.agents[0].name).toBe("dev");
    expect(written.agents[1].name).toBe("qe");
  });
});
