import { describe, it, expect } from "vitest";
import { parseRemote, deriveBranchName, buildCommitMessage, buildPRBody, mapIssueTypeToBranchType } from "./pr-create.js";
import type { BranchType } from "./branch-type.js";
import type { TaskContext, PlannerOutput, SecurityReviewOutput, PRReviewOutput } from "./task.js";
import type { SpecPayload } from "./spec.js";

describe("parseRemote", () => {
  it("parses GitHub SSH URL", () => {
    const result = parseRemote("git@github.com:owner/repo.git");
    expect(result).toEqual({
      platform: "github",
      host: "github.com",
      owner: "owner",
      repo: "repo",
    });
  });

  it("parses GitHub SSH URL without .git", () => {
    const result = parseRemote("git@github.com:owner/repo");
    expect(result).toEqual({
      platform: "github",
      host: "github.com",
      owner: "owner",
      repo: "repo",
    });
  });

  it("parses GitHub HTTPS URL", () => {
    const result = parseRemote("https://github.com/owner/repo.git");
    expect(result).toEqual({
      platform: "github",
      host: "github.com",
      owner: "owner",
      repo: "repo",
    });
  });

  it("parses GitHub HTTPS URL without .git", () => {
    const result = parseRemote("https://github.com/owner/repo");
    expect(result).toEqual({
      platform: "github",
      host: "github.com",
      owner: "owner",
      repo: "repo",
    });
  });

  it("parses GitLab SSH URL", () => {
    const result = parseRemote("git@gitlab.com:owner/repo.git");
    expect(result).toEqual({
      platform: "gitlab",
      host: "gitlab.com",
      owner: "owner",
      repo: "repo",
    });
  });

  it("parses GitLab HTTPS URL", () => {
    const result = parseRemote("https://gitlab.com/owner/repo.git");
    expect(result).toEqual({
      platform: "gitlab",
      host: "gitlab.com",
      owner: "owner",
      repo: "repo",
    });
  });

  it("detects GitHub Enterprise SSH", () => {
    const result = parseRemote("git@github.mycompany.com:team/project.git");
    expect(result.platform).toBe("github");
    expect(result.host).toBe("github.mycompany.com");
  });

  it("trims whitespace", () => {
    const result = parseRemote("  git@github.com:owner/repo.git  \n");
    expect(result.owner).toBe("owner");
  });

  it("throws on unparseable URL", () => {
    expect(() => parseRemote("not-a-url")).toThrow(/cannot parse remote/i);
  });
});

describe("deriveBranchName", () => {
  it("uses issueKey for jira source with feat type", () => {
    const spec: SpecPayload = { source: "jira", issueKey: "PROJ-123", title: "Test", content: "" };
    expect(deriveBranchName(spec, "feat")).toBe("feat/PROJ-123");
  });

  it("uses issueId for linear source with fix type", () => {
    const spec: SpecPayload = { source: "linear", issueId: "DT-267", title: "Test", content: "" };
    expect(deriveBranchName(spec, "fix")).toBe("fix/DT-267");
  });

  it("slugifies title for markdown source with chore type", () => {
    const spec: SpecPayload = { source: "markdown", title: "Add User Auth Feature!", content: "" };
    expect(deriveBranchName(spec, "chore")).toBe("chore/add-user-auth-feature");
  });

  it("truncates long markdown slugs to 60 chars", () => {
    const spec: SpecPayload = {
      source: "markdown",
      title: "A".repeat(100),
      content: "",
    };
    const branch = deriveBranchName(spec, "feat");
    // "feat/" prefix + slug
    const slug = branch.replace("feat/", "");
    expect(slug.length).toBeLessThanOrEqual(60);
  });
});

describe("mapIssueTypeToBranchType", () => {
  it("maps bug to fix", () => {
    expect(mapIssueTypeToBranchType("Bug")).toBe("fix");
    expect(mapIssueTypeToBranchType("bugfix")).toBe("fix");
  });

  it("is case insensitive for issue type mapping", () => {
    expect(mapIssueTypeToBranchType("BUG")).toBe("fix");
    expect(mapIssueTypeToBranchType("bug")).toBe("fix");
    expect(mapIssueTypeToBranchType("Bug")).toBe("fix");
    expect(mapIssueTypeToBranchType("FEATURE")).toBe("feat");
    expect(mapIssueTypeToBranchType("feature")).toBe("feat");
    expect(mapIssueTypeToBranchType("Feature")).toBe("feat");
  });

  it("maps feature to feat", () => {
    expect(mapIssueTypeToBranchType("Feature")).toBe("feat");
    expect(mapIssueTypeToBranchType("Story")).toBe("feat");
    expect(mapIssueTypeToBranchType("Enhancement")).toBe("feat");
  });

  it("maps task to chore", () => {
    expect(mapIssueTypeToBranchType("Task")).toBe("chore");
    expect(mapIssueTypeToBranchType("Chore")).toBe("chore");
  });

  it("maps refactor to refactor", () => {
    expect(mapIssueTypeToBranchType("Refactor")).toBe("refactor");
  });

  it("maps docs to docs", () => {
    expect(mapIssueTypeToBranchType("Documentation")).toBe("docs");
  });

  it("returns null for unknown type", () => {
    expect(mapIssueTypeToBranchType("Unknown")).toBeNull();
    expect(mapIssueTypeToBranchType(undefined)).toBeNull();
  });
});

