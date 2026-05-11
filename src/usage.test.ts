import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { UsageTracker, formatDuration, printUsageSummary, calculateCacheSavings, printCacheWarnings } from "./usage.js";
import { PROVIDER_PRICING } from "./pricing.js";
import { getChesstrace, resetChesstrace } from "./chesstrace/index.js";
import { Events } from "./chesstrace/events.js";

describe("UsageTracker", () => {
  beforeEach(() => {
    resetChesstrace();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts with zero cost", () => {
    const tracker = new UsageTracker();
    expect(tracker.getTotalCost()).toBe(0);
  });

  it("starts with empty entries", () => {
    const tracker = new UsageTracker();
    expect(tracker.getEntries()).toEqual([]);
  });

  it("records entries", () => {
    const tracker = new UsageTracker();
    tracker.record("dev", "implement", { costUsd: 0.05 });
    expect(tracker.getEntries().length).toBe(1);
    expect(tracker.getEntries()[0].agent).toBe("dev");
    expect(tracker.getEntries()[0].stage).toBe("implement");
  });

  it("sums total cost", () => {
    const tracker = new UsageTracker();
    tracker.record("dev", "implement", { costUsd: 0.05 });
    tracker.record("qe", "implement", { costUsd: 0.03 });
    tracker.record("planner", "plan", { costUsd: 0.02 });
    expect(tracker.getTotalCost()).toBeCloseTo(0.1);
  });

  it("handles missing costUsd as 0", () => {
    const tracker = new UsageTracker();
    tracker.record("dev", "implement", {});
    expect(tracker.getTotalCost()).toBe(0);
  });

  describe("getByAgent", () => {
    it("groups by agent", () => {
      const tracker = new UsageTracker();
      tracker.record("dev", "implement", { costUsd: 0.05, inputTokens: 100, outputTokens: 50 });
      tracker.record("dev", "gate", { costUsd: 0.02, inputTokens: 50, outputTokens: 25 });
      tracker.record("qe", "implement", { costUsd: 0.03, inputTokens: 80, outputTokens: 40 });

      const byAgent = tracker.getByAgent();
      expect(byAgent.size).toBe(2);

      const dev = byAgent.get("dev")!;
      expect(dev.cost).toBeCloseTo(0.07);
      expect(dev.inputTokens).toBe(150);
      expect(dev.outputTokens).toBe(75);
      expect(dev.calls).toBe(2);

      const qe = byAgent.get("qe")!;
      expect(qe.cost).toBeCloseTo(0.03);
      expect(qe.calls).toBe(1);
    });

    it("returns empty map when no entries", () => {
      const tracker = new UsageTracker();
      expect(tracker.getByAgent().size).toBe(0);
    });

    it("handles missing token counts as 0", () => {
      const tracker = new UsageTracker();
      tracker.record("dev", "implement", { costUsd: 0.01 });
      const dev = tracker.getByAgent().get("dev")!;
      expect(dev.inputTokens).toBe(0);
      expect(dev.outputTokens).toBe(0);
    });

    it("aggregates cachedTokens and cacheWriteTokens", () => {
      const tracker = new UsageTracker();
      tracker.record("dev", "implement", { cachedTokens: 1000, cacheWriteTokens: 500 });
      tracker.record("dev", "gate", { cachedTokens: 2000, cacheWriteTokens: 0 });
      const dev = tracker.getByAgent().get("dev")!;
      expect(dev.cachedTokens).toBe(3000);
      expect(dev.cacheWriteTokens).toBe(500);
    });

    it("handles missing cache fields as 0 in aggregation", () => {
      const tracker = new UsageTracker();
      tracker.record("dev", "implement", { costUsd: 0.01 });
      const dev = tracker.getByAgent().get("dev")!;
      expect(dev.cachedTokens).toBe(0);
      expect(dev.cacheWriteTokens).toBe(0);
    });
  });

  it("getEntries returns a copy", () => {
    const tracker = new UsageTracker();
    tracker.record("dev", "implement", { costUsd: 0.01 });
    const entries = tracker.getEntries();
    entries.pop();
    expect(tracker.getEntries().length).toBe(1);
  });

  describe("telemetry emission", () => {
    it("emits usage.tokens event when recording", () => {
      const tracker = new UsageTracker();
      const chesstrace = getChesstrace();
      vi.spyOn(chesstrace, "isEnabled").mockReturnValue(true);
      const emitSpy = vi.spyOn(chesstrace, "emit");

      tracker.record("dev", "implement", {
        inputTokens: 1000,
        outputTokens: 500,
        cachedTokens: 200,
        cacheWriteTokens: 100,
        provider: "claude",
      });

      expect(emitSpy).toHaveBeenCalledWith(Events.USAGE_TOKENS, {
        agent: "dev",
        stage: "implement",
        inputTokens: 1000,
        outputTokens: 500,
        cachedTokens: 200,
        cacheWriteTokens: 100,
        provider: "claude",
      });
    });

    it("emits usage.cost event when recording", () => {
      const tracker = new UsageTracker();
      const chesstrace = getChesstrace();
      vi.spyOn(chesstrace, "isEnabled").mockReturnValue(true);
      const emitSpy = vi.spyOn(chesstrace, "emit");

      const usage = {
        costUsd: 0.05,
        cachedTokens: 50000,
        provider: "claude" as const,
      };
      tracker.record("dev", "implement", usage);

      const calls = emitSpy.mock.calls.filter((call) => call[0] === Events.USAGE_COST);
      expect(calls.length).toBe(1);
      expect(calls[0][1]).toMatchObject({
        agent: "dev",
        stage: "implement",
        costUsd: 0.05,
      });
      // Verify cacheSavingsUsd is calculated correctly
      const expectedSavings = calculateCacheSavings(usage);
      const cacheSavingsUsd = calls[0][1].cacheSavingsUsd as number;
      expect(cacheSavingsUsd).toBeGreaterThan(0);
      expect(cacheSavingsUsd).toBeCloseTo(expectedSavings);
    });

    it("defaults missing token values to 0 in telemetry", () => {
      const tracker = new UsageTracker();
      const chesstrace = getChesstrace();
      vi.spyOn(chesstrace, "isEnabled").mockReturnValue(true);
      const emitSpy = vi.spyOn(chesstrace, "emit");

      tracker.record("dev", "implement", { costUsd: 0.02 });

      expect(emitSpy).toHaveBeenCalledWith(Events.USAGE_TOKENS, {
        agent: "dev",
        stage: "implement",
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        cacheWriteTokens: 0,
        provider: undefined,
      });
    });

    it("calculates zero cache savings when no cached tokens", () => {
      const tracker = new UsageTracker();
      const chesstrace = getChesstrace();
      vi.spyOn(chesstrace, "isEnabled").mockReturnValue(true);
      const emitSpy = vi.spyOn(chesstrace, "emit");

      tracker.record("dev", "implement", {
        costUsd: 0.03,
        inputTokens: 1000,
        outputTokens: 500,
        provider: "claude",
      });

      const calls = emitSpy.mock.calls.filter((call) => call[0] === Events.USAGE_COST);
      expect(calls[0][1].cacheSavingsUsd).toBe(0);
    });

    it("emits both events for single record call", () => {
      const tracker = new UsageTracker();
      const chesstrace = getChesstrace();
      vi.spyOn(chesstrace, "isEnabled").mockReturnValue(true);
      const emitSpy = vi.spyOn(chesstrace, "emit");

      tracker.record("qe", "test", {
        costUsd: 0.01,
        inputTokens: 500,
        outputTokens: 250,
      });

      expect(emitSpy).toHaveBeenCalledTimes(2);
      expect(emitSpy).toHaveBeenNthCalledWith(1, Events.USAGE_TOKENS, expect.any(Object));
      expect(emitSpy).toHaveBeenNthCalledWith(2, Events.USAGE_COST, expect.any(Object));
    });
  });
});

