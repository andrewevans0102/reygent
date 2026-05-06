import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./linear.js", () => ({
  isLinearUrl: vi.fn(),
  extractLinearId: vi.fn(),
  readLinearSpec: vi.fn(),
}));

vi.mock("./jira.js", () => ({
  readJiraSpec: vi.fn(),
}));

vi.mock("./env.js", () => ({
  loadEnvFile: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import { loadSpec, readSpec, SpecError } from "./spec.js";
import { isLinearUrl, extractLinearId, readLinearSpec } from "./linear.js";
import { readJiraSpec } from "./jira.js";
import { existsSync, readFileSync } from "node:fs";

const mockIsLinearUrl = vi.mocked(isLinearUrl);
const mockExtractLinearId = vi.mocked(extractLinearId);
const mockReadLinearSpec = vi.mocked(readLinearSpec);
const mockReadJiraSpec = vi.mocked(readJiraSpec);
const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);

describe("loadSpec", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {
      LINEAR_API_KEY: process.env.LINEAR_API_KEY,
      JIRA_URL: process.env.JIRA_URL,
      JIRA_EMAIL: process.env.JIRA_EMAIL,
      JIRA_API_TOKEN: process.env.JIRA_API_TOKEN,
    };
    vi.spyOn(process, "cwd").mockReturnValue("/fake");
    mockIsLinearUrl.mockReturnValue(false);
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  });

  it("routes Linear URL to readLinearSpec", async () => {
    mockIsLinearUrl.mockReturnValue(true);
    mockExtractLinearId.mockReturnValue("DT-267");
    mockReadLinearSpec.mockResolvedValue({
      source: "linear",
      issueId: "DT-267",
      title: "Test",
      content: "Content",
    });

    const result = await loadSpec("https://linear.app/team/issue/DT-267");
    expect(mockReadLinearSpec).toHaveBeenCalledWith("DT-267");
    expect(result.source).toBe("linear");
  });

  it("routes issue key to Linear when LINEAR_API_KEY set", async () => {
    process.env.LINEAR_API_KEY = "lin_api_test";
    delete process.env.JIRA_URL;
    delete process.env.JIRA_EMAIL;
    delete process.env.JIRA_API_TOKEN;

    mockReadLinearSpec.mockResolvedValue({
      source: "linear",
      issueId: "DT-1",
      title: "T",
      content: "C",
    });

    const result = await loadSpec("DT-1");
    expect(mockReadLinearSpec).toHaveBeenCalledWith("DT-1");
    expect(result.source).toBe("linear");
  });

  it("routes issue key to Jira when Jira configured", async () => {
    delete process.env.LINEAR_API_KEY;
    process.env.JIRA_URL = "https://test.atlassian.net";
    process.env.JIRA_EMAIL = "a@b.com";
    process.env.JIRA_API_TOKEN = "tok";

    mockReadJiraSpec.mockResolvedValue({
      source: "jira",
      issueKey: "PROJ-1",
      title: "T",
      content: "C",
    });

    const result = await loadSpec("PROJ-1");
    expect(mockReadJiraSpec).toHaveBeenCalledWith("PROJ-1");
    expect(result.source).toBe("jira");
  });

  it("prefers Jira when both configured", async () => {
    process.env.LINEAR_API_KEY = "lin_api_test";
    process.env.JIRA_URL = "https://test.atlassian.net";
    process.env.JIRA_EMAIL = "a@b.com";
    process.env.JIRA_API_TOKEN = "tok";

    mockReadJiraSpec.mockResolvedValue({
      source: "jira",
      issueKey: "PROJ-1",
      title: "T",
      content: "C",
    });

    const result = await loadSpec("PROJ-1");
    expect(mockReadJiraSpec).toHaveBeenCalled();
    expect(result.source).toBe("jira");
  });

  it("throws when issue key and no tracker configured", async () => {
    delete process.env.LINEAR_API_KEY;
    delete process.env.JIRA_URL;
    delete process.env.JIRA_EMAIL;
    delete process.env.JIRA_API_TOKEN;

    await expect(loadSpec("PROJ-1")).rejects.toThrow(/no issue tracker/i);
  });

  it("routes file path to readSpec", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("# Title\n\nContent here");

    const result = await loadSpec("spec.md");
    expect(result.source).toBe("markdown");
    expect(result.title).toBe("Title");
  });
});

