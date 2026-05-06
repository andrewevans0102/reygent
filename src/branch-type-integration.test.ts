import { describe, it, expect } from "vitest";
import { detectTypeFromJiraIssueType, detectTypeFromLinearLabels, deriveBranchFromSpec } from "./branch-type.js";
import { deriveBranchName, mapIssueTypeToBranchType } from "./pr-create.js";
import type { JiraSpecPayload, LinearSpecPayload } from "./spec.js";

/**
 * Integration tests for full branch type detection and naming flow
 *
 * Tests cover:
 * - Jira fetch -> type detection -> branch creation
 * - Linear fetch -> label detection -> branch creation
 * - Type mapping consistency between detection functions
 * - End-to-end branch naming with auto-detection
 */

describe("jira integration flow", () => {
  it("detects Story type and creates feat branch", () => {
    const spec: JiraSpecPayload = {
      source: "jira",
      issueKey: "PROJ-123",
      title: "Add user authentication",
      content: "Full spec...",
      issueType: "Story",
    };

    // Step 1: Auto-detect type from issueType
    const detectedType = detectTypeFromJiraIssueType(spec.issueType!);
    expect(detectedType).toBe("feat");

    // Step 2: Derive branch name
    const branch = deriveBranchFromSpec(spec);
    expect(branch).toBe("feat/PROJ-123");
  });

  it("detects Bug type and creates fix branch", () => {
    const spec: JiraSpecPayload = {
      source: "jira",
      issueKey: "PROJ-456",
      title: "Fix login error",
      content: "Bug description...",
      issueType: "Bug",
    };

    const detectedType = detectTypeFromJiraIssueType(spec.issueType!);
    expect(detectedType).toBe("fix");

    const branch = deriveBranchFromSpec(spec);
    expect(branch).toBe("fix/PROJ-456");
  });

  it("detects Task type and creates chore branch", () => {
    const spec: JiraSpecPayload = {
      source: "jira",
      issueKey: "PROJ-789",
      title: "Update dependencies",
      content: "Task description...",
      issueType: "Task",
    };

    const detectedType = detectTypeFromJiraIssueType(spec.issueType!);
    expect(detectedType).toBe("chore");

    const branch = deriveBranchFromSpec(spec);
    expect(branch).toBe("chore/PROJ-789");
  });

  it("detects Technical Debt and creates refactor branch", () => {
    const spec: JiraSpecPayload = {
      source: "jira",
      issueKey: "PROJ-999",
      title: "Refactor auth module",
      content: "Tech debt...",
      issueType: "Technical Debt",
    };

    const detectedType = detectTypeFromJiraIssueType(spec.issueType!);
    expect(detectedType).toBe("refactor");

    const branch = deriveBranchFromSpec(spec);
    expect(branch).toBe("refactor/PROJ-999");
  });

  it("handles unmapped jira types gracefully", () => {
    const spec: JiraSpecPayload = {
      source: "jira",
      issueKey: "PROJ-111",
      title: "Epic planning",
      content: "Epic...",
      issueType: "Epic",
    };

    const detectedType = detectTypeFromJiraIssueType(spec.issueType!);
    expect(detectedType).toBeNull();

    // deriveBranchFromSpec should throw when no type detected and no override
    expect(() => deriveBranchFromSpec(spec)).toThrow(/type.*required/i);
  });
});

describe("linear integration flow", () => {
  it("detects bug label and creates fix branch", () => {
    const spec: LinearSpecPayload = {
      source: "linear",
      issueId: "DT-123",
      title: "Fix API timeout",
      content: "Bug report...",
      labels: ["bug", "critical"],
    };

    const detectedType = detectTypeFromLinearLabels(spec.labels!);
    expect(detectedType).toBe("fix");

    const branch = deriveBranchFromSpec(spec);
    expect(branch).toBe("fix/DT-123");
  });

  it("detects feature label and creates feat branch", () => {
    const spec: LinearSpecPayload = {
      source: "linear",
      issueId: "DT-456",
      title: "Add dark mode",
      content: "Feature request...",
      labels: ["feature", "ui"],
    };

    const detectedType = detectTypeFromLinearLabels(spec.labels!);
    expect(detectedType).toBe("feat");

    const branch = deriveBranchFromSpec(spec);
    expect(branch).toBe("feat/DT-456");
  });

  it("detects partial label matches", () => {
    // Test that "bugfix" label matches "bug" keyword
    const spec: LinearSpecPayload = {
      source: "linear",
      issueId: "DT-789",
      title: "Fix edge case",
      content: "Bugfix...",
      labels: ["bugfix", "regression"],
    };

    const detectedType = detectTypeFromLinearLabels(spec.labels!);
    expect(detectedType).toBe("fix");

    const branch = deriveBranchFromSpec(spec);
    expect(branch).toBe("fix/DT-789");
  });

  it("prioritizes bug over feature when both present", () => {
    const spec: LinearSpecPayload = {
      source: "linear",
      issueId: "DT-999",
      title: "Mixed labels",
      content: "Both feature and bug...",
      labels: ["feature", "bug"],
    };

    const detectedType = detectTypeFromLinearLabels(spec.labels!);
    expect(detectedType).toBe("fix");

    const branch = deriveBranchFromSpec(spec);
    expect(branch).toBe("fix/DT-999");
  });

  it("detects chore and maintenance labels", () => {
    const spec: LinearSpecPayload = {
      source: "linear",
      issueId: "DT-111",
      title: "Update deps",
      content: "Chore...",
      labels: ["maintenance", "dependencies"],
    };

    const detectedType = detectTypeFromLinearLabels(spec.labels!);
    expect(detectedType).toBe("chore");

    const branch = deriveBranchFromSpec(spec);
    expect(branch).toBe("chore/DT-111");
  });

  it("detects documentation labels", () => {
    const spec: LinearSpecPayload = {
      source: "linear",
      issueId: "DT-222",
      title: "Update README",
      content: "Docs...",
      labels: ["documentation"],
    };

    const detectedType = detectTypeFromLinearLabels(spec.labels!);
    expect(detectedType).toBe("docs");

    const branch = deriveBranchFromSpec(spec);
    expect(branch).toBe("docs/DT-222");
  });

  it("handles unmapped labels gracefully", () => {
    const spec: LinearSpecPayload = {
      source: "linear",
      issueId: "DT-333",
      title: "Generic task",
      content: "No type labels...",
      labels: ["backend", "frontend"],
    };

    const detectedType = detectTypeFromLinearLabels(spec.labels!);
    expect(detectedType).toBeNull();

    expect(() => deriveBranchFromSpec(spec)).toThrow(/type.*required/i);
  });
});

