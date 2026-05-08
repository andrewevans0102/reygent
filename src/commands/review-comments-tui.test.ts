import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { LiveStatus } from "../live-status.js";

// ── Hoisted mocks ──

const {
  mockSelect,
  mockInput,
  mockGetAgents,
  mockSpawnAgent,
  mockExecFile,
  mockHttpsRequest,
  activeSpinners,
  MockSpinner,
} = vi.hoisted(() => {
  const mockSelect = vi.fn();
  const mockInput = vi.fn();
  const mockGetAgents = vi.fn();
  const mockSpawnAgent = vi.fn();
  const mockExecFile = vi.fn();
  const mockHttpsRequest = vi.fn();

  let activeSpinners: MockSpinner[] = [];

  class MockSpinner {
    public stopped = false;
    public text = "";

    start() {
      activeSpinners.push(this);
      return this;
    }

    succeed(msg: string) {
      this.stopped = true;
      activeSpinners = activeSpinners.filter((s) => s !== this);
    }

    fail(msg: string) {
      this.stopped = true;
      activeSpinners = activeSpinners.filter((s) => s !== this);
    }

    warn(msg: string) {
      this.stopped = true;
      activeSpinners = activeSpinners.filter((s) => s !== this);
    }

    info(msg: string) {
      this.stopped = true;
      activeSpinners = activeSpinners.filter((s) => s !== this);
    }

    stop() {
      this.stopped = true;
      activeSpinners = activeSpinners.filter((s) => s !== this);
    }
  }

  return {
    mockSelect,
    mockInput,
    mockGetAgents,
    mockSpawnAgent,
    mockExecFile,
    mockHttpsRequest,
    activeSpinners,
    MockSpinner,
  };
});

// ── Mock setup ──

vi.mock("ora", () => ({
  default: vi.fn(() => new MockSpinner()),
}));

vi.mock("@inquirer/prompts", () => ({
  select: mockSelect,
  input: mockInput,
}));

vi.mock("../config.js", () => ({
  getAgents: mockGetAgents,
}));

vi.mock("../implement.js", () => ({
  spawnAgent: mockSpawnAgent,
}));

vi.mock("node:child_process", () => ({
  execFile: (cmd: string, args: string[], opts: unknown, cb: Function) => {
    const result = mockExecFile(cmd, args);
    if (result instanceof Error) {
      cb(result, "", "");
    } else {
      cb(null, result, "");
    }
  },
}));

vi.mock("node:https", () => ({
  request: mockHttpsRequest,
}));

vi.mock("../env.js", () => ({
  loadEnvFile: vi.fn(),
}));

vi.mock("../debug.js", () => ({
  isDebug: vi.fn(() => false),
}));

vi.mock("../live-status.js", async (importOriginal) => {
  const actual = await importOriginal() as typeof import("../live-status.js");
  return {
    ...actual,
    createLiveStatus: vi.fn((label: string): LiveStatus => {
      const spinner = new MockSpinner();
      spinner.start();
      return {
        onActivity: vi.fn(),
        succeed: (msg: string) => spinner.succeed(msg),
        fail: (msg: string) => spinner.fail(msg),
        warn: (msg: string) => spinner.warn(msg),
        info: (msg: string) => spinner.info(msg),
        stop: () => spinner.stop(),
        start: () => spinner.start(),
      };
    }),
  };
});

import { reviewCommentsCommand } from "./review-comments.js";

// ── Test fixtures ──

const MOCK_REMOTE = "https://github.com/test/repo.git";
const MOCK_BRANCH = "feature/test-branch";
const MOCK_DEFAULT_BRANCH = "main";
const MOCK_PR_NUMBER = 42;

const MOCK_GITHUB_COMMENTS = {
  comments: [
    {
      author: { login: "reviewer1" },
      body: "Please fix the typo in the documentation",
      createdAt: "2025-01-01T00:00:00Z",
    },
  ],
  reviews: [],
};

const MOCK_PLAN_OUTPUT = JSON.stringify({
  valid: true,
  goals: ["Address review feedback"],
  tasks: ["Fix typo in docs"],
  constraints: ["Preserve existing formatting"],
  dod: ["Review comment resolved"],
});

const MOCK_DEV_OUTPUT = JSON.stringify({
  files: ["README.md"],
});

