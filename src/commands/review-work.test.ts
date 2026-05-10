import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../config.js", () => ({
  getAgents: vi.fn(),
}));

vi.mock("../implement.js", () => ({
  spawnAgent: vi.fn(),
}));

vi.mock("../env.js", () => ({
  loadEnvFile: vi.fn(),
}));

vi.mock("../spec.js", () => ({
  loadSpec: vi.fn(),
  SpecError: class SpecError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "SpecError";
    }
  },
}));

vi.mock("../spec-prefix.js", () => ({
  parseSpecWithPrefix: vi.fn(),
  SpecPrefixError: class SpecPrefixError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "SpecPrefixError";
    }
  },
}));

vi.mock("../pr-create.js", () => ({
  parseRemote: vi.fn(),
  resolveToken: vi.fn(),
}));

vi.mock("../pr-review.js", () => ({
  runPRReview: vi.fn(),
  postPRReviewComment: vi.fn(),
  extractPRReviewOutput: vi.fn(),
  formatPRReviewTerminal: vi.fn(),
  formatPRReviewOutput: vi.fn(),
}));

vi.mock("../live-status.js", () => ({
  createLiveStatus: vi.fn(() => ({
    onActivity: vi.fn(),
    succeed: vi.fn(),
    fail: vi.fn(),
    stop: vi.fn(),
    start: vi.fn(),
  })),
}));

vi.mock("ora", () => ({
  default: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    info: vi.fn().mockReturnThis(),
  })),
}));

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

import { reviewWorkCommand } from "./review-work.js";
import { loadSpec } from "../spec.js";
import { parseSpecWithPrefix, SpecPrefixError } from "../spec-prefix.js";
import { parseRemote } from "../pr-create.js";
import { getAgents } from "../config.js";
import { spawnAgent } from "../implement.js";
import { execFile } from "node:child_process";

const mockLoadSpec = vi.mocked(loadSpec);
const mockParseSpecWithPrefix = vi.mocked(parseSpecWithPrefix);
const mockParseRemote = vi.mocked(parseRemote);
const mockGetAgents = vi.mocked(getAgents);
const mockSpawnAgent = vi.mocked(spawnAgent);
const mockExecFile = vi.mocked(execFile);

