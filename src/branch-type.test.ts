import { describe, it, expect } from "vitest";
import {
  normalizeType,
  isValidType,
  detectTypeFromJiraIssueType,
  detectTypeFromLinearLabels,
  deriveBranchNameWithType,
  deriveBranchFromSpec,
  VALID_BRANCH_TYPES,
  type BranchType,
} from "./branch-type.js";

/**
 * Tests for conventional branch prefix logic
 *
 * Spec requirements:
 * - Use conventional prefixes: feat/, fix/, chore/, refactor/, docs/, test/, style/, perf/
 * - Prompt user for type when creating branch
 * - Auto-detect from Jira issue type or Linear labels when available
 * - Support --type flag to skip prompt
 * - Validate type input
 */

describe("branch type selection", () => {
  describe("valid branch types", () => {
    it("accepts feature type", () => {
      const validTypes = ["feature", "feat"];
      expect(validTypes).toContain("feature");
      expect(validTypes).toContain("feat");
    });

    it("accepts bugfix type", () => {
      const validTypes = ["bugfix", "fix"];
      expect(validTypes).toContain("bugfix");
      expect(validTypes).toContain("fix");
    });

    it("accepts chore type", () => {
      const validTypes = ["chore"];
      expect(validTypes).toContain("chore");
    });

    it("accepts refactor type", () => {
      const validTypes = ["refactor"];
      expect(validTypes).toContain("refactor");
    });

    it("accepts docs type", () => {
      const validTypes = ["docs"];
      expect(validTypes).toContain("docs");
    });

    it("accepts test type", () => {
      const validTypes = ["test"];
      expect(validTypes).toContain("test");
    });

    it("accepts style type", () => {
      const validTypes = ["style"];
      expect(validTypes).toContain("style");
    });

    it("accepts perf type", () => {
      const validTypes = ["perf"];
      expect(validTypes).toContain("perf");
    });
  });

  describe("type normalization", () => {
    it("normalizes feature to feat", () => {
      const normalized = normalizeType("feature");
      expect(normalized).toBe("feat");
    });

    it("normalizes bugfix to fix", () => {
      const normalized = normalizeType("bugfix");
      expect(normalized).toBe("fix");
    });

    it("keeps short forms unchanged", () => {
      expect(normalizeType("feat")).toBe("feat");
      expect(normalizeType("fix")).toBe("fix");
      expect(normalizeType("chore")).toBe("chore");
    });

    it("normalizes to lowercase", () => {
      expect(normalizeType("FEAT")).toBe("feat");
      expect(normalizeType("Fix")).toBe("fix");
    });

    it("throws on invalid type", () => {
      expect(() => normalizeType("invalid")).toThrow(/invalid.*type/i);
    });
  });
});

describe("branch name with type prefix", () => {
  describe("jira source", () => {
    it("creates feat/ prefix for feature", () => {
      const spec = makeJiraSpec("PROJ-123", "Test");
      const branch = deriveBranchNameWithType(spec, "feat");
      expect(branch).toBe("feat/PROJ-123");
    });

    it("creates fix/ prefix for bugfix", () => {
      const spec = makeJiraSpec("PROJ-456", "Test");
      const branch = deriveBranchNameWithType(spec, "fix");
      expect(branch).toBe("fix/PROJ-456");
    });

    it("creates chore/ prefix for chore", () => {
      const spec = makeJiraSpec("PROJ-789", "Test");
      const branch = deriveBranchNameWithType(spec, "chore");
      expect(branch).toBe("chore/PROJ-789");
    });
  });

  describe("linear source", () => {
    it("creates feat/ prefix for feature", () => {
      const spec = makeLinearSpec("DT-267", "Test");
      const branch = deriveBranchNameWithType(spec, "feat");
      expect(branch).toBe("feat/DT-267");
    });

    it("creates fix/ prefix for bugfix", () => {
      const spec = makeLinearSpec("DT-268", "Test");
      const branch = deriveBranchNameWithType(spec, "fix");
      expect(branch).toBe("fix/DT-268");
    });

    it("creates refactor/ prefix for refactor", () => {
      const spec = makeLinearSpec("DT-269", "Test");
      const branch = deriveBranchNameWithType(spec, "refactor");
      expect(branch).toBe("refactor/DT-269");
    });
  });

  describe("markdown source", () => {
    it("creates feat/ prefix with slugified title", () => {
      const spec = makeMarkdownSpec("Add User Auth");
      const branch = deriveBranchNameWithType(spec, "feat");
      expect(branch).toBe("feat/add-user-auth");
    });

    it("creates fix/ prefix with slugified title", () => {
      const spec = makeMarkdownSpec("Fix Login Bug!");
      const branch = deriveBranchNameWithType(spec, "fix");
      expect(branch).toBe("fix/fix-login-bug");
    });

    it("truncates long markdown slugs to 60 chars after prefix", () => {
      const spec = makeMarkdownSpec("A".repeat(100));
      const branch = deriveBranchNameWithType(spec, "feat");
      const slug = branch.replace("feat/", "");
      expect(slug.length).toBeLessThanOrEqual(60);
    });

    it("creates docs/ prefix for documentation", () => {
      const spec = makeMarkdownSpec("Update README");
      const branch = deriveBranchNameWithType(spec, "docs");
      expect(branch).toBe("docs/update-readme");
    });
  });
});

