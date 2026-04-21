import { describe, it, expect } from "vitest";
import { parseRemote, deriveBranchName, buildCommitMessage, buildPRBody } from "./pr-create.js";
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
  it("uses issueKey for jira source", () => {
    const spec: SpecPayload = { source: "jira", issueKey: "PROJ-123", title: "Test", content: "" };
    expect(deriveBranchName(spec)).toBe("reygent/PROJ-123");
  });

  it("uses issueId for linear source", () => {
    const spec: SpecPayload = { source: "linear", issueId: "DT-267", title: "Test", content: "" };
    expect(deriveBranchName(spec)).toBe("reygent/DT-267");
  });

  it("slugifies title for markdown source", () => {
    const spec: SpecPayload = { source: "markdown", title: "Add User Auth Feature!", content: "" };
    expect(deriveBranchName(spec)).toBe("reygent/add-user-auth-feature");
  });

  it("truncates long markdown slugs to 60 chars", () => {
    const spec: SpecPayload = {
      source: "markdown",
      title: "A".repeat(100),
      content: "",
    };
    const branch = deriveBranchName(spec);
    // "reygent/" prefix + slug
    const slug = branch.replace("reygent/", "");
    expect(slug.length).toBeLessThanOrEqual(60);
  });
});

describe("buildCommitMessage", () => {
  function makeContext(spec: SpecPayload, plan?: PlannerOutput): TaskContext {
    return { spec, plan, results: [] };
  }

  it("uses jira prefix", () => {
    const spec: SpecPayload = { source: "jira", issueKey: "PROJ-1", title: "Fix bug", content: "" };
    const msg = buildCommitMessage(makeContext(spec));
    expect(msg).toBe("[PROJ-1] Fix bug");
  });

  it("uses linear prefix", () => {
    const spec: SpecPayload = { source: "linear", issueId: "DT-99", title: "Add feature", content: "" };
    const msg = buildCommitMessage(makeContext(spec));
    expect(msg).toBe("[DT-99] Add feature");
  });

  it("uses [reygent] prefix for markdown", () => {
    const spec: SpecPayload = { source: "markdown", title: "Do thing", content: "" };
    const msg = buildCommitMessage(makeContext(spec));
    expect(msg).toBe("[reygent] Do thing");
  });

  it("includes goals and tasks when plan exists", () => {
    const spec: SpecPayload = { source: "markdown", title: "Do thing", content: "" };
    const plan: PlannerOutput = {
      goals: ["goal1"],
      tasks: ["task1", "task2"],
      constraints: ["c1"],
      dod: ["d1"],
    };
    const msg = buildCommitMessage(makeContext(spec, plan));
    expect(msg).toContain("Goals:");
    expect(msg).toContain("- goal1");
    expect(msg).toContain("Tasks:");
    expect(msg).toContain("- task1");
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

  it("includes security review findings", () => {
    const body = buildPRBody(makeContext({
      securityReview: {
        severity: "HIGH",
        findings: [{ severity: "HIGH", description: "SQL injection" }],
      },
    }));
    expect(body).toContain("## Security Review");
    expect(body).toContain("SQL injection");
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
