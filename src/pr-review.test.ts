import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IncomingMessage } from "node:http";
import { EventEmitter } from "node:events";

// --- Mock setup (hoisted for vi.mock factories) ---

const { mockExecFile, mockHttpsRequest } = vi.hoisted(() => ({
  mockExecFile: vi.fn<(cmd: string, args: string[]) => string | Error>(),
  mockHttpsRequest: vi.fn(),
}));

vi.mock("@inquirer/prompts", () => ({ select: vi.fn() }));
vi.mock("./config.js", () => ({
  getAgents: vi.fn(() => [
    {
      name: "pr-reviewer",
      role: "reviewer",
      systemPrompt: "Review this code.",
      provider: "claude",
      model: "claude-3-haiku",
    },
  ]),
}));
vi.mock("./spawn.js", () => ({ spawnAgentStream: vi.fn() }));
vi.mock("./implement.js", () => ({
  spawnAgent: vi.fn(() => ({
    exitCode: 0,
    stdout: JSON.stringify({
      summary: "Looks good",
      comments: [],
      recommendedActions: [],
    }),
    usage: { inputTokens: 100, outputTokens: 50 },
  })),
}));

vi.mock("node:child_process", () => ({
  execFile: (cmd: string, args: string[], opts: unknown, cb: Function) => {
    const result = mockExecFile(cmd, args);
    setImmediate(() => {
      if (result instanceof Error) {
        cb(result, "", result.message);
      } else {
        cb(null, result, "");
      }
    });
  },
}));

vi.mock("node:https", () => ({
  request: mockHttpsRequest,
}));

// Mock pr-create exports that resolve TLS
vi.mock("./pr-create.js", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    resolveToken: vi.fn(async () => "mock-token-123"),
    resolveTlsOptions: vi.fn(async () => ({})),
  };
});

import { extractPRReviewOutput, formatPRReviewOutput, runPRReview, postPRReviewComment } from "./pr-review.js";
import type { PRReviewOutput, TaskContext } from "./task.js";

// --- Helpers ---

function setupHttpResponses(responses: Array<{ status: number; body: string }>) {
  for (const r of responses) {
    mockHttpsRequest.mockImplementationOnce((_opts: any, cb: Function) => {
      const res = new EventEmitter() as IncomingMessage;
      (res as any).statusCode = r.status;

      const req = new EventEmitter() as any;
      req.end = vi.fn(async () => {
        await Promise.resolve(); // Ensure callback runs after current stack
        cb(res);
        await Promise.resolve(); // Ensure data emission runs after callback
        res.emit("data", Buffer.from(r.body));
        res.emit("end");
      });
      req.write = vi.fn();
      return req;
    });
  }
}

function setupSharedGitMocks() {
  return {
    branch: "feat/my-feature\n",
    diffStat: " src/a.ts | 10 ++++\n 1 file changed",
    log: "abc1234 initial commit\n",
  };
}

function setupGitHubRemote() {
  const shared = setupSharedGitMocks();
  mockExecFile.mockImplementation((cmd, args) => {
    if (cmd === "git" && args[0] === "remote" && args[1] === "get-url") {
      return "https://github.com/owner/repo.git";
    }
    if (cmd === "git" && args[0] === "branch" && args[1] === "--show-current") {
      return shared.branch;
    }
    if (cmd === "git" && args[0] === "diff" && args[1] === "--stat") {
      return shared.diffStat;
    }
    if (cmd === "git" && args[0] === "log") {
      return shared.log;
    }
    return "";
  });
}

function setupGitLabRemote() {
  const shared = setupSharedGitMocks();
  mockExecFile.mockImplementation((cmd, args) => {
    if (cmd === "git" && args[0] === "remote" && args[1] === "get-url") {
      return "https://gitlab.company.com/owner/repo.git";
    }
    if (cmd === "git" && args[0] === "branch" && args[1] === "--show-current") {
      return shared.branch;
    }
    if (cmd === "git" && args[0] === "diff" && args[1] === "--stat") {
      return shared.diffStat;
    }
    if (cmd === "git" && args[0] === "log") {
      return shared.log;
    }
    return "";
  });
}

function makeContext(prNumber?: number): TaskContext {
  return {
    spec: { source: "markdown" as const, title: "Test", content: "test content" },
    prCreate: prNumber ? { branch: "feat/x", commitMessage: "c", prUrl: "url", prNumber } : undefined,
    results: [],
  };
}

// --- Tests ---

beforeEach(() => {
  vi.clearAllMocks();
});