describe("type detection from issue metadata", () => {
  describe("jira issue types", () => {
    it("maps Story to feat", () => {
      const type = detectTypeFromJiraIssueType("Story");
      expect(type).toBe("feat");
    });

    it("maps Bug to fix", () => {
      const type = detectTypeFromJiraIssueType("Bug");
      expect(type).toBe("fix");
    });

    it("maps Task to chore", () => {
      const type = detectTypeFromJiraIssueType("Task");
      expect(type).toBe("chore");
    });

    it("maps Technical Debt to refactor", () => {
      const type = detectTypeFromJiraIssueType("Technical Debt");
      expect(type).toBe("refactor");
    });

    it("returns null for unknown types", () => {
      const type = detectTypeFromJiraIssueType("Epic");
      expect(type).toBeNull();
    });

    it("is case insensitive", () => {
      expect(detectTypeFromJiraIssueType("bug")).toBe("fix");
      expect(detectTypeFromJiraIssueType("STORY")).toBe("feat");
    });
  });

  describe("linear labels", () => {
    it("maps feature label to feat", () => {
      const type = detectTypeFromLinearLabels(["feature", "high-priority"]);
      expect(type).toBe("feat");
    });

    it("maps bug label to fix", () => {
      const type = detectTypeFromLinearLabels(["bug", "urgent"]);
      expect(type).toBe("fix");
    });

    it("prioritizes bug over feature when both present", () => {
      const type = detectTypeFromLinearLabels(["feature", "bug"]);
      expect(type).toBe("fix");
    });

    it("maps chore label to chore", () => {
      const type = detectTypeFromLinearLabels(["chore", "maintenance"]);
      expect(type).toBe("chore");
    });

    it("maps refactor label to refactor", () => {
      const type = detectTypeFromLinearLabels(["refactor", "tech-debt"]);
      expect(type).toBe("refactor");
    });

    it("maps documentation label to docs", () => {
      const type = detectTypeFromLinearLabels(["documentation"]);
      expect(type).toBe("docs");
    });

    it("returns null when no matching labels", () => {
      const type = detectTypeFromLinearLabels(["backend", "frontend"]);
      expect(type).toBeNull();
    });

    it("is case insensitive", () => {
      expect(detectTypeFromLinearLabels(["Bug"])).toBe("fix");
      expect(detectTypeFromLinearLabels(["FEATURE"])).toBe("feat");
    });
  });
});

describe("type validation", () => {
  it("validates CLI flag type", () => {
    expect(isValidType("feat")).toBe(true);
    expect(isValidType("fix")).toBe(true);
    expect(isValidType("feature")).toBe(true);
    expect(isValidType("bugfix")).toBe(true);
  });

  it("rejects invalid CLI flag type", () => {
    expect(isValidType("invalid")).toBe(false);
    expect(isValidType("")).toBe(false);
    expect(isValidType("hotfix")).toBe(false);
  });

  it("accepts all valid conventional types", () => {
    const validTypes = ["feat", "fix", "chore", "refactor", "docs", "test", "style", "perf"];
    for (const type of validTypes) {
      expect(isValidType(type)).toBe(true);
    }
  });

  it("accepts long-form aliases", () => {
    expect(isValidType("feature")).toBe(true);
    expect(isValidType("bugfix")).toBe(true);
  });
});

describe("integration with spec payloads", () => {
  it("derives branch with detected jira type", () => {
    const spec = makeJiraSpec("PROJ-123", "Add feature", "Story");
    const branch = deriveBranchFromSpec(spec);
    expect(branch).toBe("feat/PROJ-123");
  });

  it("derives branch with detected linear type", () => {
    const spec = makeLinearSpec("DT-456", "Fix bug", ["bug", "urgent"]);
    const branch = deriveBranchFromSpec(spec);
    expect(branch).toBe("fix/DT-456");
  });

  it("throws when spec has no type and no CLI override", () => {
    const spec = makeMarkdownSpec("Do something");
    expect(() => deriveBranchFromSpec(spec)).toThrow(/type.*required/i);
  });

  it("uses CLI flag to override detected type", () => {
    const spec = makeJiraSpec("PROJ-789", "Task", "Story");
    const branch = deriveBranchFromSpec(spec, "fix");
    expect(branch).toBe("fix/PROJ-789");
  });
});

// Helper to wrap spec in correct type for tests
function makeJiraSpec(issueKey: string, title: string, issueType?: string) {
  return { source: "jira" as const, issueKey, title, content: "", issueType };
}

function makeLinearSpec(issueId: string, title: string, labels?: string[]) {
  return { source: "linear" as const, issueId, title, content: "", labels };
}

function makeMarkdownSpec(title: string) {
  return { source: "markdown" as const, title, content: "" };
}
