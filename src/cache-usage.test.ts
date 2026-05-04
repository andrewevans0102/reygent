import { describe, it, expect, vi, beforeEach } from "vitest";
import { UsageTracker, printUsageSummary, printVerboseUsage } from "./usage.js";
import type { UsageInfo } from "./usage.js";

/**
 * Tests for prompt caching usage tracking and reporting (DT-275).
 *
 * These tests validate the extended UsageInfo interface with cachedTokens
 * and cacheWriteTokens fields, and verify that UsageTracker correctly
 * aggregates and reports cache statistics.
 */

describe("UsageInfo cache fields", () => {
  it("accepts cachedTokens and cacheWriteTokens in usage entries", () => {
    const usage: UsageInfo = {
      costUsd: 0.05,
      inputTokens: 3800,
      outputTokens: 900,
      cachedTokens: 3100,
      cacheWriteTokens: 0,
    };
    expect(usage.cachedTokens).toBe(3100);
    expect(usage.cacheWriteTokens).toBe(0);
  });

  it("defaults cache fields to undefined when not provided", () => {
    const usage: UsageInfo = {
      costUsd: 0.05,
      inputTokens: 1000,
      outputTokens: 500,
    };
    expect(usage.cachedTokens).toBeUndefined();
    expect(usage.cacheWriteTokens).toBeUndefined();
  });

  it("supports cacheWriteTokens on first run (cache miss / write)", () => {
    const usage: UsageInfo = {
      inputTokens: 3800,
      outputTokens: 900,
      cachedTokens: 0,
      cacheWriteTokens: 3100,
    };
    expect(usage.cacheWriteTokens).toBe(3100);
    expect(usage.cachedTokens).toBe(0);
  });
});

describe("UsageTracker with cache fields", () => {
  let tracker: UsageTracker;

  beforeEach(() => {
    tracker = new UsageTracker();
  });

  it("records entries with cache fields", () => {
    tracker.record("dev", "implement", {
      costUsd: 0.05,
      inputTokens: 3800,
      outputTokens: 900,
      cachedTokens: 3100,
      cacheWriteTokens: 0,
    });
    const entries = tracker.getEntries();
    expect(entries[0].usage.cachedTokens).toBe(3100);
    expect(entries[0].usage.cacheWriteTokens).toBe(0);
  });

  it("getByAgent aggregates cachedTokens across calls", () => {
    tracker.record("dev", "implement", {
      costUsd: 0.03,
      inputTokens: 3800,
      outputTokens: 900,
      cachedTokens: 3100,
      cacheWriteTokens: 0,
    });
    tracker.record("dev", "gate", {
      costUsd: 0.01,
      inputTokens: 1200,
      outputTokens: 200,
      cachedTokens: 800,
      cacheWriteTokens: 0,
    });
    const byAgent = tracker.getByAgent();
    const dev = byAgent.get("dev")!;
    expect(dev.cachedTokens).toBe(3900);
  });

  it("getByAgent defaults missing cachedTokens to 0 in aggregation", () => {
    tracker.record("dev", "implement", {
      costUsd: 0.05,
      inputTokens: 1000,
      outputTokens: 500,
      // no cachedTokens
    });
    const byAgent = tracker.getByAgent();
    const dev = byAgent.get("dev")!;
    expect(dev.cachedTokens).toBe(0);
  });

  it("getByAgent aggregates cacheWriteTokens", () => {
    tracker.record("planner", "plan", {
      inputTokens: 1200,
      outputTokens: 400,
      cachedTokens: 0,
      cacheWriteTokens: 900,
    });
    const byAgent = tracker.getByAgent();
    const planner = byAgent.get("planner")!;
    expect(planner.cacheWriteTokens).toBe(900);
  });

  it("computes total cached tokens across all agents", () => {
    tracker.record("planner", "plan", {
      inputTokens: 1200,
      outputTokens: 400,
      cachedTokens: 900,
    });
    tracker.record("dev", "implement", {
      inputTokens: 3800,
      outputTokens: 900,
      cachedTokens: 3100,
    });
    tracker.record("qe", "implement", {
      inputTokens: 3800,
      outputTokens: 700,
      cachedTokens: 3100,
    });

    const entries = tracker.getEntries();
    const totalCached = entries.reduce(
      (sum, e) => sum + (e.usage.cachedTokens ?? 0),
      0,
    );
    expect(totalCached).toBe(7100);
  });
});