describe("extractPRReviewOutput", () => {
  it("extracts valid review JSON", () => {
    const input = JSON.stringify({
      summary: "Good PR",
      comments: [{ file: "src/a.ts", line: 10, comment: "Nice" }],
      recommendedActions: ["Ship it"],
    });
    const result = extractPRReviewOutput(input);
    expect(result.summary).toBe("Good PR");
    expect(result.comments).toHaveLength(1);
    expect(result.comments[0].file).toBe("src/a.ts");
    expect(result.comments[0].line).toBe(10);
    expect(result.recommendedActions).toEqual(["Ship it"]);
  });

  it("extracts from fenced block", () => {
    const input = 'Here is my review:\n```json\n{"summary": "OK", "comments": [], "recommendedActions": []}\n```';
    const result = extractPRReviewOutput(input);
    expect(result.summary).toBe("OK");
  });

  it("handles null line in comment", () => {
    const input = JSON.stringify({
      summary: "Review",
      comments: [{ file: "b.ts", line: null, comment: "General" }],
      recommendedActions: [],
    });
    const result = extractPRReviewOutput(input);
    expect(result.comments[0].line).toBeNull();
  });

  it("handles missing line field as null", () => {
    const input = JSON.stringify({
      summary: "Review",
      comments: [{ file: "b.ts", comment: "No line" }],
      recommendedActions: [],
    });
    const result = extractPRReviewOutput(input);
    expect(result.comments[0].line).toBeNull();
  });

  it("throws when no JSON found", () => {
    expect(() => extractPRReviewOutput("no json here")).toThrow(/failed to extract/);
  });

  it("throws when summary missing", () => {
    const input = JSON.stringify({
      comments: [],
      recommendedActions: [],
    });
    expect(() => extractPRReviewOutput(input)).toThrow();
  });

  it("throws when comments is not array", () => {
    const input = JSON.stringify({
      summary: "OK",
      comments: "not array",
      recommendedActions: [],
    });
    expect(() => extractPRReviewOutput(input)).toThrow(/comments.*array/i);
  });

  it("throws when comment missing file", () => {
    const input = JSON.stringify({
      summary: "OK",
      comments: [{ comment: "no file" }],
      recommendedActions: [],
    });
    expect(() => extractPRReviewOutput(input)).toThrow(/missing 'file'/);
  });

  it("throws when recommendedActions item not string", () => {
    const input = JSON.stringify({
      summary: "OK",
      comments: [],
      recommendedActions: [42],
    });
    expect(() => extractPRReviewOutput(input)).toThrow(/must be a string/);
  });
});

describe("formatPRReviewOutput", () => {
  it("formats basic output", () => {
    const output: PRReviewOutput = {
      summary: "LGTM",
      comments: [],
      recommendedActions: [],
    };
    const result = formatPRReviewOutput(output);
    expect(result).toContain("## Summary");
    expect(result).toContain("LGTM");
  });

  it("groups comments by file", () => {
    const output: PRReviewOutput = {
      summary: "Review",
      comments: [
        { file: "a.ts", line: 1, comment: "Fix this" },
        { file: "a.ts", line: 5, comment: "And this" },
        { file: "b.ts", line: null, comment: "General" },
      ],
      recommendedActions: [],
    };
    const result = formatPRReviewOutput(output);
    expect(result).toContain("### a.ts");
    expect(result).toContain("### b.ts");
    expect(result).toContain("a.ts:1: Fix this");
    expect(result).toContain("a.ts:5: And this");
  });

  it("includes recommended actions", () => {
    const output: PRReviewOutput = {
      summary: "OK",
      comments: [],
      recommendedActions: ["Add tests", "Update docs"],
    };
    const result = formatPRReviewOutput(output);
    expect(result).toContain("## Recommended Actions");
    expect(result).toContain("Add tests");
    expect(result).toContain("Update docs");
  });

  it("omits comments section when empty", () => {
    const output: PRReviewOutput = {
      summary: "Clean",
      comments: [],
      recommendedActions: [],
    };
    const result = formatPRReviewOutput(output);
    expect(result).not.toContain("## Comments");
  });

  it("omits recommended actions section when empty", () => {
    const output: PRReviewOutput = {
      summary: "Clean",
      comments: [],
      recommendedActions: [],
    };
    const result = formatPRReviewOutput(output);
    expect(result).not.toContain("## Recommended Actions");
  });

  it("shows line ref only when line not null", () => {
    const output: PRReviewOutput = {
      summary: "x",
      comments: [{ file: "c.ts", line: null, comment: "whole file" }],
      recommendedActions: [],
    };
    const result = formatPRReviewOutput(output);
    expect(result).toContain("c.ts: whole file");
    expect(result).not.toContain("c.ts:null");
  });
});

describe("runPRReview - GitHub platform", () => {
  it("fetches diff via GitHub REST API", async () => {
    setupGitHubRemote();

    // 3 parallel HTTP calls: getDiff, getBaseBranch (stat), getBaseBranch (log)
    setupHttpResponses([
      { status: 200, body: "diff --git a/src/a.ts b/src/a.ts\n+added line" },
      { status: 200, body: JSON.stringify({ base: { ref: "main" } }) },
      { status: 200, body: JSON.stringify({ base: { ref: "main" } }) },
    ]);

    const context = makeContext(42);
    const { output } = await runPRReview(context);

    expect(output.summary).toBe("Looks good");
    expect(mockHttpsRequest).toHaveBeenCalledTimes(3);
    const firstCall = mockHttpsRequest.mock.calls[0][0];
    expect(firstCall.hostname).toBe("api.github.com");
    expect(firstCall.path).toContain("/repos/owner/repo/pulls/42");
  });
});

