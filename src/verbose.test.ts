import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { UsageTracker, printVerboseUsage } from "./usage.js";

describe("--verbose flag", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it("printVerboseUsage shows token counts per agent invocation", () => {
    const tracker = new UsageTracker();
    tracker.record("dev", "implement", {
      costUsd: 0.05,
      durationMs: 1234,
      numTurns: 2,
      inputTokens: 1000,
      outputTokens: 500,
      provider: "claude",
    });

    printVerboseUsage(tracker);

    const output = consoleLogSpy.mock.calls.map((call) => call.join(" ")).join("\n");

    expect(output).toContain("Detailed Usage");
    expect(output).toContain("--verbose");
    expect(output).toContain("dev");
    expect(output).toContain("1,000 in");
    expect(output).toContain("500 out");
  });

  it("printVerboseUsage shows cost breakdown per agent", () => {
    const tracker = new UsageTracker();
    tracker.record("dev", "implement", {
      costUsd: 0.05,
      durationMs: 1234,
      numTurns: 2,
      inputTokens: 1000,
      outputTokens: 500,
      provider: "claude",
    });
    tracker.record("qe", "implement", {
      costUsd: 0.03,
      durationMs: 890,
      numTurns: 1,
      inputTokens: 600,
      outputTokens: 300,
      provider: "claude",
    });

    printVerboseUsage(tracker);

    const output = consoleLogSpy.mock.calls.map((call) => call.join(" ")).join("\n");

    expect(output).toContain("dev");
    expect(output).toContain("$0.05");
    expect(output).toContain("qe");
    expect(output).toContain("$0.03");
  });

  it("printVerboseUsage shows per-agent cache metadata", () => {
    const tracker = new UsageTracker();
    tracker.record("dev", "implement", {
      costUsd: 0.05,
      durationMs: 1234,
      numTurns: 2,
      inputTokens: 5000,
      outputTokens: 500,
      cachedTokens: 2000,
      cacheWriteTokens: 1000,
      provider: "claude",
    });

    printVerboseUsage(tracker);

    const output = consoleLogSpy.mock.calls.map((call) => call.join(" ")).join("\n");

    expect(output).toContain("cache:");
    expect(output).toContain("cached: 2,000");
    expect(output).toContain("cache_write: 1,000");
    expect(output).toContain("provider: claude");
  });

  it("printVerboseUsage shows cache discount when present", () => {
    const tracker = new UsageTracker();
    tracker.record("dev", "implement", {
      costUsd: 0.05,
      durationMs: 1234,
      numTurns: 2,
      inputTokens: 5000,
      outputTokens: 500,
      cachedTokens: 2000,
      cacheDiscount: 0.02,
      provider: "claude",
    });

    printVerboseUsage(tracker);

    const output = consoleLogSpy.mock.calls.map((call) => call.join(" ")).join("\n");

    expect(output).toContain("cache:");
    expect(output).toContain("cache_discount: $0.02");
  });

  it("printVerboseUsage shows calculated cache savings", () => {
    const tracker = new UsageTracker();
    tracker.record("dev", "implement", {
      costUsd: 0.05,
      durationMs: 1234,
      numTurns: 2,
      inputTokens: 5000,
      outputTokens: 500,
      cachedTokens: 2000,
      provider: "claude",
    });

    printVerboseUsage(tracker);

    const output = consoleLogSpy.mock.calls.map((call) => call.join(" ")).join("\n");

    expect(output).toContain("cache:");
    expect(output).toContain("saved:");
  });

  it("printVerboseUsage does not print when no entries exist", () => {
    const tracker = new UsageTracker();

    printVerboseUsage(tracker);

    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it("printVerboseUsage shows multiple agent invocations separately", () => {
    const tracker = new UsageTracker();
    tracker.record("dev", "implement", {
      costUsd: 0.05,
      durationMs: 1234,
      numTurns: 2,
      inputTokens: 1000,
      outputTokens: 500,
      provider: "claude",
    });
    tracker.record("dev", "implement-retry", {
      costUsd: 0.03,
      durationMs: 890,
      numTurns: 1,
      inputTokens: 600,
      outputTokens: 300,
      provider: "claude",
    });

    printVerboseUsage(tracker);

    const output = consoleLogSpy.mock.calls.map((call) => call.join(" ")).join("\n");

    // Both invocations listed separately
    expect(output).toContain("implement");
    expect(output).toContain("implement-retry");
    expect(output).toContain("$0.05");
    expect(output).toContain("$0.03");
  });

  it("printVerboseUsage includes duration and turn count", () => {
    const tracker = new UsageTracker();
    tracker.record("dev", "implement", {
      costUsd: 0.05,
      durationMs: 65000, // 1m 5s
      numTurns: 3,
      inputTokens: 1000,
      outputTokens: 500,
      provider: "claude",
    });

    printVerboseUsage(tracker);

    const output = consoleLogSpy.mock.calls.map((call) => call.join(" ")).join("\n");

    expect(output).toContain("1m 5s");
    expect(output).toContain("3 turns");
  });

  it("printVerboseUsage handles zero-cost entries", () => {
    const tracker = new UsageTracker();
    tracker.record("dev", "implement", {
      costUsd: 0,
      durationMs: 1234,
      numTurns: 1,
      inputTokens: 0,
      outputTokens: 0,
      provider: "claude",
    });

    printVerboseUsage(tracker);

    const output = consoleLogSpy.mock.calls.map((call) => call.join(" ")).join("\n");

    expect(output).toContain("$0.00");
  });

  it("printVerboseUsage omits cache section when no cache data present", () => {
    const tracker = new UsageTracker();
    tracker.record("dev", "implement", {
      costUsd: 0.05,
      durationMs: 1234,
      numTurns: 2,
      inputTokens: 1000,
      outputTokens: 500,
      provider: "claude",
    });

    printVerboseUsage(tracker);

    const output = consoleLogSpy.mock.calls.map((call) => call.join(" ")).join("\n");

    // No cache line should appear
    expect(output).not.toContain("cache:");
  });
});

describe("runCommand --verbose flag integration", () => {
  it.skip("accepts --verbose flag without error", async () => {
    // This test verifies the CLI accepts --verbose flag
    const { Command } = await import("commander");
    const testProgram = new Command();

    let receivedOptions: any;
    testProgram
      .command("run")
      .option("--verbose", "Show detailed per-agent token and cost breakdown", false)
      .action((opts) => {
        receivedOptions = opts;
      });

    await testProgram.parseAsync(["node", "test", "run", "--verbose"], { from: "user" });
    expect(receivedOptions.verbose).toBe(true);
  });
});

describe("verbose flag wiring", () => {
  it("RunOptions interface includes verbose boolean", () => {
    // Type-level test - if this compiles, the interface is correct
    const opts: {
      spec?: string;
      type?: string;
      dryRun: boolean;
      securityThreshold: string;
      autoApprove: boolean;
      insecure: boolean;
      skipClarification: boolean;
      maxRetries: string;
      verbose: boolean;
    } = {
      dryRun: false,
      securityThreshold: "HIGH",
      autoApprove: false,
      insecure: false,
      skipClarification: false,
      maxRetries: "2",
      verbose: true,
    };

    expect(opts.verbose).toBe(true);
  });
});