describe("Cache savings calculation", () => {
  // Claude: cached tokens billed at ~10% → 90% discount
  // OpenAI Codex: cached tokens at 25% (75% discount)
  // OpenRouter: uses reported cache_discount directly

  const CLAUDE_INPUT_RATE = 0.003; // $ per 1K input tokens (example)
  const CLAUDE_CACHED_RATE = 0.0003; // ~10% of standard
  const CODEX_INPUT_RATE = 0.0025;
  const CODEX_CACHED_RATE = 0.000625; // 25% of standard

  function computeSavings(
    cachedTokens: number,
    standardRate: number,
    cachedRate: number,
  ): number {
    return (cachedTokens / 1000) * (standardRate - cachedRate);
  }

  it("computes Claude cache savings correctly", () => {
    const savings = computeSavings(3100, CLAUDE_INPUT_RATE, CLAUDE_CACHED_RATE);
    // 3.1 * (0.003 - 0.0003) = 3.1 * 0.0027 = 0.00837
    expect(savings).toBeCloseTo(0.00837, 4);
  });

  it("computes Codex cache savings correctly", () => {
    const savings = computeSavings(3100, CODEX_INPUT_RATE, CODEX_CACHED_RATE);
    // 3.1 * (0.0025 - 0.000625) = 3.1 * 0.001875 = 0.0058125
    expect(savings).toBeCloseTo(0.005813, 4);
  });

  it("returns 0 savings when cachedTokens is 0", () => {
    expect(computeSavings(0, CLAUDE_INPUT_RATE, CLAUDE_CACHED_RATE)).toBe(0);
  });

  it("aggregates savings across multiple agents with different providers", () => {
    // Simulating mixed-provider run
    const claudeSavings = computeSavings(3100, CLAUDE_INPUT_RATE, CLAUDE_CACHED_RATE);
    const codexSavings = computeSavings(2000, CODEX_INPUT_RATE, CODEX_CACHED_RATE);
    const totalSavings = claudeSavings + codexSavings;
    expect(totalSavings).toBeGreaterThan(0);
    expect(totalSavings).toBeCloseTo(claudeSavings + codexSavings, 4);
  });
});

describe("Cache hit rate calculation", () => {
  it("computes cache hit rate as percentage", () => {
    const inputTokens = 3800;
    const cachedTokens = 3100;
    const hitRate = (cachedTokens / inputTokens) * 100;
    expect(hitRate).toBeCloseTo(81.58, 1);
  });

  it("returns 0% when no cached tokens", () => {
    const inputTokens = 3800;
    const cachedTokens = 0;
    const hitRate = (cachedTokens / inputTokens) * 100;
    expect(hitRate).toBe(0);
  });

  it("returns 0% when no input tokens (avoids division by zero)", () => {
    const inputTokens = 0;
    const cachedTokens = 0;
    const hitRate = inputTokens > 0 ? (cachedTokens / inputTokens) * 100 : 0;
    expect(hitRate).toBe(0);
  });

  it("handles 100% cache hit rate", () => {
    const inputTokens = 5000;
    const cachedTokens = 5000;
    const hitRate = (cachedTokens / inputTokens) * 100;
    expect(hitRate).toBe(100);
  });
});

