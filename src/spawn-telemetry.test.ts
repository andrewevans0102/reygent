import { describe, it, expect, vi, beforeEach } from "vitest";

const mockIsAvailable = vi.fn();
const mockSpawn = vi.fn();
const mockEmit = vi.fn();

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

vi.mock("./chesstrace/index.js", () => ({
  getChesstrace: vi.fn(() => ({
    emit: mockEmit,
    isEnabled: vi.fn(() => true),
  })),
}));

import { spawnAgentStream } from "./spawn.js";
import { getChesstrace } from "./chesstrace/index.js";

describe("spawn telemetry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsAvailable.mockResolvedValue({ available: true });
    mockSpawn.mockResolvedValue({ stdout: "output", exitCode: 0 });
  });

  describe("agent.spawn event", () => {
    it("emits agent.spawn before adapter.spawn with agent name, provider, model", async () => {
      await spawnAgentStream("dev", "do stuff", 30_000, {
        provider: "claude",
        model: "claude-opus-4-6",
      });

      const spawnCalls = mockEmit.mock.calls.filter(
        (call) => call[0] === "agent.spawn",
      );
      expect(spawnCalls.length).toBe(1);

      const [event, data] = spawnCalls[0];
      expect(event).toBe("agent.spawn");
      expect(data.agent).toBe("dev");
      expect(data.provider).toBe("claude");
      expect(data.model).toBe("claude-opus-4-6");
    });

    it("includes stage when provided in options", async () => {
      await spawnAgentStream("dev", "do stuff", 30_000, {
        provider: "claude",
        model: "claude-opus-4-6",
        stage: "implement",
      });

      const spawnCalls = mockEmit.mock.calls.filter(
        (call) => call[0] === "agent.spawn",
      );
      const [_event, data] = spawnCalls[0];
      expect(data.stage).toBe("implement");
    });

    it("emits before adapter.spawn called", async () => {
      const callOrder: string[] = [];

      mockEmit.mockImplementation((event: string) => {
        if (event === "agent.spawn") {
          callOrder.push("emit:agent.spawn");
        }
      });

      mockSpawn.mockImplementation(async () => {
        callOrder.push("adapter.spawn");
        return { stdout: "output", exitCode: 0 };
      });

      await spawnAgentStream("dev", "do stuff", 30_000);

      expect(callOrder).toEqual(["emit:agent.spawn", "adapter.spawn"]);
    });

    it("uses resolved provider when not specified in options", async () => {
      await spawnAgentStream("dev", "do stuff", 30_000);

      const spawnCalls = mockEmit.mock.calls.filter(
        (call) => call[0] === "agent.spawn",
      );
      const [_event, data] = spawnCalls[0];
      expect(data.provider).toBe("claude");
    });

    it("uses resolved model when not specified in options", async () => {
      await spawnAgentStream("dev", "do stuff", 30_000);

      const spawnCalls = mockEmit.mock.calls.filter(
        (call) => call[0] === "agent.spawn",
      );
      const [_event, data] = spawnCalls[0];
      expect(data.model).toBe("default-model-id");
    });
  });

  describe("agent.complete event", () => {
    it("emits agent.complete after spawn returns with exit code and success", async () => {
      mockSpawn.mockResolvedValue({ stdout: "done", exitCode: 0 });

      await spawnAgentStream("dev", "do stuff", 30_000);

      const completeCalls = mockEmit.mock.calls.filter(
        (call) => call[0] === "agent.complete",
      );
      expect(completeCalls.length).toBe(1);

      const [event, data] = completeCalls[0];
      expect(event).toBe("agent.complete");
      expect(data.agent).toBe("dev");
      expect(data.exitCode).toBe(0);
      expect(data.success).toBe(true);
    });

    it("includes duration in milliseconds", async () => {
      const startTime = Date.now();
      mockSpawn.mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 100));
        return { stdout: "done", exitCode: 0 };
      });

      await spawnAgentStream("dev", "do stuff", 30_000);

      const completeCalls = mockEmit.mock.calls.filter(
        (call) => call[0] === "agent.complete",
      );
      const [_event, data] = completeCalls[0];

      expect(data.duration).toBeGreaterThanOrEqual(100);
      expect(data.duration).toBeLessThan(Date.now() - startTime + 50);
    });

    it("marks success=false when exit code non-zero", async () => {
      mockSpawn.mockResolvedValue({ stdout: "error", exitCode: 1 });

      await spawnAgentStream("dev", "do stuff", 30_000);

      const completeCalls = mockEmit.mock.calls.filter(
        (call) => call[0] === "agent.complete",
      );
      const [_event, data] = completeCalls[0];
      expect(data.exitCode).toBe(1);
      expect(data.success).toBe(false);
    });

    it("includes stage when provided", async () => {
      mockSpawn.mockResolvedValue({ stdout: "done", exitCode: 0 });

      await spawnAgentStream("dev", "do stuff", 30_000, {
        stage: "implement",
      });

      const completeCalls = mockEmit.mock.calls.filter(
        (call) => call[0] === "agent.complete",
      );
      const [_event, data] = completeCalls[0];
      expect(data.stage).toBe("implement");
    });

    it("emits after adapter.spawn returns", async () => {
      const callOrder: string[] = [];

      mockSpawn.mockImplementation(async () => {
        callOrder.push("adapter.spawn");
        return { stdout: "output", exitCode: 0 };
      });

      mockEmit.mockImplementation((event: string) => {
        if (event === "agent.complete") {
          callOrder.push("emit:agent.complete");
        }
      });

      await spawnAgentStream("dev", "do stuff", 30_000);

      expect(callOrder[callOrder.length - 1]).toBe("emit:agent.complete");
    });
  });

  describe("agent.timeout event", () => {
    it("emits agent.timeout when spawn exceeds timeout threshold", async () => {
      const TIMEOUT_MS = 100;

      mockSpawn.mockImplementation(
        () =>
          new Promise((_resolve, reject) => {
            setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS + 50);
          }),
      );

      await expect(
        spawnAgentStream("dev", "do stuff", TIMEOUT_MS),
      ).rejects.toThrow();

      const timeoutCalls = mockEmit.mock.calls.filter(
        (call) => call[0] === "agent.timeout",
      );

      if (timeoutCalls.length > 0) {
        const [event, data] = timeoutCalls[0];
        expect(event).toBe("agent.timeout");
        expect(data.agent).toBe("dev");
      }
    });

    it("includes stage when provided", async () => {
      const TIMEOUT_MS = 100;

      mockSpawn.mockImplementation(
        () =>
          new Promise((_resolve, reject) => {
            setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS + 50);
          }),
      );

      await expect(
        spawnAgentStream("dev", "do stuff", TIMEOUT_MS, {
          stage: "implement",
        }),
      ).rejects.toThrow();

      const timeoutCalls = mockEmit.mock.calls.filter(
        (call) => call[0] === "agent.timeout",
      );

      if (timeoutCalls.length > 0) {
        const [_event, data] = timeoutCalls[0];
        expect(data.stage).toBe("implement");
      }
    });

    it("includes agent name in timeout event", async () => {
      const TIMEOUT_MS = 100;

      mockSpawn.mockImplementation(
        () =>
          new Promise((_resolve, reject) => {
            setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS + 50);
          }),
      );

      await expect(
        spawnAgentStream("planner", "plan task", TIMEOUT_MS),
      ).rejects.toThrow();

      const timeoutCalls = mockEmit.mock.calls.filter(
        (call) => call[0] === "agent.timeout",
      );

      if (timeoutCalls.length > 0) {
        const [_event, data] = timeoutCalls[0];
        expect(data.agent).toBe("planner");
      }
    });

    it("does not emit timeout when spawn completes normally", async () => {
      vi.useFakeTimers();

      mockSpawn.mockResolvedValue({ stdout: "done", exitCode: 0 });

      const promise = spawnAgentStream("dev", "do stuff", 30_000);

      // Advance time but not past timeout
      await vi.advanceTimersByTimeAsync(1000);

      await promise;

      // Advance past timeout to verify it was cleared
      await vi.advanceTimersByTimeAsync(30_000);

      const timeoutCalls = mockEmit.mock.calls.filter(
        (call) => call[0] === "agent.timeout",
      );
      expect(timeoutCalls.length).toBe(0);

      vi.useRealTimers();
    });
  });

  describe("event context completeness", () => {
    it("all agent.spawn events include required context fields", async () => {
      await spawnAgentStream("dev", "do stuff", 30_000, {
        provider: "claude",
        model: "claude-opus-4-6",
        stage: "implement",
      });

      const spawnCalls = mockEmit.mock.calls.filter(
        (call) => call[0] === "agent.spawn",
      );
      const [_event, data] = spawnCalls[0];

      expect(data).toHaveProperty("agent");
      expect(data).toHaveProperty("provider");
      expect(data).toHaveProperty("model");
      expect(data).toHaveProperty("stage");
    });

    it("all agent.complete events include required context fields", async () => {
      mockSpawn.mockResolvedValue({ stdout: "done", exitCode: 0 });

      await spawnAgentStream("dev", "do stuff", 30_000, {
        stage: "implement",
      });

      const completeCalls = mockEmit.mock.calls.filter(
        (call) => call[0] === "agent.complete",
      );
      const [_event, data] = completeCalls[0];

      expect(data).toHaveProperty("agent");
      expect(data).toHaveProperty("exitCode");
      expect(data).toHaveProperty("duration");
      expect(data).toHaveProperty("success");
      expect(data).toHaveProperty("stage");
    });
  });


  describe("spawn failure handling", () => {
    it("emits agent.complete even when spawn fails", async () => {
      mockSpawn.mockRejectedValue(new Error("spawn failed"));

      await expect(
        spawnAgentStream("dev", "do stuff", 30_000),
      ).rejects.toThrow("spawn failed");

      const completeCalls = mockEmit.mock.calls.filter(
        (call) => call[0] === "agent.complete",
      );

      if (completeCalls.length > 0) {
        const [_event, data] = completeCalls[0];
        expect(data.success).toBe(false);
      }
    });

    it("does not emit agent.complete when provider unavailable", async () => {
      mockIsAvailable.mockResolvedValue({
        available: false,
        reason: "not installed",
      });

      await expect(
        spawnAgentStream("dev", "do stuff", 30_000),
      ).rejects.toThrow();

      const completeCalls = mockEmit.mock.calls.filter(
        (call) => call[0] === "agent.complete",
      );
      expect(completeCalls.length).toBe(0);
    });
  });
});
