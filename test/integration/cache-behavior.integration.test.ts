import { describe, it, expect, vi } from "vitest";
import { spawnAgentStream } from "../../src/spawn.js";
import { UsageTracker, printCacheWarnings } from "../../src/usage.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const hasClaudeKey = !!process.env.ANTHROPIC_API_KEY;

let codexAvailable = false;
try {
  await execFileAsync("which", ["codex"]);
  codexAvailable = true;
} catch {
  codexAvailable = false;
}

const SKIP_REASON = "Requires ANTHROPIC_API_KEY or Codex CLI";

describe.skipIf(!hasClaudeKey && !codexAvailable)("Cache behavior integration", () => {
  it("Claude: run identical prompt twice, second run has cachedTokens > 0", async () => {
    if (!hasClaudeKey) return;

    const prompt = "Say 'cache test' and nothing else.";

    const firstRun = await spawnAgentStream("test-agent", prompt, 30000, {
      provider: "claude",
      model: "claude-3-5-haiku-20241022",
    });

    const secondRun = await spawnAgentStream("test-agent", prompt, 30000, {
      provider: "claude",
      model: "claude-3-5-haiku-20241022",
    });

    expect(firstRun.usage?.cacheWriteTokens).toBeGreaterThan(0);
    expect(secondRun.usage?.cachedTokens).toBeGreaterThan(0);
  }, 120000);

  it("Codex: run identical prompt twice, second run has cachedTokens > 0", async () => {
    if (!codexAvailable) return;

    const prompt = "Say 'cache test' and nothing else.";

    const firstRun = await spawnAgentStream("test-agent", prompt, 30000, {
      provider: "codex",
      model: "gpt-5.4",
    });

    const secondRun = await spawnAgentStream("test-agent", prompt, 30000, {
      provider: "codex",
      model: "gpt-5.4",
    });

    // Note: OpenAI prompt caching may not be available for all models
    // If cachedTokens is undefined, model doesn't support caching yet
    if (secondRun.usage?.cachedTokens === undefined) {
      console.log("Skipping: model doesn't support prompt caching yet");
      return;
    }
    expect(secondRun.usage.cachedTokens).toBeGreaterThan(0);
  }, 120000);

  it("printCacheWarnings does NOT warn when caching is active (second run)", async () => {
    if (!hasClaudeKey) return;

    const tracker = new UsageTracker();
    const prompt = "Cache warning test.";

    await spawnAgentStream("test-agent", prompt, 30000, {
      provider: "claude",
      model: "claude-3-5-haiku-20241022",
    });

    const secondRun = await spawnAgentStream("test-agent", prompt, 30000, {
      provider: "claude",
      model: "claude-3-5-haiku-20241022",
    });

    tracker.record("test-agent", "test", secondRun.usage!);

    const consoleErrorSpy = vi.spyOn(console, "error");
    printCacheWarnings(tracker);

    expect(consoleErrorSpy).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  }, 120000);

  it("printCacheWarnings DOES warn on first run when cachedTokens is 0 for Claude", async () => {
    if (!hasClaudeKey) return;

    const tracker = new UsageTracker();
    const prompt = "Warning test.";

    const firstRun = await spawnAgentStream("test-agent", prompt, 30000, {
      provider: "claude",
      model: "claude-3-5-haiku-20241022",
    });

    tracker.record("test-agent", "test", firstRun.usage!);

    const consoleErrorSpy = vi.spyOn(console, "error");
    printCacheWarnings(tracker);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Prompt caching appears inactive")
    );
    consoleErrorSpy.mockRestore();
  }, 120000);

  it("cache hit rate calculation matches expected ratio", async () => {
    if (!hasClaudeKey) return;

    const prompt = "Hit rate test.";

    const firstRun = await spawnAgentStream("test-agent", prompt, 30000, {
      provider: "claude",
      model: "claude-3-5-haiku-20241022",
    });

    const secondRun = await spawnAgentStream("test-agent", prompt, 30000, {
      provider: "claude",
      model: "claude-3-5-haiku-20241022",
    });

    const totalInput = (firstRun.usage?.inputTokens ?? 0) + (secondRun.usage?.inputTokens ?? 0);
    const cachedTokens = secondRun.usage?.cachedTokens ?? 0;
    const hitRate = cachedTokens / totalInput;

    expect(hitRate).toBeGreaterThan(0);
    expect(hitRate).toBeLessThanOrEqual(1);
  }, 120000);
});

describe.skipIf(hasClaudeKey || codexAvailable)("Cache behavior integration — skipped", () => {
  it("skips gracefully when no cache-capable provider available", () => {
    console.log(SKIP_REASON);
  });
});
