import { describe, it, expect, beforeEach } from "vitest";
import {
  setTelemetryOverride,
  getTelemetryOverride,
  resetTelemetryOverride,
  isValidTelemetryLevel,
  resolveTelemetryEnabled,
} from "./telemetry-override.js";

describe("telemetry-override", () => {
  beforeEach(() => {
    resetTelemetryOverride();
  });

  describe("setTelemetryOverride", () => {
    it("sets disabled flag", () => {
      setTelemetryOverride({ disabled: true });
      expect(getTelemetryOverride()).toEqual({ disabled: true });
    });

    it("sets level override", () => {
      setTelemetryOverride({ level: "verbose" });
      expect(getTelemetryOverride()).toEqual({ level: "verbose" });
    });

    it("sets both disabled and level", () => {
      setTelemetryOverride({ disabled: true, level: "minimal" });
      expect(getTelemetryOverride()).toEqual({ disabled: true, level: "minimal" });
    });

    it("replaces previous override", () => {
      setTelemetryOverride({ level: "verbose" });
      setTelemetryOverride({ disabled: true });
      expect(getTelemetryOverride()).toEqual({ disabled: true });
    });
  });

  describe("getTelemetryOverride", () => {
    it("returns empty object when no override set", () => {
      expect(getTelemetryOverride()).toEqual({});
    });

    it("returns current override", () => {
      setTelemetryOverride({ level: "standard" });
      expect(getTelemetryOverride()).toEqual({ level: "standard" });
    });
  });

  describe("resetTelemetryOverride", () => {
    it("clears override", () => {
      setTelemetryOverride({ disabled: true });
      resetTelemetryOverride();
      expect(getTelemetryOverride()).toEqual({});
    });
  });

  describe("isValidTelemetryLevel", () => {
    it("accepts minimal", () => {
      expect(isValidTelemetryLevel("minimal")).toBe(true);
    });

    it("accepts standard", () => {
      expect(isValidTelemetryLevel("standard")).toBe(true);
    });

    it("accepts verbose", () => {
      expect(isValidTelemetryLevel("verbose")).toBe(true);
    });

    it("rejects invalid level", () => {
      expect(isValidTelemetryLevel("debug")).toBe(false);
      expect(isValidTelemetryLevel("full")).toBe(false);
      expect(isValidTelemetryLevel("")).toBe(false);
    });

    it("case sensitive", () => {
      expect(isValidTelemetryLevel("VERBOSE")).toBe(false);
      expect(isValidTelemetryLevel("Minimal")).toBe(false);
    });
  });

  describe("resolveTelemetryEnabled", () => {
    it("disables when override.disabled=true, ignores config", () => {
      const result = resolveTelemetryEnabled(
        { disabled: true },
        { telemetry: { enabled: true, level: "standard" } }
      );
      expect(result.enabled).toBe(false);
      expect(result.level).toBe("standard");
    });

    it("uses config.enabled when no override.disabled", () => {
      const result = resolveTelemetryEnabled(
        {},
        { telemetry: { enabled: true, level: "minimal" } }
      );
      expect(result.enabled).toBe(true);
      expect(result.level).toBe("minimal");
    });

    it("defaults enabled=false when config.enabled undefined", () => {
      const result = resolveTelemetryEnabled(
        {},
        { telemetry: { level: "standard" } }
      );
      expect(result.enabled).toBe(false);
      expect(result.level).toBe("standard");
    });

    it("override.level takes precedence over config.level", () => {
      const result = resolveTelemetryEnabled(
        { level: "verbose" },
        { telemetry: { enabled: true, level: "minimal" } }
      );
      expect(result.enabled).toBe(true);
      expect(result.level).toBe("verbose");
    });

    it("uses DEFAULT_TELEMETRY_CONFIG.level when neither override nor config provide level", () => {
      const result = resolveTelemetryEnabled(
        {},
        { telemetry: { enabled: true } }
      );
      expect(result.enabled).toBe(true);
      expect(result.level).toBe("standard"); // DEFAULT_TELEMETRY_CONFIG.level
    });

    it("override.disabled=true and override.level both applied", () => {
      const result = resolveTelemetryEnabled(
        { disabled: true, level: "verbose" },
        { telemetry: { enabled: true, level: "minimal" } }
      );
      expect(result.enabled).toBe(false);
      expect(result.level).toBe("verbose"); // level still resolved even when disabled
    });

    it("handles empty config gracefully", () => {
      const result = resolveTelemetryEnabled({}, {});
      expect(result.enabled).toBe(false);
      expect(result.level).toBe("standard");
    });

    it("handles config with no telemetry key", () => {
      const result = resolveTelemetryEnabled({ level: "minimal" }, {});
      expect(result.enabled).toBe(false);
      expect(result.level).toBe("minimal");
    });
  });
});
