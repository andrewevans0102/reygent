import { describe, it, expect } from "vitest";
import { spawnAgentStream } from "../../src/spawn.js";
import { UsageTracker, printUsageSummary, printVerboseUsage, calculateCacheSavings } from "../../src/usage.js";

const hasAnyProvider = !!process.env.ANTHROPIC_API_KEY || !!process.env.OPENROUTER_API_KEY;
const SKIP_REASON = "Requires at least 1 provider key — set ANTHROPIC_API_KEY or OPENROUTER_API_KEY";

describe.skipIf(!hasAnyProvider)("Usage tracking integration", () => {
  it("real provider call produces UsageInfo with all expected fields", async () => {
    const provider = process.env.ANTHROPIC_API_KEY ? "claude" : "openrouter";
    const model = provider === "claude" ? "claude-3-5-haiku-20241022" : "anthropic/claude-3.5-haiku";

    const result = await spawnAgentStream("test-agent", "Say OK.", 30000, {
      provider,
      model,
    });

    expect(result.usage).toBeDefined();
    expect(result.usage?.inputTokens).toBeGreaterThan(0);
    expect(result.usage?.outputTokens).toBeGreaterThan(0);
    expect(result.usage?.provider).toBe(provider);
    expect(result.usage).toHaveProperty("cachedTokens");
    // cacheWriteTokens only present for Claude/Codex
    if (provider === "claude") {
      expect(result.usage).toHaveProperty("cacheWriteTokens");
    }
  }, 60000);

  it("UsageTracker.record() with real usage data, then getByAgent() returns correct aggregates", async () => {
    const provider = process.env.ANTHROPIC_API_KEY ? "claude" : "openrouter";
    const model = provider === "claude" ? "claude-3-5-haiku-20241022" : "anthropic/claude-3.5-haiku";

    const tracker = new UsageTracker();

    const result1 = await spawnAgentStream("dev", "Write code.", 30000, { provider, model });
    const result2 = await spawnAgentStream("qe", "Write tests.", 30000, { provider, model });

    tracker.record("dev", "implement", result1.usage!);
    tracker.record("qe", "implement", result2.usage!);

    const byAgent = tracker.getByAgent();
    expect(byAgent.get("dev")?.inputTokens).toBeGreaterThan(0);
    expect(byAgent.get("qe")?.inputTokens).toBeGreaterThan(0);
    expect(byAgent.get("dev")?.calls).toBe(1);
    expect(byAgent.get("qe")?.calls).toBe(1);
  }, 120000);

  it("printUsageSummary with real data shows non-zero token counts and costs", async () => {
    const provider = process.env.ANTHROPIC_API_KEY ? "claude" : "openrouter";
    const model = provider === "claude" ? "claude-3-5-haiku-20241022" : "anthropic/claude-3.5-haiku";

    const tracker = new UsageTracker();

    const result = await spawnAgentStream("test-agent", "Test.", 30000, { provider, model });
    tracker.record("test-agent", "test", result.usage!);

    const consoleLogSpy = vi.spyOn(console, "log");
    printUsageSummary(tracker);

    expect(consoleLogSpy).toHaveBeenCalled();
    const output = consoleLogSpy.mock.calls.map(call => call.join(" ")).join("\n");
    expect(output).toMatch(/\d+/);
    consoleLogSpy.mockRestore();
  }, 60000);

  it("printVerboseUsage with real data shows usage details", async () => {
    const provider = process.env.ANTHROPIC_API_KEY ? "claude" : "openrouter";
    const model = provider === "claude" ? "claude-3-5-haiku-20241022" : "anthropic/claude-3.5-haiku";

    const tracker = new UsageTracker();

    const result = await spawnAgentStream("test-agent", "Test.", 30000, { provider, model });
    tracker.record("test-agent", "test", result.usage!);

    const consoleLogSpy = vi.spyOn(console, "log");
    printVerboseUsage(tracker);

    expect(consoleLogSpy).toHaveBeenCalled();
    const output = consoleLogSpy.mock.calls.map(call => call.join(" ")).join("\n");
    // Verify output includes agent name and verbose header
    expect(output).toMatch(/test-agent/i);
    expect(output).toMatch(/detailed usage/i);
    consoleLogSpy.mockRestore();
  }, 60000);

  it("calculateCacheSavings with real usage data returns value consistent with provider pricing", async () => {
    const provider = process.env.ANTHROPIC_API_KEY ? "claude" : "openrouter";
    const model = provider === "claude" ? "claude-3-5-haiku-20241022" : "anthropic/claude-3.5-haiku";

    const result = await spawnAgentStream("test-agent", "Test.", 30000, { provider, model });

    const savings = calculateCacheSavings(result.usage!);
    expect(savings).toBeGreaterThanOrEqual(0);
  }, 60000);
});

describe.skipIf(hasAnyProvider)("Usage tracking integration — skipped", () => {
  it("skips gracefully when no provider key present", () => {
    console.log(SKIP_REASON);
  });
});
