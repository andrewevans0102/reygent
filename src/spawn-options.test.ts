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

import { spawnAgentStream } from "./spawn.js";
import type { SpawnOptions } from "./spawn.js";

describe("SpawnOptions interface", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsAvailable.mockResolvedValue({ available: true });
    mockSpawn.mockResolvedValue({ stdout: "output", exitCode: 0 });
  });

  describe("stage field", () => {
    it("accepts stage field in options", async () => {
      const options: SpawnOptions = {
        stage: "implement",
        autoApprove: true,
      };

      await spawnAgentStream("dev", "do stuff", 30_000, options);

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.objectContaining({
          agentName: "dev",
          prompt: "do stuff",
          autoApprove: true,
        }),
      );
    });

    it("stage field is optional", async () => {
      const options: SpawnOptions = {
        autoApprove: true,
      };

      await spawnAgentStream("dev", "do stuff", 30_000, options);

      expect(mockSpawn).toHaveBeenCalled();
    });

    it("accepts different stage values", async () => {
      const stages = ["plan", "implement", "verify", "review"];

      for (const stage of stages) {
        vi.clearAllMocks();

        const options: SpawnOptions = {
          stage,
        };

        await spawnAgentStream("dev", "do stuff", 30_000, options);

        expect(mockSpawn).toHaveBeenCalled();
      }
    });

    it("works with all other options combined", async () => {
      const options: SpawnOptions = {
        stage: "implement",
        quiet: true,
        autoApprove: true,
        provider: "claude",
        model: "claude-opus-4-6",
        systemPrompt: "You are a dev agent",
        onActivity: vi.fn(),
      };

      await spawnAgentStream("dev", "do stuff", 30_000, options);

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.objectContaining({
          agentName: "dev",
          prompt: "do stuff",
          quiet: true,
          autoApprove: true,
          model: "claude-opus-4-6",
          systemPrompt: "You are a dev agent",
        }),
      );
    });
  });

  describe("existing options still work", () => {
    it("quiet option", async () => {
      const options: SpawnOptions = {
        quiet: true,
      };

      await spawnAgentStream("dev", "do stuff", 30_000, options);

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.objectContaining({
          quiet: true,
        }),
      );
    });

    it("autoApprove option", async () => {
      const options: SpawnOptions = {
        autoApprove: true,
      };

      await spawnAgentStream("dev", "do stuff", 30_000, options);

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.objectContaining({
          autoApprove: true,
        }),
      );
    });

    it("provider option", async () => {
      const options: SpawnOptions = {
        provider: "gemini",
      };

      await spawnAgentStream("dev", "do stuff", 30_000, options);

      expect(mockSpawn).toHaveBeenCalled();
    });

    it("model option", async () => {
      const options: SpawnOptions = {
        model: "claude-opus-4-6",
      };

      await spawnAgentStream("dev", "do stuff", 30_000, options);

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "claude-opus-4-6",
        }),
      );
    });

    it("systemPrompt option", async () => {
      const options: SpawnOptions = {
        systemPrompt: "You are a coding agent",
      };

      await spawnAgentStream("dev", "do stuff", 30_000, options);

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.objectContaining({
          systemPrompt: "You are a coding agent",
        }),
      );
    });

    it("onActivity callback option", async () => {
      const onActivity = vi.fn();
      const options: SpawnOptions = {
        onActivity,
      };

      await spawnAgentStream("dev", "do stuff", 30_000, options);

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.objectContaining({
          onActivity,
        }),
      );
    });
  });

  describe("type safety", () => {
    it("type checks with only stage", () => {
      const options: SpawnOptions = {
        stage: "implement",
      };

      expect(options.stage).toBe("implement");
    });

    it("type checks with stage and other fields", () => {
      const options: SpawnOptions = {
        stage: "plan",
        quiet: true,
        autoApprove: false,
      };

      expect(options.stage).toBe("plan");
      expect(options.quiet).toBe(true);
      expect(options.autoApprove).toBe(false);
    });

    it("accepts undefined stage", () => {
      const options: SpawnOptions = {
        stage: undefined,
        quiet: true,
      };

      expect(options.stage).toBeUndefined();
    });
  });
});