describe("type mapping consistency", () => {
  it("mapIssueTypeToBranchType matches detectTypeFromJiraIssueType for Bug", () => {
    const jiraDetected = detectTypeFromJiraIssueType("Bug");
    const prCreateMapped = mapIssueTypeToBranchType("Bug");
    expect(jiraDetected).toBe(prCreateMapped);
  });

  it("mapIssueTypeToBranchType matches detectTypeFromJiraIssueType for Story", () => {
    const jiraDetected = detectTypeFromJiraIssueType("Story");
    const prCreateMapped = mapIssueTypeToBranchType("Story");
    expect(jiraDetected).toBe(prCreateMapped);
  });

  it("both functions use partial matching for type detection", () => {
    // Both use includes() for partial matching
    const prCreateMapped = mapIssueTypeToBranchType("Feature Request");
    expect(prCreateMapped).toBe("feat");

    const jiraDetected = detectTypeFromJiraIssueType("Feature Request");
    expect(jiraDetected).toBe("feat"); // Partial match on "feature"
  });
});

describe("CLI override behavior", () => {
  it("CLI flag overrides jira auto-detection", () => {
    const spec: JiraSpecPayload = {
      source: "jira",
      issueKey: "PROJ-123",
      title: "Story",
      content: "...",
      issueType: "Story", // Would auto-detect as "feat"
    };

    const branch = deriveBranchFromSpec(spec, "fix"); // CLI override
    expect(branch).toBe("fix/PROJ-123");
  });

  it("CLI flag overrides linear auto-detection", () => {
    const spec: LinearSpecPayload = {
      source: "linear",
      issueId: "DT-456",
      title: "Bug fix",
      content: "...",
      labels: ["bug"], // Would auto-detect as "fix"
    };

    const branch = deriveBranchFromSpec(spec, "chore"); // CLI override
    expect(branch).toBe("chore/DT-456");
  });
});

describe("case insensitivity", () => {
  it("detects jira types case-insensitively", () => {
    expect(detectTypeFromJiraIssueType("bug")).toBe("fix");
    expect(detectTypeFromJiraIssueType("BUG")).toBe("fix");
    expect(detectTypeFromJiraIssueType("Bug")).toBe("fix");
    expect(detectTypeFromJiraIssueType("STORY")).toBe("feat");
    expect(detectTypeFromJiraIssueType("story")).toBe("feat");
  });

  it("detects linear labels case-insensitively", () => {
    expect(detectTypeFromLinearLabels(["BUG"])).toBe("fix");
    expect(detectTypeFromLinearLabels(["bug"])).toBe("fix");
    expect(detectTypeFromLinearLabels(["Bug"])).toBe("fix");
    expect(detectTypeFromLinearLabels(["FEATURE"])).toBe("feat");
    expect(detectTypeFromLinearLabels(["feature"])).toBe("feat");
  });

  it("pr-create mapIssueTypeToBranchType is case-insensitive", () => {
    expect(mapIssueTypeToBranchType("BUG")).toBe("fix");
    expect(mapIssueTypeToBranchType("bug")).toBe("fix");
    expect(mapIssueTypeToBranchType("Bug")).toBe("fix");
  });
});

describe("pr-create integration", () => {
  it("deriveBranchName uses type parameter correctly for jira", () => {
    const spec: JiraSpecPayload = {
      source: "jira",
      issueKey: "PROJ-123",
      title: "Test",
      content: "",
    };

    const branch = deriveBranchName(spec, "feat");
    expect(branch).toBe("feat/PROJ-123");
  });

  it("deriveBranchName uses type parameter correctly for linear", () => {
    const spec: LinearSpecPayload = {
      source: "linear",
      issueId: "DT-456",
      title: "Test",
      content: "",
    };

    const branch = deriveBranchName(spec, "fix");
    expect(branch).toBe("fix/DT-456");
  });

  it("deriveBranchName preserves issue identifier case", () => {
    const jiraSpec: JiraSpecPayload = {
      source: "jira",
      issueKey: "PROJ-123",
      title: "Test",
      content: "",
    };

    const linearSpec: LinearSpecPayload = {
      source: "linear",
      issueId: "DT-456",
      title: "Test",
      content: "",
    };

    expect(deriveBranchName(jiraSpec, "feat")).toContain("PROJ-123");
    expect(deriveBranchName(linearSpec, "fix")).toContain("DT-456");
  });
});
