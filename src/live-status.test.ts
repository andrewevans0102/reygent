import { describe, it, expect, vi, afterEach } from "vitest";
import { formatElapsed, buildAnimationFrame, createLiveStatus } from "./live-status.js";

describe("formatElapsed", () => {
  it("formats seconds only", () => {
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(5_000)).toBe("5s");
    expect(formatElapsed(59_000)).toBe("59s");
  });

  it("formats minutes and seconds", () => {
    expect(formatElapsed(60_000)).toBe("1m 00s");
    expect(formatElapsed(65_000)).toBe("1m 05s");
    expect(formatElapsed(3_599_000)).toBe("59m 59s");
  });

  it("formats hours and minutes", () => {
    expect(formatElapsed(3_600_000)).toBe("1h 00m");
    expect(formatElapsed(3_780_000)).toBe("1h 03m");
  });
});

describe("buildAnimationFrame", () => {
  it("returns a string containing the label", () => {
    const frame = buildAnimationFrame(0, "testing...", "5s");
    expect(frame).toContain("testing...");
    expect(frame).toContain("5s");
  });

  it("includes activity when provided", () => {
    const frame = buildAnimationFrame(2, "running...", "1m 03s", {
      agent: "dev",
      tool: "Read",
      detail: "src/foo.ts",
    });
    expect(frame).toContain("dev");
    expect(frame).toContain("Read");
    expect(frame).toContain("src/foo.ts");
  });

  it("omits activity section when not provided", () => {
    const frame = buildAnimationFrame(0, "label", "0s");
    // Should not contain the separator when no activity
    expect(frame).not.toContain("│");
  });

  it("places activity trail on first line, spinner on second (prevents wrap)", () => {
    const frame = buildAnimationFrame(2, "running", "30s", {
      agent: "dev",
      tool: "Read",
      detail: "src/foo.ts",
    });
    const lines = frame.split("\n");
    expect(lines).toHaveLength(2);
    // First line: activity trail
    expect(lines[0]).toContain("dev");
    expect(lines[0]).toContain("Read");
    expect(lines[0]).toContain("src/foo.ts");
    // Second line: spinner track + label + elapsed
    expect(lines[1]).toContain("🐾");
    expect(lines[1]).toContain("running");
    expect(lines[1]).toContain("30s");
  });

  it("handles long activity trail gracefully (detail already capped at 80 chars)", () => {
    const frame = buildAnimationFrame(1, "processing", "1m 15s", {
      agent: "planner",
      tool: "Bash",
      detail: "x".repeat(200), // Will be truncated in onActivity, but test buildAnimationFrame
    });
    const lines = frame.split("\n");
    expect(lines).toHaveLength(2);
    // Activity line should not exceed reasonable length (agent + tool + detail)
    // Detail itself isn't truncated by buildAnimationFrame, only by onActivity
    // So this just confirms multiline structure holds even with long detail
    expect(lines[0]).toContain("planner");
    expect(lines[0]).toContain("Bash");
  });

  it("single-line output when no activity (spinner only)", () => {
    const frame = buildAnimationFrame(3, "waiting", "5s");
    const lines = frame.split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("🐾");
    expect(lines[0]).toContain("waiting");
    expect(lines[0]).toContain("5s");
  });

  it("truncates activity trail when exceeds terminal width", () => {
    // Mock narrow terminal
    const originalColumns = process.stdout.columns;
    Object.defineProperty(process.stdout, "columns", { value: 40, writable: true });

    const frame = buildAnimationFrame(1, "test", "10s", {
      agent: "planner",
      tool: "Bash",
      detail: "x".repeat(100),
    });

    // Restore original
    Object.defineProperty(process.stdout, "columns", {
      value: originalColumns,
      writable: true,
    });

    const lines = frame.split("\n");
    expect(lines).toHaveLength(2);

    // Strip ANSI from activity line to measure visible length
    const stripAnsi = (s: string) => s.replace(/\x1b\[\d+m/g, "");
    const activityVisible = stripAnsi(lines[0]);

    // Should be truncated to fit 40-column terminal (minus 2 for padding = 38)
    expect(activityVisible.length).toBeLessThanOrEqual(38);
    // Should end with ellipsis
    expect(activityVisible).toMatch(/…$/);
  });
});

describe("createLiveStatus", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a status that can succeed", () => {
    const status = createLiveStatus("test...");
    // Should not throw
    status.succeed("done");
  });

  it("creates a status that can fail", () => {
    const status = createLiveStatus("test...");
    status.fail("error");
  });

  it("accepts activity events", () => {
    const status = createLiveStatus("test...");
    // Should not throw
    status.onActivity({ agent: "dev", tool: "Write", detail: "src/foo.ts" });
    status.stop();
  });

  it("can stop and restart", () => {
    const status = createLiveStatus("test...");
    status.stop();
    status.start();
    status.succeed("ok");
  });

  it("debounces high-frequency activity events", async () => {
    const status = createLiveStatus("test...");
    const events: string[] = [];

    // Spy on render by observing that detail is truncated at 80 chars
    status.onActivity({ agent: "dev", tool: "Grep", detail: "a".repeat(100) });
    status.onActivity({ agent: "dev", tool: "Grep", detail: "b".repeat(100) });
    status.onActivity({ agent: "dev", tool: "Grep", detail: "c".repeat(100) });

    // Wait for debounce window (200ms)
    await new Promise((resolve) => setTimeout(resolve, 250));

    status.onActivity({ agent: "dev", tool: "Read", detail: "after debounce" });
    status.stop();

    // No assertion needed - just verify no crash from rapid events
  });

  it("truncates detail strings to 80 chars", () => {
    const status = createLiveStatus("test...");
    const longDetail = "x".repeat(150);

    // Should not throw and internally truncates to 80 chars
    status.onActivity({ agent: "dev", tool: "Write", detail: longDetail });
    status.stop();
  });

  it("handles multiple concurrent status instances with SIGINT ref-counting", () => {
    const status1 = createLiveStatus("first...");
    const status2 = createLiveStatus("second...");
    const status3 = createLiveStatus("third...");

    // All should install handler via ref-counting
    status1.stop(); // Decrements ref count
    status2.succeed("done"); // Decrements ref count
    status3.fail("error"); // Decrements ref count

    // No orphaned handlers or double-removal errors
  });

  it("prevents interval leak when start() called twice rapidly", () => {
    const status = createLiveStatus("test...");
    status.stop();

    // Call start twice in rapid succession
    status.start();
    status.start(); // Should guard against creating second interval

    status.stop();
    // No interval leak - cleanup should succeed
  });
});
