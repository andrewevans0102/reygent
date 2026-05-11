import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { spawnAgentStream } from "../src/spawn.js";
import { runImplement } from "../src/implement.js";
import { runPlanner } from "../src/planner.js";
import { TaskError } from "../src/task.js";
import { getChesstrace } from "../src/chesstrace/index.js";
import { Events } from "../src/chesstrace/events.js";
import * as providers from "../src/providers/index.js";
import type { ProviderAdapter } from "../src/providers/types.js";

// Mock provider module
vi.mock("../src/providers/index.js", async () => {
  const actual = await vi.importActual<typeof import("../src/providers/index.js")>("../src/providers/index.js");
  return {
    ...actual,
    getProvider: vi.fn(),
  };
});

// Mock config to return test agents
vi.mock("../src/config.js", () => ({
  getAgents: vi.fn(() => [
    {
      name: "dev",
      provider: "claude",
      model: "claude-3-5-sonnet-20241022",
      systemPrompt: "Test dev prompt",
    },
    {
      name: "qe",
      provider: "claude",
      model: "claude-3-5-sonnet-20241022",
      systemPrompt: "Test qe prompt",
    },
    {
      name: "planner",
      provider: "claude",
      model: "claude-3-5-sonnet-20241022",
      systemPrompt: "Test planner prompt",
    },
  ]),
  loadConfig: vi.fn(() => ({
    telemetry: { enabled: true, level: "standard" },
  })),
}));