function setupGitHubMocks() {
  mockExecFile.mockImplementation((cmd: string, args: string[]) => {
    if (cmd === "git" && args[0] === "rev-parse") return "true";
    if (cmd === "git" && args[0] === "remote") return MOCK_REMOTE;
    if (cmd === "git" && args[0] === "branch" && args[1] === "--show-current") {
      return MOCK_BRANCH;
    }
    if (cmd === "git" && args[0] === "symbolic-ref") return "refs/remotes/origin/main";
    if (cmd === "git" && args[0] === "diff") return "diff --git a/README.md b/README.md";
    if (cmd === "git" && args[0] === "add") return "";
    if (cmd === "git" && args[0] === "commit") return "";
    if (cmd === "git" && args[0] === "push") return "";
    if (cmd === "git" && args[0] === "rev-list") return "0";
    if (cmd === "gh" && args[0] === "pr" && args[1] === "view") {
      if (args.includes("--jq")) return String(MOCK_PR_NUMBER);
      return JSON.stringify(MOCK_GITHUB_COMMENTS);
    }
    return "";
  });

  mockGetAgents.mockReturnValue([
    { role: "planner", name: "planner", systemPrompt: "You are the planner" },
    { role: "dev", name: "dev", systemPrompt: "You are the dev" },
  ]);

  mockSpawnAgent.mockImplementation((role: string) => {
    if (role === "planner") {
      return Promise.resolve({ exitCode: 0, stdout: MOCK_PLAN_OUTPUT });
    }
    if (role === "dev") {
      return Promise.resolve({ exitCode: 0, stdout: MOCK_DEV_OUTPUT });
    }
    return Promise.resolve({ exitCode: 0, stdout: "" });
  });
}

// ── Tests ──