describe("formatDuration", () => {
  it("formats milliseconds", () => {
    expect(formatDuration(500)).toBe("500ms");
  });

  it("formats seconds", () => {
    expect(formatDuration(5000)).toBe("5s");
  });

  it("formats minutes and seconds", () => {
    expect(formatDuration(125000)).toBe("2m 5s");
  });

  it("formats exactly one minute", () => {
    expect(formatDuration(60000)).toBe("1m 0s");
  });

  it("formats sub-second as ms", () => {
    expect(formatDuration(999)).toBe("999ms");
  });

  it("formats exactly 1000ms as 1s", () => {
    expect(formatDuration(1000)).toBe("1s");
  });
});

describe("printUsageSummary", () => {
  it("does nothing for empty tracker", () => {
    const spy = vi.spyOn(console, "log");
    const tracker = new UsageTracker();
    printUsageSummary(tracker);
    expect(spy).not.toHaveBeenCalled();
  });

  it("prints summary for populated tracker", () => {
    const spy = vi.spyOn(console, "log");
    const tracker = new UsageTracker();
    tracker.record("dev", "implement", { costUsd: 0.05, durationMs: 5000, inputTokens: 100, outputTokens: 50 });
    printUsageSummary(tracker);
    expect(spy).toHaveBeenCalled();
    const output = spy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("Usage Summary");
    expect(output).toContain("$0.05");
    expect(output).toContain("dev");
  });

  it("shows cached token count in summary when present", () => {
    const spy = vi.spyOn(console, "log");
    const tracker = new UsageTracker();
    tracker.record("dev", "implement", {
      costUsd: 0.05,
      durationMs: 5000,
      inputTokens: 3800,
      outputTokens: 900,
      cachedTokens: 3100,
      provider: "claude",
    });
    printUsageSummary(tracker);
    const output = spy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("cached");
  });

  it("shows cache savings when present", () => {
    const spy = vi.spyOn(console, "log");
    const tracker = new UsageTracker();
    tracker.record("dev", "implement", {
      costUsd: 0.05,
      inputTokens: 100000,
      outputTokens: 900,
      cachedTokens: 50000,
      provider: "claude",
    });
    printUsageSummary(tracker);
    const output = spy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("Cache saves");
  });
});

