import { describe, it, expect } from "vitest";
import { spawnAgentStream } from "../../src/spawn.js";

const SKIP_REASON = "ANTHROPIC_API_KEY not set — run locally with real key to test";

describe.skipIf(!process.env.ANTHROPIC_API_KEY)("Claude provider integration", () => {
  it("returns valid SpawnResult with non-empty stdout", async () => {
    const result = await spawnAgentStream(
      "test-agent",
      "Say 'Hello' and nothing else.",
      30000,
      { provider: "claude", model: "claude-3-5-haiku-20241022" }
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBeTruthy();
    expect(result.stdout.length).toBeGreaterThan(0);
  }, 60000);

  it("populates usage fields: inputTokens and outputTokens are numbers > 0", async () => {
    const result = await spawnAgentStream(
      "test-agent",
      "Count from 1 to 5.",
      30000,
      { provider: "claude", model: "claude-3-5-haiku-20241022" }
    );

    expect(result.usage).toBeDefined();
    expect(result.usage?.inputTokens).toBeGreaterThan(0);
    expect(result.usage?.outputTokens).toBeGreaterThan(0);
  }, 60000);

  it("extracts cache fields: cachedTokens and cacheWriteTokens are present", async () => {
    const result = await spawnAgentStream(
      "test-agent",
      "Respond with OK.",
      30000,
      { provider: "claude", model: "claude-3-5-haiku-20241022" }
    );

    expect(result.usage).toBeDefined();
    expect(result.usage).toHaveProperty("cachedTokens");
    expect(result.usage).toHaveProperty("cacheWriteTokens");
  }, 60000);

  it("streaming result message contains type: result", async () => {
    let hasResultType = false;

    await spawnAgentStream(
      "test-agent",
      "Say OK.",
      30000,
      {
        provider: "claude",
        model: "claude-3-5-haiku-20241022",
        onActivity: (event) => {
          if (event.type === "result") {
            hasResultType = true;
          }
        },
      }
    );

    expect(hasResultType).toBe(true);
  }, 60000);

  it("error handling: invalid model name returns meaningful error", async () => {
    await expect(
      spawnAgentStream(
        "test-agent",
        "Test.",
        30000,
        { provider: "claude", model: "invalid-model-name-12345" }
      )
    ).rejects.toThrow();
  }, 60000);

  it("timeout handling: respects timeoutMs option", async () => {
    await expect(
      spawnAgentStream(
        "test-agent",
        "Write a 10000 word essay.",
        1000, // 1 second timeout
        { provider: "claude", model: "claude-3-5-haiku-20241022" }
      )
    ).rejects.toThrow(/timeout|timed out/i);
  }, 60000);
});

describe.skipIf(process.env.ANTHROPIC_API_KEY)("Claude provider integration — skipped", () => {
  it("skips gracefully when ANTHROPIC_API_KEY not present", () => {
    console.log(SKIP_REASON);
  });
});