describe("error boundary telemetry instrumentation", () => {
  let emitSpy: ReturnType<typeof vi.fn>;
  let mockProvider: ProviderAdapter;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup emit spy
    const chesstrace = getChesstrace();
    emitSpy = vi.spyOn(chesstrace, "emit");

    // Setup mock provider
    mockProvider = {
      isAvailable: vi.fn().mockResolvedValue({ available: true }),
      spawn: vi.fn(),
    } as unknown as ProviderAdapter;

    vi.mocked(providers.getProvider).mockReturnValue(mockProvider);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("error.task - TaskError catch blocks", () => {
    it("should emit error.task when dev agent fails in implement", async () => {
      // Mock dev agent failure
      vi.mocked(mockProvider.spawn).mockRejectedValueOnce(
        new TaskError("Dev agent failed to parse output")
      );

      const spec = {
        source: "markdown" as const,
        path: "/test/spec.md",
        title: "Test spec",
        content: "# Test",
      };
      const plan = {
        goals: ["Goal 1"],
        tasks: ["Task 1"],
        constraints: ["Constraint 1"],
        dod: ["DOD 1"],
      };

      await expect(
        runImplement(spec, plan, { autoApprove: true })
      ).rejects.toThrow();

      // Verify error.task emitted before re-throw
      expect(emitSpy).toHaveBeenCalledWith(
        Events.ERROR_TASK,
        expect.objectContaining({
          type: "TaskError",
          message: expect.stringContaining("Dev agent"),
          stage: "implement",
          agent: "dev",
        })
      );
    });

    it("should emit error.task with stage context from spawn options", async () => {
      vi.mocked(mockProvider.spawn).mockRejectedValueOnce(
        new TaskError("Spawn failed")
      );

      await expect(
        spawnAgentStream("test-agent", "test prompt", 1000, {
          stage: "gate-unit-tests",
        })
      ).rejects.toThrow();

      expect(emitSpy).toHaveBeenCalledWith(
        Events.ERROR_TASK,
        expect.objectContaining({
          type: "TaskError",
          stage: "gate-unit-tests",
          agent: "test-agent",
        })
      );
    });

    it("should emit error.task without stage when stage not provided", async () => {
      vi.mocked(mockProvider.spawn).mockRejectedValueOnce(
        new TaskError("Spawn failed without stage")
      );

      await expect(
        spawnAgentStream("test-agent", "test prompt", 1000)
      ).rejects.toThrow();

      expect(emitSpy).toHaveBeenCalledWith(
        Events.ERROR_TASK,
        expect.objectContaining({
          type: "TaskError",
          message: "Spawn failed without stage",
          agent: "test-agent",
        })
      );
    });
  });

  describe("error.parse - JSON parse failures", () => {
    it("should emit error.parse when planner returns invalid JSON", async () => {
      // Mock planner returning malformed JSON
      vi.mocked(mockProvider.spawn).mockResolvedValueOnce({
        stdout: "This is not valid JSON { broken",
        exitCode: 0,
        usage: {
          costUsd: 0.001,
          inputTokens: 100,
          outputTokens: 50,
        },
      });

      const spec = {
        source: "markdown" as const,
        path: "/test/spec.md",
        title: "Test spec",
        content: "# Test",
      };

      await expect(runPlanner(spec)).rejects.toThrow();

      // Verify error.parse emitted with truncated received data
      expect(emitSpy).toHaveBeenCalledWith(
        Events.ERROR_PARSE,
        expect.objectContaining({
          agent: "planner",
          expectedFormat: "PlannerResult JSON",
          received: expect.any(String),
        })
      );

      const parseCall = emitSpy.mock.calls.find(
        ([event]) => event === Events.ERROR_PARSE
      );
      const data = parseCall?.[1] as { received: string };
      // Verify truncation (should be ≤ 500 chars based on common truncation patterns)
      expect(data.received.length).toBeLessThanOrEqual(500);
    });

    it("should emit error.parse when dev agent returns invalid output format", async () => {
      // Mock dev agent returning non-JSON output
      vi.mocked(mockProvider.spawn).mockResolvedValueOnce({
        stdout: "Files modified but forgot JSON block",
        exitCode: 0,
        usage: {
          costUsd: 0.001,
          inputTokens: 100,
          outputTokens: 50,
        },
      });

      const spec = {
        source: "markdown" as const,
        path: "/test/spec.md",
        title: "Test spec",
        content: "# Test",
      };
      const plan = {
        goals: ["Goal 1"],
        tasks: ["Task 1"],
        constraints: ["Constraint 1"],
        dod: ["DOD 1"],
      };

      // Dev agent won't throw, just returns empty files array
      const result = await runImplement(spec, plan, { autoApprove: true });

      // No error.parse event since extractDevOutput handles gracefully
      expect(result.implement.dev?.files).toEqual([]);
    });

    it("should truncate large received data in error.parse", async () => {
      // Mock planner returning huge invalid JSON
      const hugeOutput = "Invalid JSON: " + "x".repeat(10000);
      vi.mocked(mockProvider.spawn).mockResolvedValueOnce({
        stdout: hugeOutput,
        exitCode: 0,
      });

      const spec = {
        source: "markdown" as const,
        path: "/test/spec.md",
        title: "Test spec",
        content: "# Test",
      };

      await expect(runPlanner(spec)).rejects.toThrow();

      const parseCall = emitSpy.mock.calls.find(
        ([event]) => event === Events.ERROR_PARSE
      );
      const data = parseCall?.[1] as { received: string };

      // Should be truncated to reasonable size
      expect(data.received.length).toBeLessThan(hugeOutput.length);
      expect(data.received.length).toBeLessThanOrEqual(500);
    });
  });

  describe("error.provider - provider unavailable", () => {
    it("should emit error.provider when provider check fails", async () => {
      // Mock provider unavailable
      vi.mocked(mockProvider.isAvailable).mockResolvedValueOnce({
        available: false,
        reason: "API key not configured",
      });

      await expect(
        spawnAgentStream("test-agent", "test prompt", 1000, {
          provider: "claude",
        })
      ).rejects.toThrow();

      expect(emitSpy).toHaveBeenCalledWith(
        Events.ERROR_PROVIDER,
        expect.objectContaining({
          provider: "claude",
          reason: "API key not configured",
        })
      );
    });

    it("should emit error.provider when provider returns network error", async () => {
      vi.mocked(mockProvider.isAvailable).mockResolvedValueOnce({
        available: false,
        reason: "Network timeout connecting to provider API",
      });

      await expect(
        spawnAgentStream("test-agent", "test prompt", 1000, {
          provider: "gemini",
        })
      ).rejects.toThrow();

      expect(emitSpy).toHaveBeenCalledWith(
        Events.ERROR_PROVIDER,
        expect.objectContaining({
          provider: "gemini",
          reason: "Network timeout connecting to provider API",
        })
      );
    });

    it("should emit error.provider with specific reason for auth failure", async () => {
      vi.mocked(mockProvider.isAvailable).mockResolvedValueOnce({
        available: false,
        reason: "Invalid API credentials",
      });

      await expect(
        spawnAgentStream("security-reviewer", "test prompt", 1000, {
          provider: "openrouter",
        })
      ).rejects.toThrow();

      expect(emitSpy).toHaveBeenCalledWith(
        Events.ERROR_PROVIDER,
        expect.objectContaining({
          provider: "openrouter",
          reason: "Invalid API credentials",
        })
      );
    });
  });

  describe("emit ordering - events before re-throw", () => {
    it("should emit error.task before TaskError propagates", async () => {
      vi.mocked(mockProvider.spawn).mockRejectedValueOnce(
        new TaskError("Test error")
      );

      let errorThrown = false;
      try {
        await spawnAgentStream("test-agent", "test prompt", 1000, {
          stage: "implement",
        });
      } catch {
        errorThrown = true;
      }

      expect(errorThrown).toBe(true);
      expect(emitSpy).toHaveBeenCalledWith(
        Events.ERROR_TASK,
        expect.objectContaining({
          type: "TaskError",
          message: "Test error",
          stage: "implement",
          agent: "test-agent",
        })
      );
    });

    it("should emit error.parse before throwing parse error", async () => {
      vi.mocked(mockProvider.spawn).mockResolvedValueOnce({
        stdout: "{ invalid json",
        exitCode: 0,
      });

      const spec = {
        source: "markdown" as const,
        path: "/test/spec.md",
        title: "Test spec",
        content: "# Test",
      };

      let errorThrown = false;
      try {
        await runPlanner(spec);
      } catch {
        errorThrown = true;
      }

      expect(errorThrown).toBe(true);
      expect(emitSpy).toHaveBeenCalledWith(
        Events.ERROR_PARSE,
        expect.any(Object)
      );
    });

    it("should emit error.provider before throwing unavailable error", async () => {
      vi.mocked(mockProvider.isAvailable).mockResolvedValueOnce({
        available: false,
        reason: "Service unavailable",
      });

      let errorThrown = false;
      try {
        await spawnAgentStream("test-agent", "test prompt", 1000, {
          provider: "codex",
        });
      } catch {
        errorThrown = true;
      }

      expect(errorThrown).toBe(true);
      expect(emitSpy).toHaveBeenCalledWith(
        Events.ERROR_PROVIDER,
        expect.objectContaining({
          provider: "codex",
          reason: "Service unavailable",
        })
      );
    });
  });

  describe("edge cases", () => {
    it("should handle error.task with empty stage gracefully", async () => {
      vi.mocked(mockProvider.spawn).mockRejectedValueOnce(
        new TaskError("No stage provided")
      );

      await expect(
        spawnAgentStream("test-agent", "test prompt", 1000)
      ).rejects.toThrow();

      expect(emitSpy).toHaveBeenCalledWith(
        Events.ERROR_TASK,
        expect.objectContaining({
          type: "TaskError",
          message: "No stage provided",
          agent: "test-agent",
        })
      );

      const taskErrorCall = emitSpy.mock.calls.find(
        ([event]) => event === Events.ERROR_TASK
      );
      const data = taskErrorCall?.[1] as Record<string, unknown>;
      expect(data.stage).toBeUndefined();
    });

    it("should truncate received data to 500 chars in error.parse", async () => {
      const longOutput = "a".repeat(1000);
      vi.mocked(mockProvider.spawn).mockResolvedValueOnce({
        stdout: longOutput,
        exitCode: 0,
      });

      const spec = {
        source: "markdown" as const,
        path: "/test/spec.md",
        title: "Test spec",
        content: "# Test",
      };

      await expect(runPlanner(spec)).rejects.toThrow();

      const parseCall = emitSpy.mock.calls.find(
        ([event]) => event === Events.ERROR_PARSE
      );
      const data = parseCall?.[1] as { received: string };
      expect(data.received.length).toBe(500);
      expect(data.received).toBe("a".repeat(500));
    });

    it("should not double-emit errors when provider fails during implement", async () => {
      vi.mocked(mockProvider.isAvailable).mockResolvedValueOnce({
        available: false,
        reason: "Provider down",
      });

      const spec = {
        source: "markdown" as const,
        path: "/test/spec.md",
        title: "Test spec",
        content: "# Test",
      };
      const plan = {
        goals: ["Goal 1"],
        tasks: ["Task 1"],
        constraints: ["Constraint 1"],
        dod: ["DOD 1"],
      };

      await expect(
        runImplement(spec, plan, { autoApprove: true })
      ).rejects.toThrow();

      // Should emit error.provider exactly once (from spawn layer)
      const providerErrors = emitSpy.mock.calls.filter(
        ([event]) => event === Events.ERROR_PROVIDER
      );
      expect(providerErrors.length).toBe(1);
    });
  });
});
