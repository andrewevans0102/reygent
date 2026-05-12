import { describe, it, expect, beforeAll } from "vitest";
import { spawnAgentStream } from "../../src/spawn.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

let geminiAvailable = false;

beforeAll(async () => {
  try {
    await execFileAsync("which", ["gemini"]);
    geminiAvailable = true;
  } catch {
    geminiAvailable = false;
  }
});

const SKIP_REASON = "Gemini CLI not installed — install gemini to test";

describe.skipIf(!geminiAvailable)("Gemini provider integration", () => {
  it("returns valid SpawnResult", async () => {
    const result = await spawnAgentStream(
      "test-agent",
      "Say 'Hello' and nothing else.",
      30000,
      { provider: "gemini" }
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBeTruthy();
  }, 60000);

  it("populates usage fields from usage_metadata", async () => {
    const result = await spawnAgentStream(
      "test-agent",
      "Count from 1 to 3.",
      30000,
      { provider: "gemini" }
    );

    expect(result.usage).toBeDefined();
    expect(result.usage?.inputTokens).toBeGreaterThan(0);
    expect(result.usage?.outputTokens).toBeGreaterThan(0);
  }, 60000);

  it("extracts cachedTokens from cached_content_token_count", async () => {
    const result = await spawnAgentStream(
      "test-agent",
      "Respond OK.",
      30000,
      { provider: "gemini" }
    );

    expect(result.usage).toBeDefined();
    expect(result.usage).toHaveProperty("cachedTokens");
  }, 60000);

  it("provider field set to gemini", async () => {
    const result = await spawnAgentStream(
      "test-agent",
      "Say OK.",
      30000,
      { provider: "gemini" }
    );

    expect(result.usage?.provider).toBe("gemini");
  }, 60000);
});

describe.skipIf(geminiAvailable)("Gemini provider integration — skipped", () => {
  it("skips gracefully when Gemini CLI not installed", () => {
    console.log(SKIP_REASON);
  });
});
