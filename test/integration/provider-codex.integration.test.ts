import { describe, it, expect, beforeAll } from "vitest";
import { spawnAgentStream } from "../../src/spawn.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

let codexAvailable = false;

beforeAll(async () => {
  try {
    await execFileAsync("which", ["codex"]);
    codexAvailable = true;
  } catch {
    codexAvailable = false;
  }
});

const SKIP_REASON = "Codex CLI not installed — install codex to test";

describe.skipIf(!codexAvailable)("Codex provider integration", () => {
  it("returns valid SpawnResult", async () => {
    const result = await spawnAgentStream(
      "test-agent",
      "Say 'Hello' and nothing else.",
      30000,
      { provider: "codex" }
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBeTruthy();
  }, 60000);

  it("populates usage fields: inputTokens and outputTokens", async () => {
    const result = await spawnAgentStream(
      "test-agent",
      "Count from 1 to 3.",
      30000,
      { provider: "codex" }
    );

    expect(result.usage).toBeDefined();
    expect(result.usage?.inputTokens).toBeGreaterThan(0);
    expect(result.usage?.outputTokens).toBeGreaterThan(0);
  }, 60000);

  it("extracts cachedTokens from prompt_tokens_details.cached_tokens", async () => {
    const result = await spawnAgentStream(
      "test-agent",
      "Respond OK.",
      30000,
      { provider: "codex" }
    );

    expect(result.usage).toBeDefined();
    expect(result.usage).toHaveProperty("cachedTokens");
  }, 60000);

  it("provider field set to codex", async () => {
    const result = await spawnAgentStream(
      "test-agent",
      "Say OK.",
      30000,
      { provider: "codex" }
    );

    expect(result.usage?.provider).toBe("codex");
  }, 60000);
});

describe.skipIf(codexAvailable)("Codex provider integration — skipped", () => {
  it("skips gracefully when Codex CLI not installed", () => {
    console.log(SKIP_REASON);
  });
});
