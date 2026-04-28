import { describe, it, expect, vi, beforeEach } from "vitest";

const mockIsAvailable = vi.fn();
const mockSpawn = vi.fn();

vi.mock("./providers/index.js", () => ({
  getProvider: vi.fn(() => ({
    isAvailable: mockIsAvailable,
    spawn: mockSpawn,
  })),
}));

vi.mock("./model.js", () => ({
  resolveModel: vi.fn(() => "default-model-id"),
  resolveProvider: vi.fn(() => "claude"),
}));

const { spawnAgentStream } = await import("./spawn.js");
const { getProvider } = await import("./providers/index.js");
const { resolveModel, resolveProvider } = await import("./model.js");
const { TaskError } = await import("./task.js");

describe("spawnAgentStream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsAvailable.mockResolvedValue({ available: true });
    mockSpawn.mockResolvedValue({ stdout: "output", exitCode: 0 });
  });

  it("uses default provider when none specified", async () => {
    await spawnAgentStream("dev", "do stuff", 30_000);

    expect(resolveProvider).toHaveBeenCalled();
    expect(getProvider).toHaveBeenCalledWith("claude");
  });

  it("uses custom provider from options", async () => {
    await spawnAgentStream("dev", "do stuff", 30_000, {
      provider: "gemini",
    });

    expect(resolveProvider).not.toHaveBeenCalled();
    expect(getProvider).toHaveBeenCalledWith("gemini");
  });

  it("throws TaskError when provider not available", async () => {
    mockIsAvailable.mockResolvedValue({
      available: false,
      reason: "CLI not installed",
    });

    await expect(
      spawnAgentStream("dev", "do stuff", 30_000),
    ).rejects.toThrow(TaskError);

    await expect(
      spawnAgentStream("dev", "do stuff", 30_000),
    ).rejects.toThrow(/not available/);
  });

  it("uses default model when none specified", async () => {
    await spawnAgentStream("dev", "do stuff", 30_000);

    expect(resolveModel).toHaveBeenCalledWith("claude");
    expect(mockSpawn).toHaveBeenCalledWith(
      expect.objectContaining({ model: "default-model-id" }),
    );
  });

  it("uses custom model from options", async () => {
    await spawnAgentStream("dev", "do stuff", 30_000, {
      model: "claude-opus-4-6",
    });

    expect(resolveModel).not.toHaveBeenCalled();
    expect(mockSpawn).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-opus-4-6" }),
    );
  });

  it("passes all options through to adapter.spawn", async () => {
    await spawnAgentStream("dev", "implement feature", 60_000, {
      provider: "gemini",
      model: "gemini-2.5-pro",
      quiet: true,
      autoApprove: true,
      systemPrompt: "You are a coding agent",
    });

    expect(mockSpawn).toHaveBeenCalledWith({
      prompt: "implement feature",
      systemPrompt: "You are a coding agent",
      model: "gemini-2.5-pro",
      autoApprove: true,
      quiet: true,
      timeoutMs: 60_000,
      agentName: "dev",
    });
  });

  it("returns spawn result from adapter", async () => {
    const expected = {
      stdout: "completed successfully",
      exitCode: 0,
      usage: { costUsd: 0.05, durationMs: 1200 },
    };
    mockSpawn.mockResolvedValue(expected);

    const result = await spawnAgentStream("dev", "do stuff", 30_000);

    expect(result).toEqual(expected);
  });
});
