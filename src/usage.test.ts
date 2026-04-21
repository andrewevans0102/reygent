import { describe, it, expect, vi } from "vitest";
import { UsageTracker, formatDuration, printUsageSummary } from "./usage.js";

describe("UsageTracker", () => {
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
  });

  it("getEntries returns a copy", () => {
    const tracker = new UsageTracker();
    tracker.record("dev", "implement", { costUsd: 0.01 });
    const entries = tracker.getEntries();
    entries.pop();
    expect(tracker.getEntries().length).toBe(1);
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
});
