import { describe, it, expect, beforeEach } from "vitest";
import {
  setTelemetryOverride,
  getTelemetryOverride,
  resetTelemetryOverride,
  isValidTelemetryLevel,
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
});