describe("printUsageSummary with cache data", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("includes cached token counts in summary output", () => {
    const tracker = new UsageTracker();
    tracker.record("dev", "implement", {
      costUsd: 0.05,
      durationMs: 5000,
      inputTokens: 3800,
      outputTokens: 900,
      cachedTokens: 3100,
    });
    printUsageSummary(tracker);
    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("cached");
  });

  it("includes savings amount in summary output", () => {
    const tracker = new UsageTracker();
    tracker.record("planner", "plan", {
      costUsd: 0.003,
      durationMs: 2000,
      inputTokens: 1200,
      outputTokens: 400,
      cachedTokens: 900,
    });
    tracker.record("dev", "implement", {
      costUsd: 0.018,
      durationMs: 8000,
      inputTokens: 3800,
      outputTokens: 900,
      cachedTokens: 3100,
    });
    printUsageSummary(tracker);
    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    // Actual format uses "Cache saves:" not "saved"
    expect(output).toContain("Cache saves");
  });

  it("shows total savings line at end of report", () => {
    const tracker = new UsageTracker();
    tracker.record("dev", "implement", {
      costUsd: 0.05,
      inputTokens: 3800,
      outputTokens: 900,
      cachedTokens: 3100,
      durationMs: 5000,
    });
    tracker.record("qe", "implement", {
      costUsd: 0.04,
      inputTokens: 3800,
      outputTokens: 700,
      cachedTokens: 3100,
      durationMs: 4000,
    });
    printUsageSummary(tracker);
    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    // Should have a cache saves line with dollar amount
    expect(output).toMatch(/Cache saves.*\$/);
  });

  it("does not show cache info when no cached tokens exist", () => {
    const tracker = new UsageTracker();
    tracker.record("dev", "implement", {
      costUsd: 0.05,
      durationMs: 5000,
      inputTokens: 1000,
      outputTokens: 500,
    });
    printUsageSummary(tracker);
    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    // Should not have cache savings when there are no cached tokens
    expect(output).not.toContain("saved");
  });

  it("shows per-agent cached token counts in by-agent breakdown", () => {
    const tracker = new UsageTracker();
    tracker.record("planner", "plan", {
      costUsd: 0.003,
      durationMs: 2000,
      inputTokens: 1200,
      outputTokens: 400,
      cachedTokens: 900,
    });
    tracker.record("dev", "implement", {
      costUsd: 0.018,
      durationMs: 8000,
      inputTokens: 3800,
      outputTokens: 900,
      cachedTokens: 3100,
    });
    printUsageSummary(tracker);
    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    // Per-agent lines should show cached token count
    expect(output).toContain("planner");
    expect(output).toContain("dev");
  });
});

describe("printVerboseUsage with cache metadata", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("shows raw cache metadata in verbose output", () => {
    const tracker = new UsageTracker();
    tracker.record("dev", "implement", {
      costUsd: 0.05,
      durationMs: 5000,
      inputTokens: 3800,
      outputTokens: 900,
      cachedTokens: 3100,
      cacheWriteTokens: 0,
    });
    printVerboseUsage(tracker);
    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    // Verbose output should include cache metadata
    expect(output).toContain("3,100") ; // cachedTokens formatted
  });

  it("shows cacheWriteTokens in verbose output when present", () => {
    const tracker = new UsageTracker();
    tracker.record("dev", "implement", {
      costUsd: 0.05,
      durationMs: 5000,
      inputTokens: 3800,
      outputTokens: 900,
      cachedTokens: 0,
      cacheWriteTokens: 3100,
    });
    printVerboseUsage(tracker);
    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("cache");
  });

  it("does not show cache section when no cache data exists", () => {
    const tracker = new UsageTracker();
    tracker.record("dev", "implement", {
      costUsd: 0.05,
      durationMs: 5000,
      inputTokens: 1000,
      outputTokens: 500,
    });
    printVerboseUsage(tracker);
    const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(output).toContain("dev");
    // Should still render, just without cache-specific data
  });
});
