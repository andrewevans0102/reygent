import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────

const mockSelect = vi.fn();
vi.mock("@inquirer/prompts", () => ({
  select: (...args: unknown[]) => mockSelect(...args),
}));

const inquirerCoreMock = vi.hoisted(() => {
  class MockExitPromptError extends Error {
    override name = "ExitPromptError";
  }
  return { MockExitPromptError };
});
vi.mock("@inquirer/core", () => ({
  ExitPromptError: inquirerCoreMock.MockExitPromptError,
}));

const mockLoadSpec = vi.fn();
vi.mock("../spec.js", () => ({
  loadSpec: (...args: unknown[]) => mockLoadSpec(...args),
  SpecError: class SpecError extends Error {
    override name = "SpecError";
  },
}));

vi.mock("../debug.js", () => ({ isDebug: vi.fn(() => false) }));

vi.mock("../planner.js", () => ({
  runPlanner: vi.fn(),
}));

vi.mock("../live-status.js", () => ({
  createLiveStatus: vi.fn(() => ({
    onActivity: vi.fn(),
    stop: vi.fn(),
    start: vi.fn(),
    succeed: vi.fn(),
    fail: vi.fn(),
  })),
}));

vi.mock("chalk", () => {
  const handler: ProxyHandler<object> = {
    get: (_target, _prop) => {
      const fn = (s: string) => s;
      return new Proxy(fn, handler);
    },
    apply: (_target, _thisArg, args) => args[0],
  };
  return { default: new Proxy({}, handler) };
});

// ── Imports (after mocks) ────────────────────────────────────────────

import { specCommand } from "./spec.js";

// ── Helpers ──────────────────────────────────────────────────────────

const linearPayload = {
  source: "linear" as const,
  issueId: "ENG-123",
  title: "Test issue",
  content: "Linear issue content",
};

const jiraPayload = {
  source: "jira" as const,
  issueKey: "ENG-123",
  title: "Test issue",
  content: "Jira issue content",
};

const markdownPayload = {
  source: "markdown" as const,
  title: "Feature spec",
  content: "# Feature spec\n\nDetails here",
};

// ── Tests ────────────────────────────────────────────────────────────

