import { describe, it, expect, vi } from "vitest";

vi.mock("@inquirer/prompts", () => ({ select: vi.fn() }));
vi.mock("./config.js", () => ({ getAgents: vi.fn(() => []) }));
vi.mock("./spawn.js", () => ({ spawnAgentStream: vi.fn() }));
vi.mock("./implement.js", () => ({ spawnAgent: vi.fn() }));

import { extractPRReviewOutput, formatPRReviewOutput, buildPRReviewPrompt } from "./pr-review.js";
import type { PRReviewOutput, TaskContext } from "./task.js";

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

describe("buildPRReviewPrompt", () => {
  const mockContext: TaskContext = {
    spec: {
      title: "Test feature",
      content: "Add new feature",
    },
    plan: {
      goals: ["Implement feature"],
      tasks: ["Write code", "Add tests"],
    },
  };

  const systemPrompt = "You are a code reviewer.";
  const diff = "diff --git a/test.ts b/test.ts\n+console.log('test');";

  it("generates normal review prompt by default", () => {
    const prompt = buildPRReviewPrompt(systemPrompt, mockContext, diff);
    expect(prompt).toContain("You are a code reviewer.");
    expect(prompt).toContain("Test feature");
    expect(prompt).toContain("Implement feature");
    expect(prompt).toContain("console.log('test')");
    expect(prompt).toContain('"comments": [');
    expect(prompt).toContain('"file": "src/example.ts"');
    expect(prompt).not.toContain("summary-only mode");
  });

  it("generates summary-only prompt when summaryOnly=true", () => {
    const prompt = buildPRReviewPrompt(systemPrompt, mockContext, diff, true);
    expect(prompt).toContain("You are a code reviewer.");
    expect(prompt).toContain("Test feature");
    expect(prompt).toContain("High-level assessment covering architecture");
    expect(prompt).toContain('"comments": []');
    expect(prompt).toContain("summary-only mode");
    expect(prompt).toContain("Skip line-by-line nitpicks");
    expect(prompt).not.toContain('"file": "src/example.ts"');
  });

  it("includes spec and plan in both modes", () => {
    const normal = buildPRReviewPrompt(systemPrompt, mockContext, diff, false);
    const summary = buildPRReviewPrompt(systemPrompt, mockContext, diff, true);

    for (const prompt of [normal, summary]) {
      expect(prompt).toContain("## Spec");
      expect(prompt).toContain("**Title:** Test feature");
      expect(prompt).toContain("Add new feature");
      expect(prompt).toContain("## Planner Output");
      expect(prompt).toContain("Implement feature");
      expect(prompt).toContain("Write code");
    }
  });

  it("handles empty goals and tasks", () => {
    const emptyContext: TaskContext = {
      spec: {
        title: "Simple",
        content: "Content",
      },
    };

    const prompt = buildPRReviewPrompt(systemPrompt, emptyContext, diff);
    expect(prompt).toContain("**Goals:**");
    expect(prompt).toContain("- (none)");
    expect(prompt).toContain("**Tasks:**");
    expect(prompt).toContain("- (none)");
  });
});
