import { describe, it, expect } from "vitest";
import { spawnAgentStream } from "../../src/spawn.js";

const SKIP_REASON = "OPENROUTER_API_KEY not set — run locally with real key to test";

describe.skipIf(!process.env.OPENROUTER_API_KEY)("OpenRouter provider integration", () => {
  it("returns valid SpawnResult", async () => {
    const result = await spawnAgentStream(
      "test-agent",
      "Say 'Hello' and nothing else.",
      30000,
      { provider: "openrouter", model: "anthropic/claude-3.5-haiku" }
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBeTruthy();
  }, 60000);

  it("populates usage fields: inputTokens, outputTokens, costUsd", async () => {
    const result = await spawnAgentStream(
      "test-agent",
      "Count from 1 to 3.",
      30000,
      { provider: "openrouter", model: "anthropic/claude-3.5-haiku" }
    );

    expect(result.usage).toBeDefined();
    expect(result.usage?.inputTokens).toBeGreaterThan(0);
    expect(result.usage?.outputTokens).toBeGreaterThan(0);
    // costUsd may be undefined if OpenRouter doesn't return total_cost
    expect(result.usage).toHaveProperty("costUsd");
  }, 60000);

  it("extracts cacheDiscount when present", async () => {
    const result = await spawnAgentStream(
      "test-agent",
      "Respond OK.",
      30000,
      { provider: "openrouter", model: "anthropic/claude-3.5-haiku" }
    );

    expect(result.usage).toBeDefined();
    expect(result.usage).toHaveProperty("cacheDiscount");
  }, 60000);

  it("extracts cachedTokens from prompt_tokens_details when present", async () => {
    const result = await spawnAgentStream(
      "test-agent",
      "Say OK.",
      30000,
      { provider: "openrouter", model: "anthropic/claude-3.5-haiku" }
    );

    expect(result.usage).toBeDefined();
    expect(result.usage).toHaveProperty("cachedTokens");
  }, 60000);

  it("API error handling: invalid API key returns meaningful error", async () => {
    const originalKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "invalid-key-12345";

    try {
      await expect(
        spawnAgentStream(
          "test-agent",
          "Test.",
          30000,
          { provider: "openrouter", model: "anthropic/claude-3.5-haiku" }
        )
      ).rejects.toThrow();
    } finally {
      process.env.OPENROUTER_API_KEY = originalKey;
    }
  }, 60000);

  it("timeout/abort handling works", async () => {
    // Skip if no valid key — timeout test needs auth to reach timeout scenario
    if (!process.env.OPENROUTER_API_KEY) return;

    await expect(
      spawnAgentStream(
        "test-agent",
        "Write a 10000 word essay about the history of computing.",
        100, // 100ms timeout — should always trigger
        { provider: "openrouter", model: "anthropic/claude-3.5-haiku" }
      )
    ).rejects.toThrow(/timed out/i);
  }, 60000);
});

describe.skipIf(process.env.OPENROUTER_API_KEY)("OpenRouter provider integration — skipped", () => {
  it("skips gracefully when OPENROUTER_API_KEY not present", () => {
    console.log(SKIP_REASON);
  });
});
