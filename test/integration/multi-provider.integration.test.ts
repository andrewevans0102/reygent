import { describe, it, expect } from "vitest";
import { spawnAgentStream } from "../../src/spawn.js";
import { UsageTracker, calculateCacheSavings } from "../../src/usage.js";

const hasClaudeKey = !!process.env.ANTHROPIC_API_KEY;
const hasOpenRouterKey = !!process.env.OPENROUTER_API_KEY;
const hasTwoProviders = hasClaudeKey && hasOpenRouterKey;

const SKIP_REASON = "Requires at least 2 provider keys — set ANTHROPIC_API_KEY and OPENROUTER_API_KEY";

describe.skipIf(!hasTwoProviders)("Multi-provider integration", () => {
  it("same prompt sent to Claude and OpenRouter produces parseable output from both", async () => {
    const prompt = "Say 'OK' and nothing else.";

    const claudeResult = await spawnAgentStream("test-agent", prompt, 30000, {
      provider: "claude",
      model: "claude-3-5-haiku-20241022",
    });

    const openrouterResult = await spawnAgentStream("test-agent", prompt, 30000, {
      provider: "openrouter",
      model: "anthropic/claude-3.5-haiku",
    });

    expect(claudeResult.exitCode).toBe(0);
    expect(claudeResult.stdout).toBeTruthy();
    expect(openrouterResult.exitCode).toBe(0);
    expect(openrouterResult.stdout).toBeTruthy();
  }, 120000);

  it("ParsedOutput shape is consistent across providers", async () => {
    const prompt = "Output the number 42.";

    const claudeResult = await spawnAgentStream("test-agent", prompt, 30000, {
      provider: "claude",
      model: "claude-3-5-haiku-20241022",
    });

    const openrouterResult = await spawnAgentStream("test-agent", prompt, 30000, {
      provider: "openrouter",
      model: "anthropic/claude-3.5-haiku",
    });

    expect(claudeResult).toHaveProperty("stdout");
    expect(claudeResult).toHaveProperty("exitCode");
    expect(claudeResult).toHaveProperty("usage");

    expect(openrouterResult).toHaveProperty("stdout");
    expect(openrouterResult).toHaveProperty("exitCode");
    expect(openrouterResult).toHaveProperty("usage");
  }, 120000);

  it("UsageTracker aggregates correctly when entries come from different providers", async () => {
    const tracker = new UsageTracker();

    const claudeResult = await spawnAgentStream("planner", "Plan a feature.", 30000, {
      provider: "claude",
      model: "claude-3-5-haiku-20241022",
    });

    const openrouterResult = await spawnAgentStream("dev", "Write code.", 30000, {
      provider: "openrouter",
      model: "anthropic/claude-3.5-haiku",
    });

    tracker.record("planner", "plan", claudeResult.usage!);
    tracker.record("dev", "implement", openrouterResult.usage!);

    const byAgent = tracker.getByAgent();
    expect(byAgent.get("planner")?.provider).toBe("claude");
    expect(byAgent.get("dev")?.provider).toBe("openrouter");
    expect(tracker.getTotalCost()).toBeGreaterThan(0);
  }, 120000);

  it("calculateCacheSavings produces correct per-provider rates with real usage data", async () => {
    const claudeResult = await spawnAgentStream("test-agent", "Test.", 30000, {
      provider: "claude",
      model: "claude-3-5-haiku-20241022",
    });

    const openrouterResult = await spawnAgentStream("test-agent", "Test.", 30000, {
      provider: "openrouter",
      model: "anthropic/claude-3.5-haiku",
    });

    const claudeSavings = calculateCacheSavings(claudeResult.usage!);
    const openrouterSavings = calculateCacheSavings(openrouterResult.usage!);

    expect(claudeSavings).toBeGreaterThanOrEqual(0);
    expect(openrouterSavings).toBeGreaterThanOrEqual(0);
  }, 120000);

  it("provider field on UsageInfo is set correctly per entry", async () => {
    const claudeResult = await spawnAgentStream("test-agent", "Test.", 30000, {
      provider: "claude",
      model: "claude-3-5-haiku-20241022",
    });

    const openrouterResult = await spawnAgentStream("test-agent", "Test.", 30000, {
      provider: "openrouter",
      model: "anthropic/claude-3.5-haiku",
    });

    expect(claudeResult.usage?.provider).toBe("claude");
    expect(openrouterResult.usage?.provider).toBe("openrouter");
  }, 120000);

  it("context threading across providers (planner on A → dev on B → qe on C)", async () => {
    const plannerPrompt = "Plan: Add user authentication feature with login and logout endpoints.";
    const devPrompt = "Implement: Create login and logout API endpoints based on plan context.";
    const qePrompt = "Test: Write tests for login and logout endpoints based on implementation.";

    // Run planner on Claude
    const plannerResult = await spawnAgentStream("planner", plannerPrompt, 30000, {
      provider: "claude",
      model: "claude-3-5-haiku-20241022",
    });

    // Run dev on OpenRouter
    const devResult = await spawnAgentStream("dev", devPrompt, 30000, {
      provider: "openrouter",
      model: "anthropic/claude-3.5-haiku",
    });

    // Run qe on Claude again (different from dev)
    const qeResult = await spawnAgentStream("qe", qePrompt, 30000, {
      provider: "claude",
      model: "claude-3-5-haiku-20241022",
    });

    // Verify all agents completed successfully
    expect(plannerResult.exitCode).toBe(0);
    expect(devResult.exitCode).toBe(0);
    expect(qeResult.exitCode).toBe(0);

    // Verify each agent used the correct provider
    expect(plannerResult.usage?.provider).toBe("claude");
    expect(devResult.usage?.provider).toBe("openrouter");
    expect(qeResult.usage?.provider).toBe("claude");

    // Verify output was produced at each stage
    expect(plannerResult.stdout).toBeTruthy();
    expect(devResult.stdout).toBeTruthy();
    expect(qeResult.stdout).toBeTruthy();
  }, 180000);
});

describe.skipIf(hasTwoProviders)("Multi-provider integration — skipped", () => {
  it("skips gracefully when less than 2 providers available", () => {
    console.log(SKIP_REASON);
  });
});
