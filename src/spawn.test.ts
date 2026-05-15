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

import { spawnAgentStream, formatExitDetail } from "./spawn.js";
import { getProvider } from "./providers/index.js";
import { resolveModel, resolveProvider } from "./model.js";
import { TaskError } from "./task.js";
import type { SpawnResult } from "./spawn.js";

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

    const call = mockSpawn.mock.calls[0][0];
    expect(call.prompt).toBe("implement feature");
    expect(call.model).toBe("gemini-2.5-pro");
    expect(call.autoApprove).toBe(true);
    expect(call.quiet).toBe(true);
    expect(call.timeoutMs).toBe(60_000);
    expect(call.agentName).toBe("dev");
    // Knowledge may be appended to systemPrompt
    expect(call.systemPrompt).toContain("You are a coding agent");
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

describe("formatExitDetail", () => {
  it("returns errorMessage with HTTP status when both present", () => {
    const result: SpawnResult = {
      stdout: "ignored output",
      exitCode: 1,
      errorMessage: "Authentication failed",
      apiErrorStatus: 401,
    };

    const detail = formatExitDetail(result);

    expect(detail).toBe("\n  Authentication failed (HTTP 401)");
  });

  it("returns errorMessage without HTTP status when status missing", () => {
    const result: SpawnResult = {
      stdout: "ignored output",
      exitCode: 1,
      errorMessage: "API rate limit exceeded",
    };

    const detail = formatExitDetail(result);

    expect(detail).toBe("\n  API rate limit exceeded");
  });

  it("includes model selection tip for 404 with 'not available' message", () => {
    const result: SpawnResult = {
      stdout: "",
      exitCode: 1,
      errorMessage: "Model is not available in your region",
      apiErrorStatus: 404,
    };

    const detail = formatExitDetail(result);

    expect(detail).toContain("Model is not available in your region (HTTP 404)");
    expect(detail).toContain("Tip: edit .reygent/config.json");
    expect(detail).toContain("or run `reygent config`");
  });

  it("does not include tip for 404 without 'not available' keyword", () => {
    const result: SpawnResult = {
      stdout: "",
      exitCode: 1,
      errorMessage: "Resource missing",
      apiErrorStatus: 404,
    };

    const detail = formatExitDetail(result);

    expect(detail).toBe("\n  Resource missing (HTTP 404)");
    expect(detail).not.toContain("Tip:");
  });

  it("falls back to stdout when errorMessage missing", () => {
    const result: SpawnResult = {
      stdout: "Task failed: invalid input",
      exitCode: 1,
    };

    const detail = formatExitDetail(result);

    expect(detail).toBe("\n  Task failed: invalid input");
  });

  it("truncates stdout to 500 chars when no errorMessage", () => {
    const longOutput = "x".repeat(600);
    const result: SpawnResult = {
      stdout: longOutput,
      exitCode: 1,
    };

    const detail = formatExitDetail(result);

    expect(detail).toBe(`\n  ${"x".repeat(500)}`);
    expect(detail.length).toBe(503); // \n + 2 spaces + 500 chars
  });

  it("returns empty string when stdout empty and no errorMessage", () => {
    const result: SpawnResult = {
      stdout: "",
      exitCode: 1,
    };

    const detail = formatExitDetail(result);

    expect(detail).toBe("");
  });

  it("trims whitespace from stdout before checking empty", () => {
    const result: SpawnResult = {
      stdout: "   \n\t   ",
      exitCode: 1,
    };

    const detail = formatExitDetail(result);

    expect(detail).toBe("");
  });
});