describe("calculateCacheSavings", () => {
  it("returns 0 when no cached tokens", () => {
    expect(calculateCacheSavings({ inputTokens: 1000, provider: "claude" })).toBe(0);
  });

  it("returns 0 when cachedTokens is 0", () => {
    expect(calculateCacheSavings({ cachedTokens: 0, provider: "claude" })).toBe(0);
  });

  it("calculates savings for claude provider", () => {
    // 1M cached tokens * $3/M * 0.90 discount = $2.70
    const savings = calculateCacheSavings({ cachedTokens: 1_000_000, provider: "claude" });
    expect(savings).toBeCloseTo(2.70);
  });

  it("calculates savings for codex provider", () => {
    // 1M cached tokens * $1.25/M * 0.90 discount = $1.125
    const savings = calculateCacheSavings({ cachedTokens: 1_000_000, provider: "codex" });
    expect(savings).toBeCloseTo(1.125);
  });

  it("calculates savings for openrouter provider", () => {
    // 1M cached tokens * $3/M * 0.50 discount = $1.50
    const savings = calculateCacheSavings({ cachedTokens: 1_000_000, provider: "openrouter" });
    expect(savings).toBeCloseTo(1.50);
  });

  it("calculates savings for gemini provider", () => {
    // 1M cached tokens * $1.25/M * 0.90 discount = $1.125
    const savings = calculateCacheSavings({ cachedTokens: 1_000_000, provider: "gemini" });
    expect(savings).toBeCloseTo(1.125);
  });

  it("uses claude defaults when provider is undefined", () => {
    const savings = calculateCacheSavings({ cachedTokens: 1_000_000 });
    expect(savings).toBeCloseTo(2.70);
  });

  it("handles small token counts", () => {
    // 1000 tokens * $3/M * 0.90 = $0.0027
    const savings = calculateCacheSavings({ cachedTokens: 1000, provider: "claude" });
    expect(savings).toBeCloseTo(0.0027);
  });
});

