import { describe, it, expect, vi } from "vitest";

vi.mock("@inquirer/prompts", () => ({ select: vi.fn() }));
vi.mock("./config.js", () => ({ getAgents: vi.fn(() => []) }));
vi.mock("./spawn.js", () => ({ spawnAgentStream: vi.fn() }));
vi.mock("./implement.js", () => ({ spawnAgent: vi.fn() }));

import { extractPRReviewOutput, formatPRReviewOutput } from "./pr-review.js";
import type { PRReviewOutput } from "./task.js";

describe("extractPRReviewOutput", () => {
  it("extracts valid review JSON", () => {
    const input = JSON.stringify({
      summary: "Good PR",
      comments: [{ file: "src/a.ts", line: 10, comment: "Nice" }],
      recommendedActions: ["Ship it"],
    });
    const result = extractPRReviewOutput(input);
    expect(result.summary).toBe("Good PR");
    expect(result.comments).toHaveLength(1);
    expect(result.comments[0].file).toBe("src/a.ts");
    expect(result.comments[0].line).toBe(10);
    expect(result.recommendedActions).toEqual(["Ship it"]);
  });

  it("extracts from fenced block", () => {
    const input = 'Here is my review:\n```json\n{"summary": "OK", "comments": [], "recommendedActions": []}\n```';
    const result = extractPRReviewOutput(input);
    expect(result.summary).toBe("OK");
  });

  it("handles null line in comment", () => {
    const input = JSON.stringify({
      summary: "Review",
      comments: [{ file: "b.ts", line: null, comment: "General" }],
      recommendedActions: [],
    });
    const result = extractPRReviewOutput(input);
    expect(result.comments[0].line).toBeNull();
  });

  it("handles missing line field as null", () => {
    const input = JSON.stringify({
      summary: "Review",
      comments: [{ file: "b.ts", comment: "No line" }],
      recommendedActions: [],
    });
    const result = extractPRReviewOutput(input);
    expect(result.comments[0].line).toBeNull();
  });

  it("throws when no JSON found", () => {
    expect(() => extractPRReviewOutput("no json here")).toThrow(/failed to extract/);
  });

  it("throws when summary missing", () => {
    const input = JSON.stringify({
      comments: [],
      recommendedActions: [],
    });
    // The regex match might not match without summary field
    expect(() => extractPRReviewOutput(input)).toThrow();
  });

  it("throws when comments is not array", () => {
    const input = JSON.stringify({
      summary: "OK",
      comments: "not array",
      recommendedActions: [],
    });
    expect(() => extractPRReviewOutput(input)).toThrow(/comments.*array/i);
  });

  it("throws when comment missing file", () => {
    const input = JSON.stringify({
      summary: "OK",
      comments: [{ comment: "no file" }],
      recommendedActions: [],
    });
    expect(() => extractPRReviewOutput(input)).toThrow(/missing 'file'/);
  });

  it("throws when recommendedActions item not string", () => {
    const input = JSON.stringify({
      summary: "OK",
      comments: [],
      recommendedActions: [42],
    });
    expect(() => extractPRReviewOutput(input)).toThrow(/must be a string/);
  });
});

describe("formatPRReviewOutput", () => {
  it("formats basic output", () => {
    const output: PRReviewOutput = {
      summary: "LGTM",
      comments: [],
      recommendedActions: [],
    };
    const result = formatPRReviewOutput(output);
    expect(result).toContain("## Summary");
    expect(result).toContain("LGTM");
  });

  it("groups comments by file", () => {
    const output: PRReviewOutput = {
      summary: "Review",
      comments: [
        { file: "a.ts", line: 1, comment: "Fix this" },
        { file: "a.ts", line: 5, comment: "And this" },
        { file: "b.ts", line: null, comment: "General" },
      ],
      recommendedActions: [],
    };
    const result = formatPRReviewOutput(output);
    expect(result).toContain("### a.ts");
    expect(result).toContain("### b.ts");
    expect(result).toContain("a.ts:1: Fix this");
    expect(result).toContain("a.ts:5: And this");
  });

  it("includes recommended actions", () => {
    const output: PRReviewOutput = {
      summary: "OK",
      comments: [],
      recommendedActions: ["Add tests", "Update docs"],
    };
    const result = formatPRReviewOutput(output);
    expect(result).toContain("## Recommended Actions");
    expect(result).toContain("Add tests");
    expect(result).toContain("Update docs");
  });

  it("omits comments section when empty", () => {
    const output: PRReviewOutput = {
      summary: "Clean",
      comments: [],
      recommendedActions: [],
    };
    const result = formatPRReviewOutput(output);
    expect(result).not.toContain("## Comments");
  });

  it("omits recommended actions section when empty", () => {
    const output: PRReviewOutput = {
      summary: "Clean",
      comments: [],
      recommendedActions: [],
    };
    const result = formatPRReviewOutput(output);
    expect(result).not.toContain("## Recommended Actions");
  });

  it("shows line ref only when line not null", () => {
    const output: PRReviewOutput = {
      summary: "x",
      comments: [{ file: "c.ts", line: null, comment: "whole file" }],
      recommendedActions: [],
    };
    const result = formatPRReviewOutput(output);
    expect(result).toContain("c.ts: whole file");
    expect(result).not.toContain("c.ts:null");
  });
});