describe("runPRReview - GitLab platform", () => {
  it("fetches diff via GitLab REST API", async () => {
    setupGitLabRemote();

    // 3 parallel HTTP calls: getDiff, getBaseBranch (stat), getBaseBranch (log)
    setupHttpResponses([
      { status: 200, body: JSON.stringify({
        changes: [{ old_path: "src/a.ts", new_path: "src/a.ts", diff: "@@ -1,3 +1,4 @@\n+new line" }],
      }) },
      { status: 200, body: JSON.stringify({ target_branch: "main" }) },
      { status: 200, body: JSON.stringify({ target_branch: "main" }) },
    ]);

    const context = makeContext(7);
    const { output } = await runPRReview(context);

    expect(output.summary).toBe("Looks good");
    const firstCall = mockHttpsRequest.mock.calls[0][0];
    expect(firstCall.hostname).toBe("gitlab.company.com");
    expect(firstCall.path).toContain("/merge_requests/7/changes");
  });
});

describe("postPRReviewComment - GitHub", () => {
  it("posts comment via GitHub issues API", async () => {
    setupGitHubRemote();

    setupHttpResponses([
      { status: 201, body: "{}" },
    ]);

    const context = makeContext(42);
    const review: PRReviewOutput = {
      summary: "LGTM",
      comments: [],
      recommendedActions: [],
    };

    await postPRReviewComment(context, review);

    expect(mockHttpsRequest).toHaveBeenCalledTimes(1);
    const callOpts = mockHttpsRequest.mock.calls[0][0];
    expect(callOpts.hostname).toBe("api.github.com");
    expect(callOpts.path).toContain("/issues/42/comments");
    expect(callOpts.method).toBe("POST");
  });
});

describe("postPRReviewComment - GitLab", () => {
  it("posts note via GitLab MR notes API", async () => {
    setupGitLabRemote();

    setupHttpResponses([
      { status: 201, body: "{}" },
    ]);

    const context = makeContext(7);
    const review: PRReviewOutput = {
      summary: "Needs work",
      comments: [{ file: "x.ts", line: 1, comment: "fix" }],
      recommendedActions: ["Fix it"],
    };

    await postPRReviewComment(context, review);

    expect(mockHttpsRequest).toHaveBeenCalledTimes(1);
    const callOpts = mockHttpsRequest.mock.calls[0][0];
    expect(callOpts.hostname).toBe("gitlab.company.com");
    expect(callOpts.path).toContain("/merge_requests/7/notes");
    expect(callOpts.method).toBe("POST");
  });
});

describe("detectPRFromBranch - GitHub", () => {
  it("detects PR from branch when no context.prCreate", async () => {
    setupGitHubRemote();

    // 4 HTTP calls: detectPR, getDiff, getBaseBranch (stat), getBaseBranch (log)
    setupHttpResponses([
      { status: 200, body: JSON.stringify([{ number: 99 }]) },
      { status: 200, body: "diff --git a/f.ts b/f.ts\n+x" },
      { status: 200, body: JSON.stringify({ base: { ref: "main" } }) },
      { status: 200, body: JSON.stringify({ base: { ref: "main" } }) },
    ]);

    const context: TaskContext = {
      spec: { source: "markdown" as const, title: "T", content: "c" },
      results: [],
    };
    const { output } = await runPRReview(context);
    expect(output.summary).toBe("Looks good");

    // First call should be detecting PR from branch
    const detectCall = mockHttpsRequest.mock.calls[0][0];
    expect(detectCall.path).toContain("pulls?head=");
    expect(detectCall.path).toContain("state=open");
  });
});

describe("detectPRFromBranch - GitLab", () => {
  it("detects MR from branch when no context.prCreate", async () => {
    setupGitLabRemote();

    // 4 HTTP calls: detectMR, getDiff, getBaseBranch (stat), getBaseBranch (log)
    setupHttpResponses([
      { status: 200, body: JSON.stringify([{ iid: 15 }]) },
      { status: 200, body: JSON.stringify({
        changes: [{ old_path: "a.ts", new_path: "a.ts", diff: "+line" }],
      }) },
      { status: 200, body: JSON.stringify({ target_branch: "develop" }) },
      { status: 200, body: JSON.stringify({ target_branch: "develop" }) },
    ]);

    const context: TaskContext = {
      spec: { source: "markdown" as const, title: "T", content: "c" },
      results: [],
    };
    const { output } = await runPRReview(context);
    expect(output.summary).toBe("Looks good");

    const detectCall = mockHttpsRequest.mock.calls[0][0];
    expect(detectCall.path).toContain("merge_requests?source_branch=");
    expect(detectCall.path).toContain("state=opened");
  });
});