describe("printCacheWarnings", () => {
  it("warns when claude provider has input tokens but no cached tokens", () => {
    const spy = vi.spyOn(console, "error");
    const tracker = new UsageTracker();
    tracker.record("dev", "implement", {
      inputTokens: 5000,
      cachedTokens: 0,
      provider: "claude",
    });
    printCacheWarnings(tracker);
    expect(spy).toHaveBeenCalled();
    const output = spy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("caching appears inactive");
    expect(output).toContain("claude");
  });

  it("warns when codex provider has input tokens but no cached tokens", () => {
    const spy = vi.spyOn(console, "error");
    const tracker = new UsageTracker();
    tracker.record("dev", "implement", {
      inputTokens: 5000,
      cachedTokens: 0,
      provider: "codex",
    });
    printCacheWarnings(tracker);
    expect(spy).toHaveBeenCalled();
    const output = spy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("caching appears inactive");
  });

  it("does not warn when cachedTokens > 0", () => {
    const spy = vi.spyOn(console, "error");
    const tracker = new UsageTracker();
    tracker.record("dev", "implement", {
      inputTokens: 5000,
      cachedTokens: 3000,
      provider: "claude",
    });
    printCacheWarnings(tracker);
    expect(spy).not.toHaveBeenCalled();
  });

  it("does not warn for gemini provider", () => {
    const spy = vi.spyOn(console, "error");
    const tracker = new UsageTracker();
    tracker.record("dev", "implement", {
      inputTokens: 5000,
      cachedTokens: 0,
      provider: "gemini",
    });
    printCacheWarnings(tracker);
    expect(spy).not.toHaveBeenCalled();
  });

  it("does not warn for openrouter provider", () => {
    const spy = vi.spyOn(console, "error");
    const tracker = new UsageTracker();
    tracker.record("dev", "implement", {
      inputTokens: 5000,
      cachedTokens: 0,
      provider: "openrouter",
    });
    printCacheWarnings(tracker);
    expect(spy).not.toHaveBeenCalled();
  });

  it("does not warn when no provider set", () => {
    const spy = vi.spyOn(console, "error");
    const tracker = new UsageTracker();
    tracker.record("dev", "implement", {
      inputTokens: 5000,
    });
    printCacheWarnings(tracker);
    expect(spy).not.toHaveBeenCalled();
  });

  it("only warns once per agent", () => {
    const spy = vi.spyOn(console, "error");
    const tracker = new UsageTracker();
    tracker.record("dev", "implement", { inputTokens: 5000, cachedTokens: 0, provider: "claude" });
    tracker.record("dev", "gate", { inputTokens: 3000, cachedTokens: 0, provider: "claude" });
    printCacheWarnings(tracker);
    // Should only warn once for "dev"
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("calculateCacheSavings integration with PROVIDER_PRICING", () => {
  it("matches PROVIDER_PRICING values for claude", () => {
    const claudePricing = PROVIDER_PRICING.claude;
    const savings = calculateCacheSavings({ cachedTokens: 1_000_000, provider: "claude" });
    const expected = (1_000_000 / 1_000_000) * claudePricing.inputCostPerMillion * claudePricing.cacheDiscountRate;
    expect(savings).toBeCloseTo(expected);
  });

  it("matches PROVIDER_PRICING values for codex", () => {
    const codexPricing = PROVIDER_PRICING.codex;
    const savings = calculateCacheSavings({ cachedTokens: 1_000_000, provider: "codex" });
    const expected = (1_000_000 / 1_000_000) * codexPricing.inputCostPerMillion * codexPricing.cacheDiscountRate;
    expect(savings).toBeCloseTo(expected);
  });

  it("matches PROVIDER_PRICING values for openrouter", () => {
    const orPricing = PROVIDER_PRICING.openrouter;
    const savings = calculateCacheSavings({ cachedTokens: 1_000_000, provider: "openrouter" });
    const expected = (1_000_000 / 1_000_000) * orPricing.inputCostPerMillion * orPricing.cacheDiscountRate;
    expect(savings).toBeCloseTo(expected);
  });

  it("matches PROVIDER_PRICING values for gemini", () => {
    const geminiPricing = PROVIDER_PRICING.gemini;
    const savings = calculateCacheSavings({ cachedTokens: 1_000_000, provider: "gemini" });
    const expected = (1_000_000 / 1_000_000) * geminiPricing.inputCostPerMillion * geminiPricing.cacheDiscountRate;
    expect(savings).toBeCloseTo(expected);
  });
});
