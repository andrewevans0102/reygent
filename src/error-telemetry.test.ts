import { describe, it, expect } from "vitest";
import { Events, EVENT_LEVELS, TelemetryLevel } from "./chesstrace/events.js";

describe("error telemetry events", () => {
  describe("error event definitions", () => {
    it("defines ERROR_TASK event", () => {
      expect(Events.ERROR_TASK).toBe("error.task");
    });

    it("defines ERROR_PARSE event", () => {
      expect(Events.ERROR_PARSE).toBe("error.parse");
    });

    it("defines ERROR_PROVIDER event", () => {
      expect(Events.ERROR_PROVIDER).toBe("error.provider");
    });
  });

  describe("error event levels", () => {
    it("sets ERROR_TASK to minimal level", () => {
      expect(EVENT_LEVELS[Events.ERROR_TASK]).toBe(TelemetryLevel.minimal);
    });

    it("sets ERROR_PARSE to minimal level", () => {
      expect(EVENT_LEVELS[Events.ERROR_PARSE]).toBe(TelemetryLevel.minimal);
    });

    it("sets ERROR_PROVIDER to minimal level", () => {
      expect(EVENT_LEVELS[Events.ERROR_PROVIDER]).toBe(TelemetryLevel.minimal);
    });
  });

  describe("event naming convention", () => {
    it("follows error.* naming pattern", () => {
      expect(Events.ERROR_TASK).toMatch(/^error\./);
      expect(Events.ERROR_PARSE).toMatch(/^error\./);
      expect(Events.ERROR_PROVIDER).toMatch(/^error\./);
    });
  });
});
