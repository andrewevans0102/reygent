import { describe, it, expect } from "vitest";
import { wrapText } from "./format.js";
import chalk from "chalk";

describe("wrapText", () => {
  it("returns original text if it fits within maxWidth", () => {
    const text = "Short text";
    const result = wrapText(text, 2, 80);
    expect(result).toBe(text);
  });

  it("wraps text that exceeds available width", () => {
    const text = "This is a very long sentence that should be wrapped at the appropriate column width";
    const result = wrapText(text, 0, 40);
    expect(result).toContain("\n");
    // Each line should be <= 40 chars (accounting for ANSI)
    const lines = result.split("\n");
    for (const line of lines) {
      expect(line.replace(/\x1b\[[0-9;]*m/g, "").length).toBeLessThanOrEqual(40);
    }
  });

  it("preserves indentation on continuation lines with spaces", () => {
    const text = "This is a long text that should wrap onto multiple lines";
    const result = wrapText(text, 4, 30);
    const lines = result.split("\n");
    expect(lines.length).toBeGreaterThan(1);
    // Continuation lines should start with 4 spaces
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i].startsWith("    ")).toBe(true);
    }
  });

  it("uses custom continuation prefix", () => {
    const text = "This is a long text that should wrap onto multiple lines";
    const prefix = "> ";
    const result = wrapText(text, 2, 30, prefix);
    const lines = result.split("\n");
    expect(lines.length).toBeGreaterThan(1);
    // Continuation lines should start with custom prefix
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i].startsWith(prefix)).toBe(true);
    }
  });

  it("handles text with ANSI color codes", () => {
    const text = chalk.red("This is colored text that should wrap properly");
    const result = wrapText(text, 0, 30);
    // Should wrap based on visible length, not including ANSI codes
    expect(result).toContain("\n");
  });

  it("handles empty string", () => {
    const result = wrapText("", 2, 80);
    expect(result).toBe("");
  });

  it("handles whitespace-only string", () => {
    const result = wrapText("   ", 2, 80);
    expect(result).toBe("   ");
  });

  it("handles null/undefined-like edge cases gracefully", () => {
    // TypeScript won't allow actual null/undefined, but test empty behavior
    const result = wrapText("", 2, 80);
    expect(result).toBe("");
  });

  it("handles very narrow maxWidth", () => {
    const text = "Short";
    const result = wrapText(text, 0, 5);
    // Should still return text (minimum available width enforcement)
    expect(result).toBe(text);
  });

  it("handles very narrow available width (maxWidth - indent)", () => {
    const text = "This is a long sentence that needs wrapping";
    const result = wrapText(text, 2, 10);
    // Should force wrap with minimum available width (10)
    expect(result).toContain("\n");
  });

  it("handles negative indent", () => {
    const text = "Some text";
    const result = wrapText(text, -5, 80);
    // Should normalize negative indent to 0
    expect(result).toBe(text);
  });

  it("handles zero maxWidth", () => {
    const text = "Some text";
    const result = wrapText(text, 0, 0);
    // Should return original text when maxWidth is 0
    expect(result).toBe(text);
  });

  it("handles single word longer than available width", () => {
    const text = "Supercalifragilisticexpialidocious";
    const result = wrapText(text, 0, 20);
    // Single long word should appear on its own line
    expect(result).toBe(text);
  });

  it("splits on word boundaries", () => {
    const text = "Word1 Word2 Word3 Word4";
    const result = wrapText(text, 0, 15);
    const lines = result.split("\n");
    // Should split between words, not mid-word
    for (const line of lines) {
      expect(line.trim()).not.toMatch(/\S\n\S/);
    }
  });

  it("handles text with multiple consecutive spaces", () => {
    const text = "Text  with    multiple     spaces";
    const result = wrapText(text, 0, 80);
    // Should preserve spacing in output
    expect(result).toContain("  ");
  });

  it("wraps at exactly available width boundary", () => {
    const text = "1234567890 1234567890 1234567890";
    const result = wrapText(text, 0, 22);
    const lines = result.split("\n");
    // Should wrap at 22 chars (two 10-char words + space)
    expect(lines[0]).toBe("1234567890 1234567890");
    expect(lines[1]).toBe("1234567890");
  });
});
