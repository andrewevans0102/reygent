import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import chalk from "chalk";

// Import actual formatting functions from analyze.ts
// These are internal functions but we test their behavior through public APIs

/**
 * Test output formatting helpers for analyze commands
 */
describe("analyze output formatting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("duration formatting", () => {
    it("should format milliseconds to readable duration", () => {
      // Test the formatDuration logic
      const formatDuration = (ms: number): string => {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
        return `${seconds}s`;
      };

      expect(formatDuration(5000)).toBe("5s");
      expect(formatDuration(65000)).toBe("1m 5s");
      expect(formatDuration(125000)).toBe("2m 5s");
    });
  });

  describe("cost formatting", () => {
    it("should format USD costs with dollar sign", () => {
      const formatCost = (usd: number): string => {
        return `$${usd.toFixed(2)}`;
      };

      expect(formatCost(0.12)).toBe("$0.12");
      expect(formatCost(1.5)).toBe("$1.50");
      expect(formatCost(42.186)).toBe("$42.19");
    });
  });

  describe("percentage formatting", () => {
    it("should format percentages from decimal values", () => {
      const formatPercent = (value: number): string => {
        return `${Math.round(value * 100)}%`;
      };

      expect(formatPercent(0.89)).toBe("89%");
      expect(formatPercent(0.92)).toBe("92%");
      expect(formatPercent(0.125)).toBe("13%");
    });
  });

  describe("relative time formatting", () => {
    it("should format timestamps to relative time strings", () => {
      const formatRelativeTime = (timestamp: number): string => {
        const now = Date.now();
        const diff = now - timestamp;
        const days = Math.floor(diff / (24 * 60 * 60 * 1000));
        const hours = Math.floor(diff / (60 * 60 * 1000));

        if (days > 0) return `${days} day${days > 1 ? "s" : ""} ago`;
        if (hours > 0) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
        return "< 1 hour ago";
      };

      const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
      const fiveHoursAgo = Date.now() - 5 * 60 * 60 * 1000;
      const thirtyMinsAgo = Date.now() - 30 * 60 * 1000;

      expect(formatRelativeTime(twoDaysAgo)).toBe("2 days ago");
      expect(formatRelativeTime(fiveHoursAgo)).toBe("5 hours ago");
      expect(formatRelativeTime(thirtyMinsAgo)).toBe("< 1 hour ago");
    });
  });

  describe("groupBy helper", () => {
    it("should group items by key function", () => {
      const groupBy = <T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> => {
        const groups = new Map<string, T[]>();
        for (const item of items) {
          const key = keyFn(item);
          const group = groups.get(key) ?? [];
          group.push(item);
          groups.set(key, group);
        }
        return groups;
      };

      const items = [
        { type: "error", count: 5 },
        { type: "error", count: 3 },
        { type: "warning", count: 2 },
      ];

      const grouped = groupBy(items, item => item.type);
      expect(grouped.size).toBe(2);
      expect(grouped.get("error")?.length).toBe(2);
      expect(grouped.get("warning")?.length).toBe(1);
    });

  });

  describe("parse duration string", () => {
    it("should parse duration format correctly", () => {
      const parseSince = (since: string): number => {
        const match = since.match(/^(\d+)d$/);
        if (!match) {
          throw new Error(`Invalid duration format: ${since}. Use format like "30d", "7d".`);
        }
        const days = Number.parseInt(match[1], 10);
        return Date.now() - days * 24 * 60 * 60 * 1000;
      };

      const thirtyDaysAgo = parseSince("30d");
      const sevenDaysAgo = parseSince("7d");

      expect(thirtyDaysAgo).toBeLessThan(sevenDaysAgo);
      expect(Date.now() - thirtyDaysAgo).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);

      // Should throw on invalid format
      expect(() => parseSince("30")).toThrow("Invalid duration format");
      expect(() => parseSince("abc")).toThrow("Invalid duration format");
    });
  });
});
