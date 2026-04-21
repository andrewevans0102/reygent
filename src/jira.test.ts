import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isJiraKey, readJiraSpec } from "./jira.js";

describe("isJiraKey", () => {
  it("returns true for valid Jira key", () => {
    expect(isJiraKey("PROJ-123")).toBe(true);
  });

  it("returns true for single letter project", () => {
    // Pattern requires 1+ uppercase letters
    expect(isJiraKey("X-1")).toBe(true);
  });

  it("returns false for lowercase", () => {
    expect(isJiraKey("proj-123")).toBe(false);
  });

  it("returns false for URL", () => {
    expect(isJiraKey("https://jira.com/PROJ-123")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isJiraKey("")).toBe(false);
  });

  it("returns false for no dash", () => {
    expect(isJiraKey("PROJ123")).toBe(false);
  });
});

describe("readJiraSpec", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {
      JIRA_URL: process.env.JIRA_URL,
      JIRA_EMAIL: process.env.JIRA_EMAIL,
      JIRA_API_TOKEN: process.env.JIRA_API_TOKEN,
    };
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("throws when credentials not set", async () => {
    delete process.env.JIRA_URL;
    delete process.env.JIRA_EMAIL;
    delete process.env.JIRA_API_TOKEN;
    await expect(readJiraSpec("PROJ-1")).rejects.toThrow(/not configured/i);
  });

  it("throws when partial credentials", async () => {
    process.env.JIRA_URL = "https://test.atlassian.net";
    delete process.env.JIRA_EMAIL;
    delete process.env.JIRA_API_TOKEN;
    await expect(readJiraSpec("PROJ-1")).rejects.toThrow(/not configured/i);
  });

  it("fetches and returns spec for valid issue", async () => {
    process.env.JIRA_URL = "https://test.atlassian.net";
    process.env.JIRA_EMAIL = "user@test.com";
    process.env.JIRA_API_TOKEN = "token123";

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        key: "PROJ-1",
        fields: {
          summary: "Fix login",
          description: "Users cannot log in",
        },
      }),
    }));

    const result = await readJiraSpec("PROJ-1");
    expect(result.source).toBe("jira");
    expect(result.issueKey).toBe("PROJ-1");
    expect(result.title).toBe("Fix login");
    expect(result.content).toContain("Fix login");
    expect(result.content).toContain("Users cannot log in");
  });

  it("handles ADF description format", async () => {
    process.env.JIRA_URL = "https://test.atlassian.net";
    process.env.JIRA_EMAIL = "user@test.com";
    process.env.JIRA_API_TOKEN = "token123";

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        key: "PROJ-2",
        fields: {
          summary: "ADF Test",
          description: {
            content: [
              { type: "paragraph", content: [{ type: "text", text: "Paragraph text" }] },
            ],
          },
        },
      }),
    }));

    const result = await readJiraSpec("PROJ-2");
    expect(result.content).toContain("Paragraph text");
  });

  it("throws on API error", async () => {
    process.env.JIRA_URL = "https://test.atlassian.net";
    process.env.JIRA_EMAIL = "user@test.com";
    process.env.JIRA_API_TOKEN = "token123";

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve("Not Found"),
    }));

    await expect(readJiraSpec("PROJ-999")).rejects.toThrow(/404/);
  });

  it("includes acceptance criteria when present", async () => {
    process.env.JIRA_URL = "https://test.atlassian.net";
    process.env.JIRA_EMAIL = "user@test.com";
    process.env.JIRA_API_TOKEN = "token123";

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        key: "PROJ-3",
        fields: {
          summary: "With AC",
          description: "Desc",
          acceptanceCriteria: "- Login works\n- Logout works",
        },
      }),
    }));

    const result = await readJiraSpec("PROJ-3");
    expect(result.content).toContain("Acceptance Criteria");
    expect(result.content).toContain("Login works");
  });
});
