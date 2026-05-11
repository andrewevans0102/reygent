/**
 * Unit tests for terminal-reset module.
 * Verifies that resetTerminalForInput properly resets terminal state.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetTerminalForInput } from "./terminal-reset.js";

describe("resetTerminalForInput", () => {
  let writeCalls: string[] = [];
  let originalWrite: typeof process.stdout.write;
  let originalIsTTY: boolean;
  let rawModeState: boolean | undefined;
  let isPaused: boolean;

  beforeEach(() => {
    writeCalls = [];
    originalWrite = process.stdout.write;
    originalIsTTY = process.stdin.isTTY;

    // Mock stdout.write to capture escape sequences
    process.stdout.write = ((data: any): boolean => {
      writeCalls.push(String(data));
      return true;
    }) as typeof process.stdout.write;

    // Set up stdin mocks
    process.stdin.isTTY = true;
    rawModeState = undefined;
    isPaused = true;

    Object.defineProperty(process.stdin, "isRaw", {
      get: () => rawModeState,
      configurable: true,
    });

    // Mock isPaused as a function to match Node.js API
    (process.stdin as any).isPaused = () => isPaused;

    process.stdin.setRawMode = (mode: boolean) => {
      rawModeState = mode;
      return process.stdin;
    };
  });

  afterEach(() => {
    process.stdout.write = originalWrite;
    process.stdin.isTTY = originalIsTTY;
  });

  it("should reset SGR text attributes", () => {
    resetTerminalForInput();
    expect(writeCalls).toContain("\x1b[0m");
  });

  it("should show cursor", () => {
    resetTerminalForInput();
    expect(writeCalls).toContain("\x1b[?25h");
  });

  it("should clear entire line and move to column 0", () => {
    resetTerminalForInput();
    expect(writeCalls).toContain("\r\x1b[2K");
  });

  it("should emit all escape sequences in correct order", () => {
    resetTerminalForInput();
    expect(writeCalls).toEqual([
      "\x1b[0m",      // Reset SGR
      "\x1b[?25h",    // Show cursor
      "\r\x1b[2K",    // Clear line
    ]);
  });

  it("should disable raw mode when stdin is paused and raw", () => {
    rawModeState = true;
    isPaused = true;

    resetTerminalForInput();

    expect(rawModeState).toBe(false);
  });

  it("should not disable raw mode when stdin is not paused", () => {
    rawModeState = true;
    isPaused = false;

    resetTerminalForInput();

    expect(rawModeState).toBe(true);
  });

  it("should not disable raw mode when stdin is not raw", () => {
    rawModeState = false;
    isPaused = true;

    resetTerminalForInput();

    expect(rawModeState).toBe(false);
  });

  it("should not call setRawMode when stdin is not TTY", () => {
    process.stdin.isTTY = false;
    let setRawModeCalled = false;

    process.stdin.setRawMode = () => {
      setRawModeCalled = true;
      return process.stdin;
    };

    resetTerminalForInput();

    expect(setRawModeCalled).toBe(false);
  });

  it("should emit escape sequences even when stdin is not TTY", () => {
    process.stdin.isTTY = false;

    resetTerminalForInput();

    expect(writeCalls).toEqual([
      "\x1b[0m",
      "\x1b[?25h",
      "\r\x1b[2K",
    ]);
  });
});
