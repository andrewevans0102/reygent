import { describe, it, expect } from "vitest";
import { parseSpecWithPrefix, SpecPrefixError } from "./spec-prefix.js";

describe("parseSpecWithPrefix", () => {
  describe("explicit prefixes", () => {
    it("parses jira: prefix", () => {
      const result = parseSpecWithPrefix("jira:ENG-123");
      expect(result).toEqual({ provider: "jira", identifier: "ENG-123" });
    });

    it("parses linear: prefix", () => {
      const result = parseSpecWithPrefix("linear:DT-275");
      expect(result).toEqual({ provider: "linear", identifier: "DT-275" });
    });

    it("parses markdown: prefix", () => {
      const result = parseSpecWithPrefix("markdown:./test-spec.md");
      expect(result).toEqual({ provider: "local", identifier: "./test-spec.md" });
    });

    it("handles source with multiple colons", () => {
      const result = parseSpecWithPrefix("jira:ENG-123:extra");
      expect(result).toEqual({ provider: "jira", identifier: "ENG-123:extra" });
    });
  });

  describe("file path auto-detection", () => {
    it("auto-detects .md extension", () => {
      const result = parseSpecWithPrefix("spec.md");
      expect(result).toEqual({ provider: "local", identifier: "spec.md" });
    });

    it("auto-detects .markdown extension", () => {
      const result = parseSpecWithPrefix("spec.markdown");
      expect(result).toEqual({ provider: "local", identifier: "spec.markdown" });
    });

    it("auto-detects .MD extension (case insensitive)", () => {
      const result = parseSpecWithPrefix("spec.MD");
      expect(result).toEqual({ provider: "local", identifier: "spec.MD" });
    });

    it("auto-detects ./ prefix", () => {
      const result = parseSpecWithPrefix("./specs/test.txt");
      expect(result).toEqual({ provider: "local", identifier: "./specs/test.txt" });
    });

    it("auto-detects / prefix", () => {
      const result = parseSpecWithPrefix("/abs/path/spec.txt");
      expect(result).toEqual({ provider: "local", identifier: "/abs/path/spec.txt" });
    });

    it("auto-detects complex path with .md", () => {
      const result = parseSpecWithPrefix("./docs/specs/feature.md");
      expect(result).toEqual({ provider: "local", identifier: "./docs/specs/feature.md" });
    });
  });

  describe("error cases", () => {
    it("throws for missing prefix on non-file path", () => {
      expect(() => parseSpecWithPrefix("ENG-123")).toThrow(SpecPrefixError);
      expect(() => parseSpecWithPrefix("ENG-123")).toThrow(/Source prefix required/);
    });

    it("throws for invalid prefix", () => {
      expect(() => parseSpecWithPrefix("github:owner/repo")).toThrow(SpecPrefixError);
      expect(() => parseSpecWithPrefix("github:owner/repo")).toThrow(/Invalid prefix/);
    });

    it("throws for empty source after prefix", () => {
      expect(() => parseSpecWithPrefix("jira:")).toThrow(SpecPrefixError);
      expect(() => parseSpecWithPrefix("jira:")).toThrow(/Empty source/);
    });

    it("throws for whitespace-only source after prefix", () => {
      expect(() => parseSpecWithPrefix("linear:   ")).toThrow(SpecPrefixError);
      expect(() => parseSpecWithPrefix("linear:   ")).toThrow(/Empty source/);
    });

    it("error message includes usage examples", () => {
      try {
        parseSpecWithPrefix("PROJ-456");
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(SpecPrefixError);
        const msg = (err as Error).message;
        expect(msg).toContain("jira:");
        expect(msg).toContain("linear:");
        expect(msg).toContain("markdown:");
      }
    });
  });

  describe("edge cases", () => {
    it("preserves source content exactly", () => {
      const result = parseSpecWithPrefix("jira:ENG-123 with spaces");
      expect(result.identifier).toBe("ENG-123 with spaces");
    });

    it("handles source starting with whitespace", () => {
      const result = parseSpecWithPrefix("linear: DT-275");
      expect(result.identifier).toBe(" DT-275");
    });

    it("handles complex file paths", () => {
      const result = parseSpecWithPrefix("./path/to/my-spec-file.md");
      expect(result).toEqual({ provider: "local", identifier: "./path/to/my-spec-file.md" });
    });
  });
});
