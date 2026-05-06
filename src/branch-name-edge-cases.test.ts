import { describe, it, expect } from "vitest";
import type { SpecPayload } from "./spec.js";
import { deriveBranchName } from "./pr-create.js";
import type { BranchType } from "./branch-type.js";

/**
 * Edge case tests for branch name generation with conventional prefixes
 *
 * Tests cover:
 * - Special character handling in markdown titles
 * - Case preservation for issue identifiers
 * - Dash normalization in slugs
 * - Prefix validation
 * - Length constraints
 */

describe("branch name edge cases", () => {
  describe("markdown slug special characters", () => {
    it("converts forward slashes to dashes", () => {
      const spec: SpecPayload = { source: "markdown", title: "API/Client/Auth", content: "" };
      const branch = deriveBranchName(spec, "feat" as BranchType);
      expect(branch).toBe("feat/api-client-auth");
    });

    it("converts colons to dashes", () => {
      const spec: SpecPayload = { source: "markdown", title: "Fix: Login Error", content: "" };
      const branch = deriveBranchName(spec, "fix" as BranchType);
      expect(branch).toBe("fix/fix-login-error");
    });

    it("converts parentheses to dashes", () => {
      const spec: SpecPayload = { source: "markdown", title: "Add feature (v2)", content: "" };
      const branch = deriveBranchName(spec, "feat" as BranchType);
      expect(branch).toBe("feat/add-feature-v2");
    });

    it("removes hashtags", () => {
      const spec: SpecPayload = { source: "markdown", title: "Bug #123 fix", content: "" };
      const branch = deriveBranchName(spec, "fix" as BranchType);
      expect(branch).toBe("fix/bug-123-fix");
    });

    it("removes underscores", () => {
      const spec: SpecPayload = { source: "markdown", title: "Add_user_auth", content: "" };
      const branch = deriveBranchName(spec, "feat" as BranchType);
      expect(branch).toBe("feat/add-user-auth");
    });

    it("removes exclamation marks", () => {
      const spec: SpecPayload = { source: "markdown", title: "Critical fix!", content: "" };
      const branch = deriveBranchName(spec, "fix" as BranchType);
      expect(branch).toBe("fix/critical-fix");
    });

    it("removes question marks", () => {
      const spec: SpecPayload = { source: "markdown", title: "Should we add this?", content: "" };
      const branch = deriveBranchName(spec, "feat" as BranchType);
      expect(branch).toBe("feat/should-we-add-this");
    });

    it("handles unicode characters", () => {
      const spec: SpecPayload = { source: "markdown", title: "Add émojis 🎉", content: "" };
      const branch = deriveBranchName(spec, "feat" as BranchType);
      // Non-ASCII removed by [^a-z0-9]+
      expect(branch).toMatch(/^feat\/add-mojis$/);
    });

    it("handles ampersands", () => {
      const spec: SpecPayload = { source: "markdown", title: "Users & Groups", content: "" };
      const branch = deriveBranchName(spec, "feat" as BranchType);
      expect(branch).toBe("feat/users-groups");
    });
  });

  describe("dash normalization", () => {
    it("removes leading single dash", () => {
      const spec: SpecPayload = { source: "markdown", title: "-feature", content: "" };
      const branch = deriveBranchName(spec, "feat" as BranchType);
      expect(branch).toBe("feat/feature");
    });

    it("removes leading multiple dashes", () => {
      const spec: SpecPayload = { source: "markdown", title: "---feature", content: "" };
      const branch = deriveBranchName(spec, "feat" as BranchType);
      expect(branch).toBe("feat/feature");
    });

    it("removes trailing single dash", () => {
      const spec: SpecPayload = { source: "markdown", title: "feature-", content: "" };
      const branch = deriveBranchName(spec, "feat" as BranchType);
      expect(branch).toBe("feat/feature");
    });

    it("removes trailing multiple dashes", () => {
      const spec: SpecPayload = { source: "markdown", title: "feature---", content: "" };
      const branch = deriveBranchName(spec, "feat" as BranchType);
      expect(branch).toBe("feat/feature");
    });

    it("removes both leading and trailing dashes", () => {
      const spec: SpecPayload = { source: "markdown", title: "--feature--", content: "" };
      const branch = deriveBranchName(spec, "feat" as BranchType);
      expect(branch).toBe("feat/feature");
    });

    it("collapses multiple consecutive dashes to single dash", () => {
      const spec: SpecPayload = { source: "markdown", title: "my   feature   name", content: "" };
      const branch = deriveBranchName(spec, "feat" as BranchType);
      expect(branch).toBe("feat/my-feature-name");
    });

    it("handles title with only dashes", () => {
      const spec: SpecPayload = { source: "markdown", title: "-----", content: "" };
      const branch = deriveBranchName(spec, "feat" as BranchType);
      expect(branch).toBe("feat/");
    });
  });

  describe("case handling", () => {
    it("lowercases markdown titles", () => {
      const spec: SpecPayload = { source: "markdown", title: "ADD NEW FEATURE", content: "" };
      const branch = deriveBranchName(spec, "feat" as BranchType);
      expect(branch).toBe("feat/add-new-feature");
    });

    it("lowercases mixed case markdown titles", () => {
      const spec: SpecPayload = { source: "markdown", title: "Add New Feature", content: "" };
      const branch = deriveBranchName(spec, "feat" as BranchType);
      expect(branch).toBe("feat/add-new-feature");
    });

    it("preserves jira issue key case", () => {
      const spec: SpecPayload = { source: "jira", issueKey: "PROJ-123", title: "Test", content: "" };
      const branch = deriveBranchName(spec, "feat" as BranchType);
      expect(branch).toBe("feat/PROJ-123");
      expect(branch).not.toBe("feat/proj-123");
    });

    it("preserves linear issue id case", () => {
      const spec: SpecPayload = { source: "linear", issueId: "DT-456", title: "Test", content: "" };
      const branch = deriveBranchName(spec, "fix" as BranchType);
      expect(branch).toBe("fix/DT-456");
      expect(branch).not.toBe("fix/dt-456");
    });
  });

  describe("length constraints", () => {
    it("truncates markdown slug at 60 chars for short prefix", () => {
      const longTitle = "word ".repeat(30);
      const spec: SpecPayload = { source: "markdown", title: longTitle, content: "" };
      const branch = deriveBranchName(spec, "feat" as BranchType);
      const slug = branch.replace("feat/", "");
      expect(slug.length).toBeLessThanOrEqual(60);
    });

    it("truncates markdown slug at 60 chars for long prefix", () => {
      const longTitle = "a".repeat(100);
      const spec: SpecPayload = { source: "markdown", title: longTitle, content: "" };
      const branch = deriveBranchName(spec, "refactor" as BranchType);
      const slug = branch.replace("refactor/", "");
      expect(slug.length).toBeLessThanOrEqual(60);
    });

    it("does not truncate jira issue keys", () => {
      const spec: SpecPayload = { source: "jira", issueKey: "VERYLONGPROJECTNAME-99999", title: "Test", content: "" };
      const branch = deriveBranchName(spec, "feat" as BranchType);
      expect(branch).toBe("feat/VERYLONGPROJECTNAME-99999");
    });

    it("does not truncate linear issue ids", () => {
      const spec: SpecPayload = { source: "linear", issueId: "LONGTEAM-99999", title: "Test", content: "" };
      const branch = deriveBranchName(spec, "fix" as BranchType);
      expect(branch).toBe("fix/LONGTEAM-99999");
    });

    it("handles empty markdown title after truncation", () => {
      const spec: SpecPayload = { source: "markdown", title: "!!!", content: "" };
      const branch = deriveBranchName(spec, "feat" as BranchType);
      expect(branch).toBe("feat/");
    });
  });

  describe("prefix validation", () => {
    it("accepts all conventional commit types", () => {
      const spec: SpecPayload = { source: "jira", issueKey: "TEST-1", title: "Test", content: "" };
      const types = ["feat", "fix", "chore", "refactor", "docs", "test", "style", "perf"];

      for (const type of types) {
        const branch = deriveBranchName(spec, type);
        expect(branch).toMatch(new RegExp(`^${type}/`));
      }
    });

    it("requires type parameter", () => {
      // deriveBranchName requires type parameter - TypeScript enforces this
      const spec: SpecPayload = { source: "jira", issueKey: "TEST-1", title: "Test", content: "" };
      const branch = deriveBranchName(spec, "feat" as BranchType);
      expect(branch).toBe("feat/TEST-1");
    });

    it("generates lowercase prefixes", () => {
      const spec: SpecPayload = { source: "jira", issueKey: "TEST-1", title: "Test", content: "" };
      const branch = deriveBranchName(spec, "feat" as BranchType);
      expect(branch).toMatch(/^feat\//);
      expect(branch).not.toMatch(/^FEAT\//);
      expect(branch).not.toMatch(/^Feat\//);
    });
  });

  describe("empty and whitespace handling", () => {
    it("handles title with only whitespace", () => {
      const spec: SpecPayload = { source: "markdown", title: "   ", content: "" };
      const branch = deriveBranchName(spec, "feat" as BranchType);
      expect(branch).toBe("feat/");
    });

    it("trims leading whitespace from title", () => {
      const spec: SpecPayload = { source: "markdown", title: "   feature", content: "" };
      const branch = deriveBranchName(spec, "feat" as BranchType);
      expect(branch).toBe("feat/feature");
    });

    it("trims trailing whitespace from title", () => {
      const spec: SpecPayload = { source: "markdown", title: "feature   ", content: "" };
      const branch = deriveBranchName(spec, "feat" as BranchType);
      expect(branch).toBe("feat/feature");
    });

    it("normalizes internal whitespace to single dash", () => {
      const spec: SpecPayload = { source: "markdown", title: "my    feature", content: "" };
      const branch = deriveBranchName(spec, "feat" as BranchType);
      expect(branch).toBe("feat/my-feature");
    });
  });
});