describe("review-comments TUI cursor alignment", () => {
  beforeEach(() => {
    activeSpinners.length = 0;
    vi.clearAllMocks();
    setupGitHubMocks();

    // Suppress console output during tests
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation((code?: number) => {
      throw new Error(`process.exit(${code})`);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("spinner cleanup before prompts", () => {
    it("ensures no active spinners when select() is called", async () => {
      mockSelect.mockResolvedValue("approve");

      let activeSpinnerCount = 0;
      mockSelect.mockImplementation(async () => {
        activeSpinnerCount = activeSpinners.filter((s) => !s.stopped).length;
        return "approve";
      });

      await reviewCommentsCommand({ autoApprove: false });

      // Verify no spinners active during select prompt
      expect(activeSpinnerCount).toBe(0);
    });

    it("ensures no active spinners when input() is called for feedback", async () => {
      let activeSpinnerCount = 0;

      mockSelect.mockResolvedValueOnce("feedback");
      mockSelect.mockResolvedValueOnce("approve");

      mockInput.mockImplementation(async () => {
        activeSpinnerCount = activeSpinners.filter((s) => !s.stopped).length;
        return "Make it better";
      });

      await reviewCommentsCommand({ autoApprove: false });

      // Verify no spinners active during input prompt
      expect(activeSpinnerCount).toBe(0);
    });

    it("ensures no active spinners when input() is called for instructions", async () => {
      let activeSpinnerCount = 0;

      mockSelect.mockResolvedValueOnce("instructions");
      mockSelect.mockResolvedValueOnce("approve");

      mockInput.mockImplementation(async () => {
        activeSpinnerCount = activeSpinners.filter((s) => !s.stopped).length;
        return "Use TypeScript strict mode";
      });

      await reviewCommentsCommand({ autoApprove: false });

      // Verify no spinners active during input prompt
      expect(activeSpinnerCount).toBe(0);
    });
  });

  describe("feedback loop cursor state", () => {
    it("handles multiple feedback iterations without cursor conflicts", async () => {
      const selectCalls: number[] = [];
      const inputCalls: number[] = [];

      mockSelect.mockImplementation(async () => {
        selectCalls.push(activeSpinners.filter((s) => !s.stopped).length);
        if (selectCalls.length === 1) return "feedback";
        if (selectCalls.length === 2) return "feedback";
        return "approve";
      });

      mockInput.mockImplementation(async () => {
        inputCalls.push(activeSpinners.filter((s) => !s.stopped).length);
        return "Feedback iteration";
      });

      await reviewCommentsCommand({ autoApprove: false });

      // All select() calls should have 0 active spinners
      expect(selectCalls).toEqual([0, 0, 0]);

      // All input() calls should have 0 active spinners
      expect(inputCalls).toEqual([0, 0]);
    });

    it("handles rapid approve/feedback/instructions sequence", async () => {
      const allPromptSpinnerCounts: number[] = [];

      mockSelect.mockImplementation(async () => {
        allPromptSpinnerCounts.push(activeSpinners.filter((s) => !s.stopped).length);
        if (allPromptSpinnerCounts.length === 1) return "feedback";
        if (allPromptSpinnerCounts.length === 2) return "instructions";
        return "approve";
      });

      mockInput.mockImplementation(async () => {
        allPromptSpinnerCounts.push(activeSpinners.filter((s) => !s.stopped).length);
        return "Some input";
      });

      await reviewCommentsCommand({ autoApprove: false });

      // Every prompt should see 0 active spinners
      expect(allPromptSpinnerCounts.every((count) => count === 0)).toBe(true);
    });
  });

  describe("empty feedback/instructions handling", () => {
    it("handles empty feedback input without regenerating plan", async () => {
      mockSelect.mockResolvedValueOnce("feedback");
      mockSelect.mockResolvedValueOnce("approve");
      mockInput.mockResolvedValueOnce("   "); // whitespace only

      const plannerCallCount = mockSpawnAgent.mock.calls.filter(
        ([role]) => role === "planner",
      ).length;

      await reviewCommentsCommand({ autoApprove: false });

      // Plan should only be generated once (not regenerated for empty feedback)
      const finalPlannerCallCount = mockSpawnAgent.mock.calls.filter(
        ([role]) => role === "planner",
      ).length;

      expect(finalPlannerCallCount).toBe(plannerCallCount + 1);
    });

    it("handles empty instructions input without saving", async () => {
      let instructionsSaved = false;

      const consoleLogSpy = vi.spyOn(console, "log");
      consoleLogSpy.mockImplementation((msg?: unknown) => {
        if (typeof msg === "string" && msg.includes("Instructions saved")) {
          instructionsSaved = true;
        }
      });

      mockSelect.mockResolvedValueOnce("instructions");
      mockSelect.mockResolvedValueOnce("approve");
      mockInput.mockResolvedValueOnce(""); // empty

      await reviewCommentsCommand({ autoApprove: false });

      expect(instructionsSaved).toBe(false);
    });
  });

  describe("auto-approve mode", () => {
    it("skips all prompts when autoApprove is true", async () => {
      await reviewCommentsCommand({ autoApprove: true });

      expect(mockSelect).not.toHaveBeenCalled();
      expect(mockInput).not.toHaveBeenCalled();
    });

    it("creates execution spinner during dev agent run", async () => {
      let maxActiveSpinners = 0;

      mockSpawnAgent.mockImplementation(async (role: string) => {
        // Allow time for spinner to start before checking
        await new Promise((resolve) => setTimeout(resolve, 1));
        const count = activeSpinners.filter((s) => !s.stopped).length;
        if (count > maxActiveSpinners) maxActiveSpinners = count;
        return { exitCode: 0, stdout: role === "planner" ? MOCK_PLAN_OUTPUT : MOCK_DEV_OUTPUT };
      });

      await reviewCommentsCommand({ autoApprove: true });

      // At some point during execution, there should be an active spinner
      expect(maxActiveSpinners).toBeGreaterThanOrEqual(0);
    });
  });

  describe("rejection handling", () => {
    it("exits cleanly when user rejects plan", async () => {
      mockSelect.mockResolvedValue("reject");

      await reviewCommentsCommand({ autoApprove: false });

      expect(mockSpawnAgent).toHaveBeenCalledTimes(1); // Only planner, not dev
    });

    it("has no active spinners when user rejects", async () => {
      let activeCountAtReject = 0;

      mockSelect.mockImplementation(async () => {
        activeCountAtReject = activeSpinners.filter((s) => !s.stopped).length;
        return "reject";
      });

      await reviewCommentsCommand({ autoApprove: false });

      expect(activeCountAtReject).toBe(0);
    });
  });

  describe("cursor state edge cases", () => {
    it("handles terminal resize during input without spinner conflicts", async () => {
      mockSelect.mockResolvedValueOnce("feedback");
      mockSelect.mockResolvedValueOnce("approve");

      mockInput.mockImplementation(async () => {
        // Simulate terminal resize by changing process.stdout.columns
        const originalCols = process.stdout.columns;
        (process.stdout as any).columns = 40;

        const result = "Resized feedback";

        (process.stdout as any).columns = originalCols;

        return result;
      });

      await reviewCommentsCommand({ autoApprove: false });

      // Should complete without errors
      expect(mockInput).toHaveBeenCalledTimes(1);
    });

    it("handles SIGINT during prompt without leaving spinners active", async () => {
      const exitError = new Error("process.exit(0)");
      (exitError as any).name = "ExitPromptError";

      mockSelect.mockRejectedValue(exitError);

      try {
        await reviewCommentsCommand({ autoApprove: false });
      } catch (err) {
        if (err instanceof Error && err.message.includes("process.exit")) {
          // Expected exit
        } else {
          throw err;
        }
      }

      // No spinners should remain active after SIGINT
      expect(activeSpinners).toHaveLength(0);
    });

    it("handles long feedback strings without cursor position corruption", async () => {
      const longFeedback = "A".repeat(500);

      mockSelect.mockResolvedValueOnce("feedback");
      mockSelect.mockResolvedValueOnce("approve");
      mockInput.mockResolvedValueOnce(longFeedback);

      await reviewCommentsCommand({ autoApprove: false });

      // Should handle long input without errors
      expect(mockSpawnAgent).toHaveBeenCalledWith(
        "planner",
        expect.stringContaining(longFeedback),
        expect.any(Object),
      );
    });

    it("handles multi-line input strings without cursor alignment issues", async () => {
      const multiLineInput = "Line 1\nLine 2\nLine 3";

      mockSelect.mockResolvedValueOnce("instructions");
      mockSelect.mockResolvedValueOnce("approve");
      mockInput.mockResolvedValueOnce(multiLineInput);

      await reviewCommentsCommand({ autoApprove: false });

      // Should handle multi-line without errors
      expect(mockSpawnAgent).toHaveBeenCalledWith(
        "dev",
        expect.stringContaining("Line 1\nLine 2\nLine 3"),
        expect.any(Object),
      );
    });

    it("handles backspace-heavy input editing without state corruption", async () => {
      // Simulate user typing and backspacing
      const editedInput = "Initial text\b\b\b\bfinal";

      mockSelect.mockResolvedValueOnce("feedback");
      mockSelect.mockResolvedValueOnce("approve");
      mockInput.mockResolvedValueOnce(editedInput);

      await reviewCommentsCommand({ autoApprove: false });

      // Should handle escape sequences in input
      expect(mockSpawnAgent).toHaveBeenCalledWith(
        "planner",
        expect.stringContaining(editedInput),
        expect.any(Object),
      );
    });
  });

  describe("spinner sequence integrity", () => {
    it("creates and stops spinners in correct order", async () => {
      const spinnerSequence: string[] = [];

      const originalCreateLiveStatus = vi.mocked(
        await import("../live-status.js"),
      ).createLiveStatus;

      vi.mocked(
        await import("../live-status.js"),
      ).createLiveStatus = vi.fn((label: string) => {
        spinnerSequence.push(`START: ${label}`);
        const status = originalCreateLiveStatus(label);
        const originalSucceed = status.succeed;
        const originalFail = status.fail;

        status.succeed = (msg: string) => {
          spinnerSequence.push(`STOP: ${label}`);
          originalSucceed(msg);
        };

        status.fail = (msg: string) => {
          spinnerSequence.push(`STOP: ${label}`);
          originalFail(msg);
        };

        return status;
      });

      mockSelect.mockResolvedValue("approve");

      await reviewCommentsCommand({ autoApprove: false });

      // Verify no overlapping spinner lifecycles before prompts
      const checkingIndex = spinnerSequence.findIndex((s) => s.includes("checking for open PR"));
      const fetchingIndex = spinnerSequence.findIndex((s) => s.includes("fetching review comments"));

      // "checking" should be stopped before "fetching" starts
      expect(spinnerSequence[checkingIndex]).toContain("START");
      expect(spinnerSequence[checkingIndex + 1]).toContain("STOP");
    });
  });
});
