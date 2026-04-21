import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setDebug, isDebug } from "./debug.js";

describe("debug", () => {
  let origEnv: string | undefined;

  beforeEach(() => {
    origEnv = process.env.REYGENT_DEBUG;
    delete process.env.REYGENT_DEBUG;
    setDebug(false);
  });

  afterEach(() => {
    if (origEnv !== undefined) {
      process.env.REYGENT_DEBUG = origEnv;
    } else {
      delete process.env.REYGENT_DEBUG;
    }
  });

  it("defaults to false", () => {
    expect(isDebug()).toBe(false);
  });

  it("setDebug(true) enables debug", () => {
    setDebug(true);
    expect(isDebug()).toBe(true);
  });

  it("setDebug(false) disables debug", () => {
    setDebug(true);
    setDebug(false);
    expect(isDebug()).toBe(false);
  });

  it("env var REYGENT_DEBUG=1 enables debug", () => {
    process.env.REYGENT_DEBUG = "1";
    expect(isDebug()).toBe(true);
  });

  it("env var REYGENT_DEBUG=0 does not enable debug", () => {
    process.env.REYGENT_DEBUG = "0";
    expect(isDebug()).toBe(false);
  });

  it("env var overrides setDebug(false)", () => {
    setDebug(false);
    process.env.REYGENT_DEBUG = "1";
    expect(isDebug()).toBe(true);
  });
});