describe("loadSpec with explicit provider", () => {
  beforeEach(() => {
    vi.spyOn(process, "cwd").mockReturnValue("/fake");
    mockIsLinearUrl.mockReturnValue(false);
  });

  it("routes to readSpec when provider is 'local'", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("# Title\n\nContent");

    const result = await loadSpec("spec.md", "local");
    expect(result.source).toBe("markdown");
  });

  it("routes to readLinearSpec when provider is 'linear'", async () => {
    mockReadLinearSpec.mockResolvedValue({
      source: "linear",
      issueId: "ENG-123",
      title: "T",
      content: "C",
    });

    const result = await loadSpec("ENG-123", "linear");
    expect(mockReadLinearSpec).toHaveBeenCalledWith("ENG-123");
    expect(result.source).toBe("linear");
  });

  it("routes to readJiraSpec when provider is 'jira'", async () => {
    mockReadJiraSpec.mockResolvedValue({
      source: "jira",
      issueKey: "ENG-123",
      title: "T",
      content: "C",
    });

    const result = await loadSpec("ENG-123", "jira");
    expect(mockReadJiraSpec).toHaveBeenCalledWith("ENG-123");
    expect(result.source).toBe("jira");
  });

  it("extracts Linear ID from URL when provider is 'linear'", async () => {
    mockIsLinearUrl.mockReturnValue(true);
    mockExtractLinearId.mockReturnValue("DT-267");
    mockReadLinearSpec.mockResolvedValue({
      source: "linear",
      issueId: "DT-267",
      title: "T",
      content: "C",
    });

    const result = await loadSpec("https://linear.app/team/issue/DT-267", "linear");
    expect(mockReadLinearSpec).toHaveBeenCalledWith("DT-267");
    expect(result.source).toBe("linear");
  });

  it("provider param bypasses env-based auto-detection", async () => {
    // Even with Jira env vars set, provider=linear should use Linear
    process.env.JIRA_URL = "https://test.atlassian.net";
    process.env.JIRA_EMAIL = "a@b.com";
    process.env.JIRA_API_TOKEN = "tok";

    mockReadLinearSpec.mockResolvedValue({
      source: "linear",
      issueId: "PROJ-1",
      title: "T",
      content: "C",
    });

    const result = await loadSpec("PROJ-1", "linear");
    expect(mockReadLinearSpec).toHaveBeenCalledWith("PROJ-1");
    expect(mockReadJiraSpec).not.toHaveBeenCalled();
    expect(result.source).toBe("linear");

    delete process.env.JIRA_URL;
    delete process.env.JIRA_EMAIL;
    delete process.env.JIRA_API_TOKEN;
  });
});

describe("readSpec", () => {
  beforeEach(() => {
    vi.spyOn(process, "cwd").mockReturnValue("/fake");
  });

  it("throws SpecError when file not found", () => {
    mockExistsSync.mockReturnValue(false);
    expect(() => readSpec("nonexistent.md")).toThrow(SpecError);
    expect(() => readSpec("nonexistent.md")).toThrow(/not found/i);
  });

  it("throws SpecError when file empty", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("");
    expect(() => readSpec("empty.md")).toThrow(/empty/i);
  });

  it("throws when file contains only ticket ref", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("DT-267");
    expect(() => readSpec("ref.md")).toThrow(/ticket reference/i);
  });

  it("throws when file contains only Linear URL", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("https://linear.app/team/issue/DT-267");
    expect(() => readSpec("url.md")).toThrow(/Linear URL/i);
  });

  it("extracts title from H1 heading", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("# My Title\n\nBody content");
    const result = readSpec("spec.md");
    expect(result.title).toBe("My Title");
  });

  it("uses filename as title when no H1", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("No heading here, just content.");
    const result = readSpec("my-spec.md");
    expect(result.title).toBe("my-spec");
  });

  it("returns full content", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("# Title\n\nFull content here");
    const result = readSpec("spec.md");
    expect(result.content).toContain("Full content here");
    expect(result.source).toBe("markdown");
  });
});