describe("buildCommitMessage", () => {
  function makeContext(spec: SpecPayload, plan?: PlannerOutput): TaskContext {
    return { spec, plan, results: [] };
  }

  it("formats jira as conventional commit with scope", () => {
    const spec: SpecPayload = { source: "jira", issueKey: "PROJ-1", title: "Fix bug", content: "" };
    const msg = buildCommitMessage(makeContext(spec), "feat");
    expect(msg).toBe("feat(PROJ-1): fix bug");
  });

  it("formats linear as conventional commit with scope", () => {
    const spec: SpecPayload = { source: "linear", issueId: "DT-99", title: "Add feature", content: "" };
    const msg = buildCommitMessage(makeContext(spec), "fix");
    expect(msg).toBe("fix(DT-99): add feature");
  });

  it("formats markdown as conventional commit without scope", () => {
    const spec: SpecPayload = { source: "markdown", title: "Do thing", content: "" };
    const msg = buildCommitMessage(makeContext(spec), "chore");
    expect(msg).toBe("chore: do thing");
  });

  it("includes goals and tasks when plan exists", () => {
    const spec: SpecPayload = { source: "markdown", title: "Do thing", content: "" };
    const plan: PlannerOutput = {
      goals: ["goal1"],
      tasks: ["task1", "task2"],
      constraints: ["c1"],
      dod: ["d1"],
    };
    const msg = buildCommitMessage(makeContext(spec, plan), "feat");
    expect(msg).toContain("feat: do thing");
    expect(msg).toContain("Goals:");
    expect(msg).toContain("- goal1");
    expect(msg).toContain("Tasks:");
    expect(msg).toContain("- task1");
  });

  it("uses correct branch type in prefix", () => {
    const spec: SpecPayload = { source: "jira", issueKey: "PROJ-5", title: "Refactor module", content: "" };
    const msg = buildCommitMessage(makeContext(spec), "refactor");
    expect(msg).toBe("refactor(PROJ-5): refactor module");
  });

  it("truncates long titles to fit 100 char limit", () => {
    const longTitle = "Very long title that exceeds the commitlint header-max-length limit of 100 characters and needs truncation";
    const spec: SpecPayload = { source: "linear", issueId: "DT-123", title: longTitle, content: "" };
    const msg = buildCommitMessage(makeContext(spec), "feat");
    const subject = msg.split("\n")[0];
    expect(subject.length).toBeLessThanOrEqual(100);
    expect(subject).toContain("...");
    expect(subject).toMatch(/^feat\(DT-123\): /);
  });

  it("does not truncate titles that fit within limit", () => {
    const spec: SpecPayload = { source: "linear", issueId: "DT-1", title: "Short title", content: "" };
    const msg = buildCommitMessage(makeContext(spec), "feat");
    expect(msg).toBe("feat(DT-1): short title");
    expect(msg).not.toContain("...");
  });
});

describe("buildPRBody", () => {
  function makeContext(overrides: Partial<TaskContext> = {}): TaskContext {
    return {
      spec: { source: "markdown", title: "Test PR", content: "content" },
      results: [],
      ...overrides,
    };
  }

  it("includes summary section", () => {
    const body = buildPRBody(makeContext());
    expect(body).toContain("## Summary");
    expect(body).toContain("Test PR");
  });

  it("includes goals when plan provided", () => {
    const body = buildPRBody(makeContext({
      plan: { goals: ["g1"], tasks: ["t1"], constraints: ["c"], dod: ["d"] },
    }));
    expect(body).toContain("## Goals");
    expect(body).toContain("- g1");
  });

  it("includes tasks as checkboxes", () => {
    const body = buildPRBody(makeContext({
      plan: { goals: ["g"], tasks: ["t1"], constraints: ["c"], dod: ["d"] },
    }));
    expect(body).toContain("- [x] t1");
  });

  it("includes files changed from dev output", () => {
    const body = buildPRBody(makeContext({
      implement: { dev: { files: ["src/foo.ts"] }, qe: null },
    }));
    expect(body).toContain("## Files Changed");
    expect(body).toContain("`src/foo.ts`");
  });

  it("excludes security review findings from PR body", () => {
    const body = buildPRBody(makeContext({
      securityReview: {
        severity: "HIGH",
        findings: [{ severity: "HIGH", description: "SQL injection" }],
      },
    }));
    expect(body).not.toContain("## Security Review");
    expect(body).not.toContain("SQL injection");
  });

  it("includes pr review when provided", () => {
    const body = buildPRBody(makeContext({
      prReview: {
        summary: "Looks good",
        comments: [{ file: "a.ts", line: 1, comment: "nitpick" }],
        recommendedActions: ["Fix typo"],
      },
    }));
    expect(body).toContain("## PR Review");
    expect(body).toContain("Looks good");
    expect(body).toContain("nitpick");
    expect(body).toContain("Fix typo");
  });

  it("includes reygent footer", () => {
    const body = buildPRBody(makeContext());
    expect(body).toContain("reygent");
  });
});