describe("specCommand — provider prompt", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetAllMocks();
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => {
        throw new Error("process.exit");
      });
    // Default: TTY available
    Object.defineProperty(process.stdin, "isTTY", { value: true, writable: true, configurable: true });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    exitSpy.mockRestore();
  });

  // ── Basic: issue key triggers provider prompt ─────────────────────

  describe("issue key argument triggers provider prompt", () => {
    it("prompts user to select provider when given an issue key like ENG-123", async () => {
      mockSelect.mockResolvedValue("linear");
      mockLoadSpec.mockResolvedValue(linearPayload);

      await specCommand("ENG-123", {});

      expect(mockSelect).toHaveBeenCalledTimes(1);
      const call = mockSelect.mock.calls[0][0];
      expect(call.message).toMatch(/provider/i);

      // Should offer Jira, Linear, and local as choices
      const values = call.choices.map((c: { value: string }) => c.value);
      expect(values).toContain("jira");
      expect(values).toContain("linear");
      expect(values).toContain("local");
    });

    it("passes selected provider to loadSpec as second arg", async () => {
      mockSelect.mockResolvedValue("jira");
      mockLoadSpec.mockResolvedValue(jiraPayload);

      await specCommand("PROJ-456", {});

      expect(mockLoadSpec).toHaveBeenCalledWith("PROJ-456", "jira");
    });

    it("outputs spec JSON after provider selection", async () => {
      mockSelect.mockResolvedValue("linear");
      mockLoadSpec.mockResolvedValue(linearPayload);

      await specCommand("ENG-123", {});

      const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(output).toContain("ENG-123");
      expect(output).toContain("Linear issue content");
    });
  });

  // ── --provider flag skips prompt ──────────────────────────────────

  describe("--provider flag skips prompt", () => {
    it("skips prompt when --provider linear is provided", async () => {
      mockLoadSpec.mockResolvedValue(linearPayload);

      await specCommand("ENG-123", { provider: "linear" });

      expect(mockSelect).not.toHaveBeenCalled();
      expect(mockLoadSpec).toHaveBeenCalledWith("ENG-123", "linear");
    });

    it("skips prompt when --provider jira is provided", async () => {
      mockLoadSpec.mockResolvedValue(jiraPayload);

      await specCommand("ENG-123", { provider: "jira" });

      expect(mockSelect).not.toHaveBeenCalled();
      expect(mockLoadSpec).toHaveBeenCalledWith("ENG-123", "jira");
    });

    it("skips prompt when --provider local is provided", async () => {
      mockLoadSpec.mockResolvedValue(markdownPayload);

      await specCommand("ENG-123", { provider: "local" });

      expect(mockSelect).not.toHaveBeenCalled();
      expect(mockLoadSpec).toHaveBeenCalledWith("ENG-123", "local");
    });
  });

  // ── .md file infers local provider without prompting ──────────────

  describe("auto-infers local provider for .md files", () => {
    it("skips prompt when source ends in .md", async () => {
      mockLoadSpec.mockResolvedValue(markdownPayload);

      await specCommand("./specs/feature.md", {});

      expect(mockSelect).not.toHaveBeenCalled();
      expect(mockLoadSpec).toHaveBeenCalledWith("./specs/feature.md", "local");
    });

    it("skips prompt when source ends in .markdown", async () => {
      mockLoadSpec.mockResolvedValue(markdownPayload);

      await specCommand("spec.markdown", {});

      expect(mockSelect).not.toHaveBeenCalled();
      expect(mockLoadSpec).toHaveBeenCalledWith("spec.markdown", "local");
    });

    it("skips prompt when source contains a path separator", async () => {
      mockLoadSpec.mockResolvedValue(markdownPayload);

      await specCommand("specs/my-feature", {});

      expect(mockSelect).not.toHaveBeenCalled();
      expect(mockLoadSpec).toHaveBeenCalledWith("specs/my-feature", "local");
    });
  });

  // ── Linear URL infers linear provider without prompting ───────────

  describe("auto-infers linear provider for Linear URLs", () => {
    it("skips prompt when source is a Linear URL", async () => {
      mockLoadSpec.mockResolvedValue(linearPayload);

      await specCommand("https://linear.app/team/issue/ENG-123", {});

      expect(mockSelect).not.toHaveBeenCalled();
      expect(mockLoadSpec).toHaveBeenCalledWith(
        "https://linear.app/team/issue/ENG-123",
        "linear",
      );
    });
  });

  // ── Invalid --provider value produces clear error ─────────────────

  describe("invalid --provider value", () => {
    it("produces a clear error for invalid provider value", async () => {
      await expect(
        specCommand("ENG-123", { provider: "github" }),
      ).rejects.toThrow("process.exit");

      const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(output).toMatch(/invalid/i);
      expect(output).toContain("github");
    });

    it("lists valid providers in error message", async () => {
      await expect(
        specCommand("ENG-123", { provider: "gitlab" }),
      ).rejects.toThrow("process.exit");

      const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(output).toContain("jira");
      expect(output).toContain("linear");
      expect(output).toContain("local");
    });
  });

  // ── Non-TTY without --provider errors gracefully ──────────────────

  describe("non-TTY environment handling", () => {
    it("errors when stdin is not a TTY and no --provider flag given for issue key", async () => {
      Object.defineProperty(process.stdin, "isTTY", { value: false, writable: true, configurable: true });

      await expect(
        specCommand("ENG-123", {}),
      ).rejects.toThrow("process.exit");

      const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(output).toMatch(/--provider/i);
    });

    it("works in non-TTY when --provider flag is given", async () => {
      Object.defineProperty(process.stdin, "isTTY", { value: false, writable: true, configurable: true });
      mockLoadSpec.mockResolvedValue(linearPayload);

      await specCommand("ENG-123", { provider: "linear" });

      expect(mockSelect).not.toHaveBeenCalled();
      const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      expect(output).toContain("ENG-123");
    });

    it("works in non-TTY for .md files (no prompt needed)", async () => {
      Object.defineProperty(process.stdin, "isTTY", { value: false, writable: true, configurable: true });
      mockLoadSpec.mockResolvedValue(markdownPayload);

      await specCommand("./specs/feature.md", {});

      expect(mockSelect).not.toHaveBeenCalled();
      expect(exitSpy).not.toHaveBeenCalled();
    });
  });

  // ── Existing behavior preserved ───────────────────────────────────

  describe("existing behavior preserved", () => {
    it("outputs JSON without prompt for file paths", async () => {
      mockLoadSpec.mockResolvedValue(markdownPayload);

      await specCommand("./specs/feature.md", {});

      expect(mockSelect).not.toHaveBeenCalled();
      const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
      const parsed = JSON.parse(output);
      expect(parsed.source).toBe("markdown");
    });

    it("still supports --clarify flag alongside --provider", async () => {
      const { runPlanner } = await import("../planner.js");
      const mockRunPlanner = vi.mocked(runPlanner);
      mockRunPlanner.mockResolvedValue({
        result: {
          goals: ["Goal 1"],
          tasks: ["Task 1"],
          constraints: ["Constraint 1"],
          dod: ["DoD 1"],
        },
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      });

      mockLoadSpec.mockResolvedValue(linearPayload);

      await specCommand("ENG-123", { clarify: true, provider: "linear" });

      expect(mockSelect).not.toHaveBeenCalled();
      expect(mockLoadSpec).toHaveBeenCalledWith("ENG-123", "linear");
      expect(mockRunPlanner).toHaveBeenCalled();
    });
  });

  // ── Ctrl+C during prompt exits cleanly ────────────────────────────

  describe("prompt cancellation", () => {
    it("exits with code 0 when user presses Ctrl+C during provider prompt", async () => {
      mockSelect.mockRejectedValue(
        new inquirerCoreMock.MockExitPromptError("User force closed the prompt"),
      );

      await expect(
        specCommand("ENG-123", {}),
      ).rejects.toThrow("process.exit");

      expect(exitSpy).toHaveBeenCalledWith(0);
    });
  });

  // ── Provider prompt choices are well-formed ───────────────────────

  describe("prompt shape", () => {
    it("each choice has a name and a value", async () => {
      mockSelect.mockResolvedValue("linear");
      mockLoadSpec.mockResolvedValue(linearPayload);

      await specCommand("ENG-123", {});

      const { choices } = mockSelect.mock.calls[0][0];
      for (const choice of choices) {
        expect(choice).toHaveProperty("value");
        expect(typeof choice.name === "string" || typeof choice.value === "string").toBe(true);
      }
    });

    it("offers exactly 3 provider choices", async () => {
      mockSelect.mockResolvedValue("linear");
      mockLoadSpec.mockResolvedValue(linearPayload);

      await specCommand("ENG-123", {});

      const { choices } = mockSelect.mock.calls[0][0];
      expect(choices).toHaveLength(3);
    });
  });

  // ── Issue key pattern edge cases ──────────────────────────────────

  describe("issue key pattern detection", () => {
    it("treats PROJ-1 as an issue key (prompts)", async () => {
      mockSelect.mockResolvedValue("linear");
      mockLoadSpec.mockResolvedValue(linearPayload);

      await specCommand("PROJ-1", {});

      expect(mockSelect).toHaveBeenCalled();
    });

    it("treats ABC-99999 as an issue key (prompts)", async () => {
      mockSelect.mockResolvedValue("jira");
      mockLoadSpec.mockResolvedValue(jiraPayload);

      await specCommand("ABC-99999", {});

      expect(mockSelect).toHaveBeenCalled();
    });

    it("does NOT treat a path like specs/ENG-123.md as an issue key", async () => {
      mockLoadSpec.mockResolvedValue(markdownPayload);

      await specCommand("specs/ENG-123.md", {});

      expect(mockSelect).not.toHaveBeenCalled();
    });

    it("does NOT treat a relative path without extension as an issue key", async () => {
      mockLoadSpec.mockResolvedValue(markdownPayload);

      await specCommand("./my-spec", {});

      expect(mockSelect).not.toHaveBeenCalled();
    });
  });
});
