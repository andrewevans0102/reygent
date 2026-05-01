import { describe, it, expect, vi } from "vitest";

vi.mock("@inquirer/prompts", () => ({ select: vi.fn(), input: vi.fn() }));
vi.mock("../config.js", () => ({ getAgents: vi.fn(() => []) }));
vi.mock("../spawn.js", () => ({ spawnAgentStream: vi.fn() }));
vi.mock("../implement.js", () => ({ spawnAgent: vi.fn() }));

import {
  classifyComments,
  classifyComment,
  buildDevPrompt,
  PRIMARY_SECURITY_KEYWORDS,
  SECONDARY_SECURITY_KEYWORDS,
} from "./review-comments.js";
import type { ReviewComment, ClassifiedComment } from "./review-comments.js";

function makeComment(body: string, overrides?: Partial<ReviewComment>): ReviewComment {
  return {
    author: "test-user",
    body,
    createdAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

// ── classifyComment (single body) ──

describe("classifyComment", () => {
  it("flags primary keyword (XSS)", () => {
    expect(classifyComment("There's an XSS vulnerability in the input field")).toBe(true);
  });

  it("flags primary keyword (sql injection)", () => {
    expect(classifyComment("This is vulnerable to SQL injection")).toBe(true);
  });

  it("flags primary keyword (rce)", () => {
    expect(classifyComment("Possible RCE via user input")).toBe(true);
  });

  it("does NOT flag general comment with no keywords", () => {
    expect(classifyComment("fix button alignment")).toBe(false);
  });

  it("does NOT flag single secondary keyword (authentication alone)", () => {
    expect(classifyComment("fix the authentication flow")).toBe(false);
  });

  it("does NOT flag single secondary keyword (authorization alone)", () => {
    expect(classifyComment("OAuth authorization code flow needs update")).toBe(false);
  });

  it("does NOT flag single secondary keyword (jwt alone)", () => {
    expect(classifyComment("Add JWT to the response header")).toBe(false);
  });

  it("does NOT flag single secondary keyword (cors alone)", () => {
    expect(classifyComment("Add CORS headers for the new endpoint")).toBe(false);
  });

  it("does NOT flag single secondary keyword (dos alone)", () => {
    expect(classifyComment("dos line ending conversion needed")).toBe(false);
  });

  it("does NOT flag single secondary keyword (race condition alone)", () => {
    expect(classifyComment("There's a race condition in the cache update")).toBe(false);
  });

  it("flags when 2 secondary keywords co-occur", () => {
    expect(classifyComment("The JWT authentication flow is broken")).toBe(true);
  });

  it("flags when secondary + primary co-occur", () => {
    expect(classifyComment("Authentication bypass via CSRF")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(classifyComment("CROSS-SITE SCRIPTING found")).toBe(true);
  });
});

// ── classifyComments (array) ──

describe("classifyComments", () => {
  it("returns ClassifiedComment[] with isSecurity set", () => {
    const input: ReviewComment[] = [
      makeComment("XSS vulnerability in input"),
      makeComment("fix button alignment"),
    ];

    const result: ClassifiedComment[] = classifyComments(input);

    expect(result).toHaveLength(2);
    expect(result[0].isSecurity).toBe(true);
    expect(result[1].isSecurity).toBe(false);
  });

  it("preserves all original fields", () => {
    const input: ReviewComment[] = [
      makeComment("some comment", { author: "alice", path: "src/foo.ts", line: 42 }),
    ];

    const result = classifyComments(input);
    expect(result[0].author).toBe("alice");
    expect(result[0].path).toBe("src/foo.ts");
    expect(result[0].line).toBe(42);
    expect(result[0].body).toBe("some comment");
    expect(typeof result[0].isSecurity).toBe("boolean");
  });

  it("does not mutate original array", () => {
    const input: ReviewComment[] = [makeComment("sql injection risk")];
    const original = { ...input[0] };
    classifyComments(input);
    expect(input[0]).toEqual(original);
  });

  it("handles empty array", () => {
    expect(classifyComments([])).toEqual([]);
  });

  it("edge: keyword substring 'authorization' in non-security context stays non-security", () => {
    const result = classifyComments([
      makeComment("OAuth authorization code flow needs refactoring"),
    ]);
    expect(result[0].isSecurity).toBe(false);
  });
});

// ── buildDevPrompt ──

describe("buildDevPrompt", () => {
  const basePlan = {
    goals: ["Fix review comments"],
    tasks: ["Update code"],
    constraints: ["Don't break tests"],
    dod: ["Tests pass"],
  };

  it("includes userInstructions in output when provided", () => {
    const comments: ClassifiedComment[] = [
      { ...makeComment("fix typo"), isSecurity: false },
    ];

    const result = buildDevPrompt("system prompt", comments, basePlan, "Use tabs not spaces");

    expect(result).toContain("## Additional Instructions from User");
    expect(result).toContain("Use tabs not spaces");
  });

  it("omits instructions section when userInstructions is undefined", () => {
    const comments: ClassifiedComment[] = [
      { ...makeComment("fix typo"), isSecurity: false },
    ];

    const result = buildDevPrompt("system prompt", comments, basePlan);

    expect(result).not.toContain("## Additional Instructions from User");
  });

  it("includes security preamble when security comments exist", () => {
    const comments: ClassifiedComment[] = [
      { ...makeComment("XSS vulnerability found"), isSecurity: true },
    ];

    const result = buildDevPrompt("system prompt", comments, basePlan);

    expect(result).toContain("Pay special attention to security-related comments");
    expect(result).toContain("secure coding practices");
  });

  it("omits security preamble when no security comments", () => {
    const comments: ClassifiedComment[] = [
      { ...makeComment("fix typo"), isSecurity: false },
    ];

    const result = buildDevPrompt("system prompt", comments, basePlan);

    expect(result).not.toContain("Pay special attention to security-related comments");
  });

  it("includes system prompt at start", () => {
    const comments: ClassifiedComment[] = [
      { ...makeComment("test"), isSecurity: false },
    ];

    const result = buildDevPrompt("You are the dev agent.", comments, basePlan);

    expect(result.startsWith("You are the dev agent.")).toBe(true);
  });

  it("includes plan content", () => {
    const comments: ClassifiedComment[] = [
      { ...makeComment("test"), isSecurity: false },
    ];

    const result = buildDevPrompt("sys", comments, basePlan);

    expect(result).toContain("Fix review comments");
    expect(result).toContain("Update code");
    expect(result).toContain("Don't break tests");
    expect(result).toContain("Tests pass");
  });
});

// ── Keyword list sanity checks ──

describe("keyword lists", () => {
  it("primary keywords do not overlap with secondary", () => {
    for (const kw of PRIMARY_SECURITY_KEYWORDS) {
      expect(SECONDARY_SECURITY_KEYWORDS).not.toContain(kw);
    }
  });

  it("secondary keywords include broad terms that were moved", () => {
    expect(SECONDARY_SECURITY_KEYWORDS).toContain("authentication");
    expect(SECONDARY_SECURITY_KEYWORDS).toContain("authorization");
    expect(SECONDARY_SECURITY_KEYWORDS).toContain("jwt");
    expect(SECONDARY_SECURITY_KEYWORDS).toContain("cors");
    expect(SECONDARY_SECURITY_KEYWORDS).toContain("dos");
    expect(SECONDARY_SECURITY_KEYWORDS).toContain("race condition");
  });
});
