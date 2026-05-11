import { describe, it, expect, vi, beforeEach } from "vitest";

const mockEmit = vi.fn();
const mockIsEnabled = vi.fn();

vi.mock("./chesstrace/index.js", () => ({
  getChesstrace: vi.fn(() => ({
    emit: mockEmit,
    isEnabled: mockIsEnabled,
  })),
}));

import { UsageTracker } from "./usage.js";
import { getChesstrace } from "./chesstrace/index.js";
import type { UsageInfo } from "./usage.js";

describe("UsageTracker telemetry", () => {
  let tracker: UsageTracker;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsEnabled.mockReturnValue(true);
    tracker = new UsageTracker();
  });

  describe("usage.tokens event", () => {
    it("emits usage.tokens with all token fields on record", () => {
      const usage: UsageInfo = {
        inputTokens: 1000,
        outputTokens: 500,
        cachedTokens: 200,
        cacheWriteTokens: 100,
        provider: "claude",
      };

      tracker.record("dev", "implement", usage);

      const tokenCalls = mockEmit.mock.calls.filter(
        (call) => call[0] === "usage.tokens",
      );
      expect(tokenCalls.length).toBe(1);

      const [event, data] = tokenCalls[0];
      expect(event).toBe("usage.tokens");
      expect(data).toEqual({
        agent: "dev",
        stage: "implement",
        inputTokens: 1000,
        outputTokens: 500,
        cachedTokens: 200,
        cacheWriteTokens: 100,
        provider: "claude",
      });
    });

    it("includes zeros when token fields absent", () => {
      const usage: UsageInfo = {
        costUsd: 0.05,
        provider: "gemini",
      };

      tracker.record("planner", "plan", usage);

      const tokenCalls = mockEmit.mock.calls.filter(
        (call) => call[0] === "usage.tokens",
      );
      const [_event, data] = tokenCalls[0];

      expect(data.inputTokens).toBe(0);
      expect(data.outputTokens).toBe(0);
      expect(data.cachedTokens).toBe(0);
      expect(data.cacheWriteTokens).toBe(0);
    });

    it("handles missing provider field", () => {
      const usage: UsageInfo = {
        inputTokens: 1000,
        outputTokens: 500,
      };

      tracker.record("dev", "test", usage);

      const tokenCalls = mockEmit.mock.calls.filter(
        (call) => call[0] === "usage.tokens",
      );
      const [_event, data] = tokenCalls[0];

      expect(data.provider).toBeUndefined();
    });

    it("emits usage.tokens for multiple record calls", () => {
      tracker.record("dev", "implement", {
        inputTokens: 1000,
        outputTokens: 500,
        provider: "claude",
      });

      tracker.record("qe", "test", {
        inputTokens: 500,
        outputTokens: 250,
        provider: "codex",
      });

      const tokenCalls = mockEmit.mock.calls.filter(
        (call) => call[0] === "usage.tokens",
      );
      expect(tokenCalls.length).toBe(2);

      expect(tokenCalls[0][1].agent).toBe("dev");
      expect(tokenCalls[1][1].agent).toBe("qe");
    });
  });

  describe("usage.cost event", () => {
    it("emits usage.cost with cost and savings on record", () => {
      const usage: UsageInfo = {
        costUsd: 0.05,
        cachedTokens: 10_000,
        provider: "claude",
      };

      tracker.record("dev", "implement", usage);

      const costCalls = mockEmit.mock.calls.filter(
        (call) => call[0] === "usage.cost",
      );
      expect(costCalls.length).toBe(1);

      const [event, data] = costCalls[0];
      expect(event).toBe("usage.cost");
      expect(data.agent).toBe("dev");
      expect(data.stage).toBe("implement");
      expect(data.costUsd).toBe(0.05);
      expect(data.cacheSavingsUsd).toBeGreaterThan(0);
    });

    it("calculates cacheSavingsUsd correctly for claude provider", () => {
      const usage: UsageInfo = {
        costUsd: 0.05,
        cachedTokens: 100_000,
        provider: "claude",
      };

      tracker.record("dev", "implement", usage);

      const costCalls = mockEmit.mock.calls.filter(
        (call) => call[0] === "usage.cost",
      );
      const [_event, data] = costCalls[0];

      // Claude: 100k cached tokens * $3.00/million * 0.90 discount = $0.27
      expect(data.cacheSavingsUsd).toBeCloseTo(0.27, 2);
    });

    it("calculates cacheSavingsUsd for codex provider", () => {
      const usage: UsageInfo = {
        costUsd: 0.03,
        cachedTokens: 100_000,
        provider: "codex",
      };

      tracker.record("planner", "plan", usage);

      const costCalls = mockEmit.mock.calls.filter(
        (call) => call[0] === "usage.cost",
      );
      const [_event, data] = costCalls[0];

      // Codex: 100k cached tokens * $1.25/million * 0.90 discount = $0.1125
      expect(data.cacheSavingsUsd).toBeCloseTo(0.1125, 4);
    });

    it("uses cacheDiscount when cachedTokens absent", () => {
      const usage: UsageInfo = {
        costUsd: 0.05,
        cacheDiscount: 0.15,
        provider: "openrouter",
      };

      tracker.record("dev", "implement", usage);

      const costCalls = mockEmit.mock.calls.filter(
        (call) => call[0] === "usage.cost",
      );
      const [_event, data] = costCalls[0];

      expect(data.cacheSavingsUsd).toBe(0.15);
    });

    it("returns zero cacheSavingsUsd when no cache data", () => {
      const usage: UsageInfo = {
        costUsd: 0.05,
        provider: "claude",
      };

      tracker.record("dev", "implement", usage);

      const costCalls = mockEmit.mock.calls.filter(
        (call) => call[0] === "usage.cost",
      );
      const [_event, data] = costCalls[0];

      expect(data.cacheSavingsUsd).toBe(0);
    });

    it("handles missing provider with default pricing", () => {
      const usage: UsageInfo = {
        costUsd: 0.05,
        cachedTokens: 100_000,
      };

      tracker.record("dev", "implement", usage);

      const costCalls = mockEmit.mock.calls.filter(
        (call) => call[0] === "usage.cost",
      );
      const [_event, data] = costCalls[0];

      // Defaults to claude pricing
      expect(data.cacheSavingsUsd).toBeGreaterThan(0);
    });

    it("handles zero cost", () => {
      const usage: UsageInfo = {
        costUsd: 0,
        provider: "claude",
      };

      tracker.record("dev", "implement", usage);

      const costCalls = mockEmit.mock.calls.filter(
        (call) => call[0] === "usage.cost",
      );
      const [_event, data] = costCalls[0];

      expect(data.costUsd).toBe(0);
    });

    it("handles missing costUsd", () => {
      const usage: UsageInfo = {
        inputTokens: 1000,
        provider: "claude",
      };

      tracker.record("dev", "implement", usage);

      const costCalls = mockEmit.mock.calls.filter(
        (call) => call[0] === "usage.cost",
      );
      const [_event, data] = costCalls[0];

      expect(data.costUsd).toBeUndefined();
    });

    it("emits usage.cost for multiple record calls", () => {
      tracker.record("dev", "implement", {
        costUsd: 0.05,
        provider: "claude",
      });

      tracker.record("qe", "test", {
        costUsd: 0.02,
        provider: "codex",
      });

      const costCalls = mockEmit.mock.calls.filter(
        (call) => call[0] === "usage.cost",
      );
      expect(costCalls.length).toBe(2);

      expect(costCalls[0][1].costUsd).toBe(0.05);
      expect(costCalls[1][1].costUsd).toBe(0.02);
    });
  });

  describe("event emission order", () => {
    it("emits both usage.tokens and usage.cost in single record call", () => {
      const usage: UsageInfo = {
        inputTokens: 1000,
        outputTokens: 500,
        costUsd: 0.05,
        provider: "claude",
      };

      tracker.record("dev", "implement", usage);

      expect(mockEmit).toHaveBeenCalledTimes(2);

      const events = mockEmit.mock.calls.map((call) => call[0]);
      expect(events).toContain("usage.tokens");
      expect(events).toContain("usage.cost");
    });

    it("emits events after existing record logic", () => {
      const usage: UsageInfo = {
        inputTokens: 1000,
        costUsd: 0.05,
        provider: "claude",
      };

      tracker.record("dev", "implement", usage);

      // Verify tracking still works
      expect(tracker.getTotalCost()).toBe(0.05);
      expect(tracker.getEntries()).toHaveLength(1);

      // Verify events emitted
      expect(mockEmit).toHaveBeenCalled();
    });
  });

  describe("telemetry opt-out", () => {
    it("does not emit events when telemetry disabled", () => {
      mockIsEnabled.mockReturnValue(false);

      const usage: UsageInfo = {
        inputTokens: 1000,
        outputTokens: 500,
        costUsd: 0.05,
        provider: "claude",
      };

      tracker.record("dev", "implement", usage);

      expect(mockEmit).not.toHaveBeenCalled();
    });

    it("checks isEnabled before each emit", () => {
      const usage: UsageInfo = {
        inputTokens: 1000,
        costUsd: 0.05,
        provider: "claude",
      };

      tracker.record("dev", "implement", usage);

      expect(mockIsEnabled).toHaveBeenCalled();
    });

    it("getChesstrace returns null when not initialized", () => {
      vi.mocked(getChesstrace).mockReturnValue(null as any);

      const usage: UsageInfo = {
        inputTokens: 1000,
        costUsd: 0.05,
        provider: "claude",
      };

      // Should not throw
      expect(() => tracker.record("dev", "implement", usage)).not.toThrow();
    });
  });

  describe("edge cases", () => {
    it("handles empty usage object", () => {
      const usage: UsageInfo = {};

      tracker.record("dev", "implement", usage);

      const tokenCalls = mockEmit.mock.calls.filter(
        (call) => call[0] === "usage.tokens",
      );
      const costCalls = mockEmit.mock.calls.filter(
        (call) => call[0] === "usage.cost",
      );

      expect(tokenCalls.length).toBe(1);
      expect(costCalls.length).toBe(1);
    });

    it("handles very large token counts", () => {
      const usage: UsageInfo = {
        inputTokens: 10_000_000,
        outputTokens: 5_000_000,
        cachedTokens: 1_000_000,
        provider: "claude",
      };

      tracker.record("dev", "implement", usage);

      const tokenCalls = mockEmit.mock.calls.filter(
        (call) => call[0] === "usage.tokens",
      );
      const [_event, data] = tokenCalls[0];

      expect(data.inputTokens).toBe(10_000_000);
      expect(data.outputTokens).toBe(5_000_000);
    });

    it("handles negative values gracefully", () => {
      const usage: UsageInfo = {
        inputTokens: -100,
        costUsd: -0.01,
        provider: "claude",
      };

      // Should not throw
      expect(() => tracker.record("dev", "implement", usage)).not.toThrow();
    });

    it("preserves existing functionality with all fields", () => {
      const usage: UsageInfo = {
        costUsd: 0.05,
        durationMs: 1500,
        numTurns: 3,
        inputTokens: 1000,
        outputTokens: 500,
        cachedTokens: 200,
        cacheWriteTokens: 100,
        cacheDiscount: 0.10,
        provider: "claude",
      };

      tracker.record("dev", "implement", usage);

      // Verify all data preserved
      const entries = tracker.getEntries();
      expect(entries[0].usage).toEqual(usage);
    });
  });

  describe("different agent and stage combinations", () => {
    it("emits events for various agent names", () => {
      const agents = ["dev", "planner", "qe", "security-reviewer"];

      agents.forEach((agent) => {
        tracker.record(agent, "stage", {
          inputTokens: 100,
          costUsd: 0.01,
          provider: "claude",
        });
      });

      const tokenCalls = mockEmit.mock.calls.filter(
        (call) => call[0] === "usage.tokens",
      );

      expect(tokenCalls.length).toBe(4);
      agents.forEach((agent, i) => {
        expect(tokenCalls[i][1].agent).toBe(agent);
      });
    });

    it("emits events for various stage names", () => {
      const stages = ["plan", "implement", "test", "review"];

      stages.forEach((stage) => {
        tracker.record("dev", stage, {
          inputTokens: 100,
          costUsd: 0.01,
          provider: "claude",
        });
      });

      const costCalls = mockEmit.mock.calls.filter(
        (call) => call[0] === "usage.cost",
      );

      expect(costCalls.length).toBe(4);
      stages.forEach((stage, i) => {
        expect(costCalls[i][1].stage).toBe(stage);
      });
    });

    it("handles special characters in agent and stage names", () => {
      tracker.record("dev-agent", "pre-test", {
        inputTokens: 100,
        costUsd: 0.01,
        provider: "claude",
      });

      const tokenCalls = mockEmit.mock.calls.filter(
        (call) => call[0] === "usage.tokens",
      );

      expect(tokenCalls[0][1].agent).toBe("dev-agent");
      expect(tokenCalls[0][1].stage).toBe("pre-test");
    });
  });

  describe("different provider pricing", () => {
    it("uses openrouter discount rate", () => {
      const usage: UsageInfo = {
        costUsd: 0.05,
        cachedTokens: 100_000,
        provider: "openrouter",
      };

      tracker.record("dev", "implement", usage);

      const costCalls = mockEmit.mock.calls.filter(
        (call) => call[0] === "usage.cost",
      );
      const [_event, data] = costCalls[0];

      // OpenRouter: 100k cached tokens * $3.00/million * 0.50 discount = $0.15
      expect(data.cacheSavingsUsd).toBeCloseTo(0.15, 2);
    });

    it("uses gemini pricing", () => {
      const usage: UsageInfo = {
        costUsd: 0.03,
        cachedTokens: 100_000,
        provider: "gemini",
      };

      tracker.record("dev", "implement", usage);

      const costCalls = mockEmit.mock.calls.filter(
        (call) => call[0] === "usage.cost",
      );
      const [_event, data] = costCalls[0];

      // Gemini: 100k cached tokens * $1.25/million * 0.90 discount = $0.1125
      expect(data.cacheSavingsUsd).toBeCloseTo(0.1125, 4);
    });

    it("emits all supported providers", () => {
      const providers = ["claude", "codex", "openrouter", "gemini"] as const;

      providers.forEach((provider) => {
        tracker.record("dev", "implement", {
          inputTokens: 1000,
          costUsd: 0.01,
          provider,
        });
      });

      const tokenCalls = mockEmit.mock.calls.filter(
        (call) => call[0] === "usage.tokens",
      );

      expect(tokenCalls.length).toBe(4);
      providers.forEach((provider, i) => {
        expect(tokenCalls[i][1].provider).toBe(provider);
      });
    });
  });
});
