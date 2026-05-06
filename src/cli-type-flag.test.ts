import { describe, it, expect } from "vitest";
import { normalizeType, type BranchType } from "./branch-type.js";

/**
 * Tests for --type CLI flag parsing and validation
 *
 * Tests cover:
 * - Flag acceptance for valid types
 * - Validation errors for invalid types
 * - Case insensitivity
 * - Long-form aliases (feature/bugfix)
 * - Error messages
 */

// Adapter for tests - production code is normalizeType
function parseTypeFlag(flag: string): BranchType {
  return normalizeType(flag);
}

describe("--type CLI flag", () => {
  describe("valid type values", () => {
    it("accepts feat", () => {
      expect(parseTypeFlag("feat")).toBe("feat");
    });

    it("accepts fix", () => {
      expect(parseTypeFlag("fix")).toBe("fix");
    });

    it("accepts chore", () => {
      expect(parseTypeFlag("chore")).toBe("chore");
    });

    it("accepts refactor", () => {
      expect(parseTypeFlag("refactor")).toBe("refactor");
    });

    it("accepts docs", () => {
      expect(parseTypeFlag("docs")).toBe("docs");
    });

    it("accepts test", () => {
      expect(parseTypeFlag("test")).toBe("test");
    });

    it("accepts style", () => {
      expect(parseTypeFlag("style")).toBe("style");
    });

    it("accepts perf", () => {
      expect(parseTypeFlag("perf")).toBe("perf");
    });
  });

  describe("long-form aliases", () => {
    it("accepts feature and normalizes to feat", () => {
      expect(parseTypeFlag("feature")).toBe("feat");
    });

    it("accepts bugfix and normalizes to fix", () => {
      expect(parseTypeFlag("bugfix")).toBe("fix");
    });
  });

  describe("case insensitivity", () => {
    it("accepts uppercase FEAT", () => {
      expect(parseTypeFlag("FEAT")).toBe("feat");
    });

    it("accepts mixed case Fix", () => {
      expect(parseTypeFlag("Fix")).toBe("fix");
    });

    it("accepts uppercase FEATURE", () => {
      expect(parseTypeFlag("FEATURE")).toBe("feat");
    });

    it("accepts mixed case Bugfix", () => {
      expect(parseTypeFlag("Bugfix")).toBe("fix");
    });
  });

  describe("invalid type values", () => {
    it("rejects empty string", () => {
      expect(() => parseTypeFlag("")).toThrow(/invalid.*type/i);
    });

    it("rejects unknown type", () => {
      expect(() => parseTypeFlag("unknown")).toThrow(/invalid.*type/i);
    });

    it("rejects hotfix", () => {
      expect(() => parseTypeFlag("hotfix")).toThrow(/invalid.*type/i);
    });

    it("rejects reygent prefix", () => {
      expect(() => parseTypeFlag("reygent")).toThrow(/invalid.*type/i);
    });

    it("rejects build type (not in conventional list)", () => {
      expect(() => parseTypeFlag("build")).toThrow(/invalid.*type/i);
    });

    it("rejects ci type (not in conventional list)", () => {
      expect(() => parseTypeFlag("ci")).toThrow(/invalid.*type/i);
    });
  });

  describe("error messages", () => {
    it("includes type name in error message", () => {
      expect(() => parseTypeFlag("invalid")).toThrow(/invalid/i);
    });

    it("suggests valid types in error", () => {
      try {
        parseTypeFlag("bad");
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err instanceof Error ? err.message : "").toMatch(/feat|fix|chore/i);
      }
    });
  });

  describe("whitespace handling", () => {
    it("trims leading whitespace", () => {
      expect(parseTypeFlag("  feat")).toBe("feat");
    });

    it("trims trailing whitespace", () => {
      expect(parseTypeFlag("feat  ")).toBe("feat");
    });

    it("trims both leading and trailing whitespace", () => {
      expect(parseTypeFlag("  fix  ")).toBe("fix");
    });

    it("rejects type with internal spaces", () => {
      expect(() => parseTypeFlag("fe at")).toThrow(/invalid.*type/i);
    });
  });
});

describe("type flag integration", () => {
  it("overrides auto-detected type from jira", () => {
    const opts = { typeFlag: "fix", detectedType: "feat" };
    const result = resolveType(opts);
    expect(result).toBe("fix");
  });

  it("overrides auto-detected type from linear", () => {
    const opts = { typeFlag: "chore", detectedType: "feat" };
    const result = resolveType(opts);
    expect(result).toBe("chore");
  });

  it("uses flag when no detection available", () => {
    const opts = { typeFlag: "docs", detectedType: null };
    const result = resolveType(opts);
    expect(result).toBe("docs");
  });

  it("returns null when no flag and no detection", () => {
    const opts = { typeFlag: null, detectedType: null };
    const result = resolveType(opts);
    expect(result).toBeNull();
  });

  it("uses detected type when no flag", () => {
    const opts = { typeFlag: null, detectedType: "feat" };
    const result = resolveType(opts);
    expect(result).toBe("feat");
  });
});

// Integration helper for testing resolution priority
function resolveType(opts: { typeFlag: string | null; detectedType: BranchType | null }): BranchType | null {
  if (opts.typeFlag) {
    return parseTypeFlag(opts.typeFlag);
  }
  return opts.detectedType;
}
