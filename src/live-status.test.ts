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
});