describe("review-work --spec prefix parsing", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Mock getAgents to return reviewer agent
    mockGetAgents.mockReturnValue([
      {
        role: "reviewer",
        systemPrompt: "You are a code reviewer",
        provider: "anthropic",
        model: "claude-3-7-sonnet-20250219",
      },
    ]);

    // Mock parseRemote to return GitHub platform by default
    mockParseRemote.mockReturnValue({
      platform: "github",
      host: "github.com",
      owner: "test",
      repo: "repo",
    });

    // Mock spawnAgent to return successful result
    mockSpawnAgent.mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify({
        summary: "Looks good",
        comments: [],
        recommendedActions: [],
      }),
      stderr: "",
    });

    // Mock git commands to prevent actual git operations
    mockExecFile.mockImplementation((cmd, args, opts, callback) => {
      if (!callback || typeof callback !== "function") return {} as any;

      if (args?.includes("--is-inside-work-tree")) {
        callback(null, "true\n", "");
      } else if (args?.includes("--show-current")) {
        callback(null, "feature/test\n", "");
      } else if (args?.includes("symbolic-ref")) {
        callback(null, "refs/remotes/origin/main\n", "");
      } else if (args?.includes("get-url")) {
        callback(null, "git@github.com:test/repo.git\n", "");
      } else if (args?.includes("diff")) {
        callback(null, "mock diff", "");
      } else if (args && args[0] === "pr" && args[1] === "view") {
        callback(new Error("not found"), "", "");
      } else {
        callback(null, "", "");
      }
      return {} as any;
    });
  });

  describe("spec prefix validation", () => {
    it("calls parseSpecWithPrefix when --spec provided", async () => {
      mockParseSpecWithPrefix.mockReturnValue({
        provider: "jira",
        identifier: "PROJ-123",
      });

      mockLoadSpec.mockResolvedValue({
        source: "jira",
        issueKey: "PROJ-123",
        title: "Test",
        content: "Content",
      });

      await reviewWorkCommand({ spec: "jira:PROJ-123" });

      expect(mockParseSpecWithPrefix).toHaveBeenCalledWith("jira:PROJ-123");
      expect(mockLoadSpec).toHaveBeenCalledWith("PROJ-123", "jira");
    });

    it("passes provider to loadSpec for jira prefix", async () => {
      mockParseSpecWithPrefix.mockReturnValue({
        provider: "jira",
        identifier: "ENG-456",
      });

      mockLoadSpec.mockResolvedValue({
        source: "jira",
        issueKey: "ENG-456",
        title: "Test",
        content: "Content",
      });

      await reviewWorkCommand({ spec: "jira:ENG-456" });

      expect(mockLoadSpec).toHaveBeenCalledWith("ENG-456", "jira");
    });

    it("passes provider to loadSpec for linear prefix", async () => {
      mockParseSpecWithPrefix.mockReturnValue({
        provider: "linear",
        identifier: "DT-275",
      });

      mockLoadSpec.mockResolvedValue({
        source: "linear",
        issueId: "DT-275",
        title: "Test",
        content: "Content",
      });

      await reviewWorkCommand({ spec: "linear:DT-275" });

      expect(mockLoadSpec).toHaveBeenCalledWith("DT-275", "linear");
    });

    it("passes local provider to loadSpec for markdown prefix", async () => {
      mockParseSpecWithPrefix.mockReturnValue({
        provider: "local",
        identifier: "./spec.md",
      });

      mockLoadSpec.mockResolvedValue({
        source: "markdown",
        title: "Test",
        content: "Content",
      });

      await reviewWorkCommand({ spec: "markdown:./spec.md" });

      expect(mockLoadSpec).toHaveBeenCalledWith("./spec.md", "local");
    });

    it("auto-infers markdown for file paths", async () => {
      mockParseSpecWithPrefix.mockReturnValue({
        provider: "local",
        identifier: "./test-spec.md",
      });

      mockLoadSpec.mockResolvedValue({
        source: "markdown",
        title: "Test",
        content: "Content",
      });

      await reviewWorkCommand({ spec: "./test-spec.md" });

      expect(mockParseSpecWithPrefix).toHaveBeenCalledWith("./test-spec.md");
      expect(mockLoadSpec).toHaveBeenCalledWith("./test-spec.md", "local");
    });
  });

  describe("error handling", () => {
    it("exits with error when parseSpecWithPrefix throws SpecPrefixError", async () => {
      const mockExit = vi.spyOn(process, "exit").mockImplementation((code?: any) => {
        throw new Error(`process.exit(${code})`);
      });

      const prefixError = new SpecPrefixError(
        "Source prefix required. Use jira:PROJ-123, linear:DT-275, or markdown:./spec.md"
      );

      mockParseSpecWithPrefix.mockImplementation(() => {
        throw prefixError;
      });

      try {
        await reviewWorkCommand({ spec: "PROJ-123" });
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as Error).message).toContain("process.exit");
        expect(prefixError).toBeInstanceOf(SpecPrefixError);
      }

      expect(mockExit).toHaveBeenCalledWith(1);
      mockExit.mockRestore();
    });

    it("shows clear error message for missing prefix", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const mockExit = vi.spyOn(process, "exit").mockImplementation((code?: any) => {
        throw new Error(`process.exit(${code})`);
      });

      const prefixError = new SpecPrefixError(
        "Source prefix required. Valid formats:\n" +
          "  jira:PROJ-123\n" +
          "  linear:DT-275\n" +
          "  markdown:./spec.md\n" +
          "Or use file path (ends in .md or starts with ./ or /)"
      );

      mockParseSpecWithPrefix.mockImplementation(() => {
        throw prefixError;
      });

      try {
        await reviewWorkCommand({ spec: "PROJ-123" });
      } catch (err) {
        // Expected to throw
        expect(err).toBeDefined();
      }

      expect(prefixError).toBeInstanceOf(SpecPrefixError);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Error:"),
        expect.stringContaining("prefix required")
      );

      consoleSpy.mockRestore();
      mockExit.mockRestore();
    });

    it("shows usage examples in error message", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const mockExit = vi.spyOn(process, "exit").mockImplementation((code?: any) => {
        throw new Error(`process.exit(${code})`);
      });

      const prefixError = new SpecPrefixError(
        "Source prefix required. Valid formats:\n" +
          "  jira:PROJ-123\n" +
          "  linear:DT-275\n" +
          "  markdown:./spec.md\n" +
          "Or use file path (ends in .md or starts with ./ or /)"
      );

      mockParseSpecWithPrefix.mockImplementation(() => {
        throw prefixError;
      });

      try {
        await reviewWorkCommand({ spec: "https://linear.app/team/issue/DT-275" });
      } catch (err) {
        // Expected
        expect(err).toBeDefined();
      }

      expect(prefixError).toBeInstanceOf(SpecPrefixError);

      const errorMessage = consoleSpy.mock.calls.find((call) =>
        call.some((arg) => typeof arg === "string" && arg.includes("prefix required"))
      );

      expect(errorMessage).toBeDefined();
      const fullMessage = errorMessage?.join(" ") || "";
      expect(fullMessage).toContain("jira:");
      expect(fullMessage).toContain("linear:");
      expect(fullMessage).toContain("markdown:");

      consoleSpy.mockRestore();
      mockExit.mockRestore();
    });
  });

  describe("file path auto-inference", () => {
    it("accepts .md extension without prefix", async () => {
      mockParseSpecWithPrefix.mockReturnValue({
        provider: "local",
        identifier: "spec.md",
      });

      mockLoadSpec.mockResolvedValue({
        source: "markdown",
        title: "Test",
        content: "Content",
      });

      await reviewWorkCommand({ spec: "spec.md" });

      expect(mockLoadSpec).toHaveBeenCalledWith("spec.md", "local");
    });

    it("accepts .markdown extension without prefix", async () => {
      mockParseSpecWithPrefix.mockReturnValue({
        provider: "local",
        identifier: "test.markdown",
      });

      mockLoadSpec.mockResolvedValue({
        source: "markdown",
        title: "Test",
        content: "Content",
      });

      await reviewWorkCommand({ spec: "test.markdown" });

      expect(mockLoadSpec).toHaveBeenCalledWith("test.markdown", "local");
    });

    it("accepts path starting with ./ without prefix", async () => {
      mockParseSpecWithPrefix.mockReturnValue({
        provider: "local",
        identifier: "./docs/spec.md",
      });

      mockLoadSpec.mockResolvedValue({
        source: "markdown",
        title: "Test",
        content: "Content",
      });

      await reviewWorkCommand({ spec: "./docs/spec.md" });

      expect(mockLoadSpec).toHaveBeenCalledWith("./docs/spec.md", "local");
    });

    it("accepts absolute path without prefix", async () => {
      mockParseSpecWithPrefix.mockReturnValue({
        provider: "local",
        identifier: "/Users/test/spec.md",
      });

      mockLoadSpec.mockResolvedValue({
        source: "markdown",
        title: "Test",
        content: "Content",
      });

      await reviewWorkCommand({ spec: "/Users/test/spec.md" });

      expect(mockLoadSpec).toHaveBeenCalledWith("/Users/test/spec.md", "local");
    });
  });

  describe("explicit prefix overrides", () => {
    it("allows markdown prefix on non-.md file", async () => {
      mockParseSpecWithPrefix.mockReturnValue({
        provider: "local",
        identifier: "spec.txt",
      });

      mockLoadSpec.mockResolvedValue({
        source: "markdown",
        title: "Test",
        content: "Content",
      });

      await reviewWorkCommand({ spec: "markdown:spec.txt" });

      expect(mockLoadSpec).toHaveBeenCalledWith("spec.txt", "local");
    });

    it("allows jira prefix on file-like identifier", async () => {
      mockParseSpecWithPrefix.mockReturnValue({
        provider: "jira",
        identifier: "./something",
      });

      mockLoadSpec.mockResolvedValue({
        source: "jira",
        issueKey: "./something",
        title: "Test",
        content: "Content",
      });

      await reviewWorkCommand({ spec: "jira:./something" });

      expect(mockLoadSpec).toHaveBeenCalledWith("./something", "jira");
    });

    it("allows linear prefix on Linear URL", async () => {
      mockParseSpecWithPrefix.mockReturnValue({
        provider: "linear",
        identifier: "https://linear.app/team/issue/DT-275",
      });

      mockLoadSpec.mockResolvedValue({
        source: "linear",
        issueId: "DT-275",
        title: "Test",
        content: "Content",
      });

      await reviewWorkCommand({ spec: "linear:https://linear.app/team/issue/DT-275" });

      expect(mockLoadSpec).toHaveBeenCalledWith(
        "https://linear.app/team/issue/DT-275",
        "linear"
      );
    });
  });
});
