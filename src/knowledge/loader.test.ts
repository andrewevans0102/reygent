import { describe, it, expect } from "vitest";
import {
  parseMarkdownEntries,
  filterByAgent,
  filterByRecency,
} from "./loader.js";

describe("parseMarkdownEntries", () => {
  it("parses markdown with multiple entries", () => {
    const markdown = `
# Document Title

## Entry One
Content for entry one.

## Entry Two
Content for entry two.
`;

    const entries = parseMarkdownEntries(markdown, "test.md");
    expect(entries).toHaveLength(2);
    expect(entries[0].id).toBe("entry-one");
    expect(entries[0].title).toBe("Entry One");
    expect(entries[0].content).toContain("Content for entry one");
    expect(entries[1].id).toBe("entry-two");
    expect(entries[1].title).toBe("Entry Two");
  });

  it("returns empty array for empty markdown", () => {
    const entries = parseMarkdownEntries("", "test.md");
    expect(entries).toEqual([]);
  });

  it("handles markdown with no level-2 headings", () => {
    const markdown = `# Title\nSome content\n### Level 3`;
    const entries = parseMarkdownEntries(markdown, "test.md");
    expect(entries).toEqual([]);
  });
});

describe("filterByAgent", () => {
  it("filters entries by agent name", () => {
    const markdown = `
## Failure One
**Agent**: implementer
Issue description.

## Failure Two
**Agent**: reviewer
Another issue.

## Failure Three
**Agent**: implementer
Third issue.
`;

    const filtered = filterByAgent(markdown, "implementer", "test.md");
    expect(filtered).toContain("Failure One");
    expect(filtered).toContain("Failure Three");
    expect(filtered).not.toContain("Failure Two");
  });

  it("returns empty string when no matches", () => {
    const markdown = `
## Failure One
**Agent**: reviewer
Issue description.
`;

    const filtered = filterByAgent(markdown, "implementer", "test.md");
    expect(filtered).toBe("");
  });

  it("is case-insensitive", () => {
    const markdown = `
## Failure
**Agent**: IMPLEMENTER
Issue.
`;

    const filtered = filterByAgent(markdown, "implementer", "test.md");
    expect(filtered).toContain("Failure");
  });
});

describe("filterByRecency", () => {
  it("filters entries by last seen date", () => {
    const today = new Date().toISOString().split("T")[0];
    const oldDate = "2020-01-01";

    const markdown = `
## Recent Failure
**Last seen**: ${today}
Recent issue.

## Old Failure
**Last seen**: ${oldDate}
Old issue.
`;

    const filtered = filterByRecency(markdown, "test.md", 30);
    expect(filtered).toContain("Recent Failure");
    expect(filtered).not.toContain("Old Failure");
  });

  it("returns empty string when no recent entries", () => {
    const markdown = `
## Old Failure
**Last seen**: 2020-01-01
Old issue.
`;

    const filtered = filterByRecency(markdown, "test.md", 30);
    expect(filtered).toBe("");
  });

  it("excludes entries with no date", () => {
    const markdown = `
## Failure
No date field.
`;

    const filtered = filterByRecency(markdown, "test.md", 30);
    expect(filtered).toBe("");
  });
});
