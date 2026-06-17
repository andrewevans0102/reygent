import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./config.js", () => ({
  getAgents: vi.fn(() => [
    { name: "planner", systemPrompt: "You are a planner", role: "planner" },
  ]),
}));
vi.mock("./debug.js", () => ({ isDebug: vi.fn(() => false) }));
vi.mock("./planner.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./planner.js")>();
  return { ...actual, extractJSON: vi.fn((s: string) => s) };
});
vi.mock("./spawn.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./spawn.js")>();
  return { ...actual, spawnAgentStream: vi.fn() };
});

import {
  runClarification,
  generateSpec,
  isValidDetailLevel,
  DEFAULT_DETAIL_LEVEL,
  type DetailLevel,
} from "./generate-spec.js";
import { spawnAgentStream } from "./spawn.js";
import { extractJSON } from "./planner.js";
import { TaskError } from "./task.js";

const mockSpawn = vi.mocked(spawnAgentStream);
const mockExtractJSON = vi.mocked(extractJSON);

beforeEach(() => {
  vi.clearAllMocks();
  mockExtractJSON.mockImplementation((s: string) => s);
});

describe("runClarification", () => {
  it("returns ready when agent returns { ready: true }", async () => {
    mockSpawn.mockResolvedValue({
      stdout: '{ "ready": true }',
      exitCode: 0,
    });

    const result = await runClarification("build a REST API");
    expect(result).toEqual({ ready: true });
    expect(mockSpawn).toHaveBeenCalledWith(
      "generate-spec",
      expect.any(String),
      120_000,
      { quiet: true },
    );
  });

  it("returns questions when agent returns needsClarification", async () => {
    mockSpawn.mockResolvedValue({
      stdout: '{ "needsClarification": true, "questions": ["What auth method?", "Need pagination?"] }',
      exitCode: 0,
    });

    const result = await runClarification("build a REST API");
    expect(result).toEqual({
      needsClarification: true,
      questions: ["What auth method?", "Need pagination?"],
    });
  });

  it("falls back to ready when response is malformed", async () => {
    mockSpawn.mockResolvedValue({
      stdout: '"just a string"',
      exitCode: 0,
    });

    const result = await runClarification("build a REST API");
    expect(result).toEqual({ ready: true });
  });

  it("throws TaskError on non-zero exit code", async () => {
    mockSpawn.mockResolvedValue({
      stdout: "",
      exitCode: 1,
    });

    await expect(runClarification("build a REST API")).rejects.toThrow(TaskError);
    await expect(runClarification("build a REST API")).rejects.toThrow(
      "generate-spec: agent exited with code 1",
    );
  });

  it("throws TaskError on JSON parse failure", async () => {
    mockSpawn.mockResolvedValue({
      stdout: "not valid json {{{",
      exitCode: 0,
    });
    mockExtractJSON.mockReturnValue("not valid json {{{");

    await expect(runClarification("build a REST API")).rejects.toThrow(TaskError);
    await expect(runClarification("build a REST API")).rejects.toThrow(
      "generate-spec: failed to parse clarification response as JSON",
    );
  });

  it("filters out empty and non-string questions", async () => {
    mockSpawn.mockResolvedValue({
      stdout: JSON.stringify({
        needsClarification: true,
        questions: ["Valid question?", "", 42, "Another valid?", "   "],
      }),
      exitCode: 0,
    });

    const result = await runClarification("build a REST API");
    expect(result).toEqual({
      needsClarification: true,
      questions: ["Valid question?", "Another valid?"],
    });
  });

  it("filters out null and undefined questions", async () => {
    mockSpawn.mockResolvedValue({
      stdout: JSON.stringify({
        needsClarification: true,
        questions: ["Valid question?", null, undefined, "Another valid?"],
      }),
      exitCode: 0,
    });

    const result = await runClarification("build a REST API");
    expect(result).toEqual({
      needsClarification: true,
      questions: ["Valid question?", "Another valid?"],
    });
  });
});

describe("generateSpec", () => {
  it("returns agent stdout on success", async () => {
    const specMarkdown = "# My Spec\n\n## Overview\n\nA great feature.";
    mockSpawn.mockResolvedValue({
      stdout: specMarkdown,
      exitCode: 0,
    });

    const result = await generateSpec("build a REST API");
    expect(result).toBe(specMarkdown);
    expect(mockSpawn).toHaveBeenCalledWith(
      "generate-spec",
      expect.any(String),
      120_000,
      { onActivity: undefined },
    );
  });

  it("throws TaskError on non-zero exit code", async () => {
    mockSpawn.mockResolvedValue({
      stdout: "",
      exitCode: 1,
    });

    await expect(generateSpec("build a REST API")).rejects.toThrow(TaskError);
    await expect(generateSpec("build a REST API")).rejects.toThrow(
      "generate-spec: agent exited with code 1",
    );
  });

  it("throws TaskError on empty stdout", async () => {
    mockSpawn.mockResolvedValue({
      stdout: "",
      exitCode: 0,
    });

    await expect(generateSpec("build a REST API")).rejects.toThrow(TaskError);
    await expect(generateSpec("build a REST API")).rejects.toThrow(
      "generate-spec: empty result from agent",
    );
  });
});

describe("isValidDetailLevel", () => {
  it("accepts integers 1 through 5", () => {
    expect(isValidDetailLevel(1)).toBe(true);
    expect(isValidDetailLevel(2)).toBe(true);
    expect(isValidDetailLevel(3)).toBe(true);
    expect(isValidDetailLevel(4)).toBe(true);
    expect(isValidDetailLevel(5)).toBe(true);
  });

  it("rejects integers outside 1-5", () => {
    expect(isValidDetailLevel(0)).toBe(false);
    expect(isValidDetailLevel(6)).toBe(false);
    expect(isValidDetailLevel(-1)).toBe(false);
    expect(isValidDetailLevel(100)).toBe(false);
  });

  it("rejects non-integer numbers", () => {
    expect(isValidDetailLevel(1.5)).toBe(false);
    expect(isValidDetailLevel(3.1)).toBe(false);
  });

  it("rejects NaN and Infinity", () => {
    expect(isValidDetailLevel(NaN)).toBe(false);
    expect(isValidDetailLevel(Infinity)).toBe(false);
    expect(isValidDetailLevel(-Infinity)).toBe(false);
  });
});

describe("DEFAULT_DETAIL_LEVEL", () => {
  it("is 3 (standard depth)", () => {
    expect(DEFAULT_DETAIL_LEVEL).toBe(3);
  });

  it("passes isValidDetailLevel", () => {
    expect(isValidDetailLevel(DEFAULT_DETAIL_LEVEL)).toBe(true);
  });
});

describe("generateSpec detail level wiring", () => {
  const specMarkdown = "# Spec\n\n## Overview\n\nFeature.";

  beforeEach(() => {
    mockSpawn.mockResolvedValue({ stdout: specMarkdown, exitCode: 0 });
  });

  function lastPrompt(): string {
    const call = mockSpawn.mock.calls.at(-1);
    expect(call).toBeDefined();
    return call![1] as string;
  }

  it("uses default detail level 3 when none provided", async () => {
    await generateSpec("build a REST API");
    expect(lastPrompt()).toContain("detail level 3 of 5");
  });

  it("embeds level 1 guidance and reduced sections", async () => {
    await generateSpec("build a REST API", undefined, undefined, 1);
    const prompt = lastPrompt();
    expect(prompt).toContain("detail level 1 of 5");
    expect(prompt).toContain("brief and high-level");
    expect(prompt).toContain("Overview** section (2-3 sentences)");
    expect(prompt).not.toContain("Acceptance Criteria");
    expect(prompt).not.toContain("Constraints");
  });

  it("embeds level 2 guidance with acceptance criteria", async () => {
    await generateSpec("build a REST API", undefined, undefined, 2);
    const prompt = lastPrompt();
    expect(prompt).toContain("detail level 2 of 5");
    expect(prompt).toContain("focused and concise");
    expect(prompt).toContain("Acceptance Criteria** section with 3-5 bullets");
    expect(prompt).not.toContain("Non-Functional Requirements");
  });

  it("embeds level 3 guidance with constraints", async () => {
    await generateSpec("build a REST API", undefined, undefined, 3);
    const prompt = lastPrompt();
    expect(prompt).toContain("detail level 3 of 5");
    expect(prompt).toContain("specific and actionable");
    expect(prompt).toContain("Constraints");
    expect(prompt).not.toContain("Non-Functional Requirements");
    expect(prompt).not.toContain("Implementation Notes");
  });

  it("embeds level 4 guidance with non-functional requirements", async () => {
    await generateSpec("build a REST API", undefined, undefined, 4);
    const prompt = lastPrompt();
    expect(prompt).toContain("detail level 4 of 5");
    expect(prompt).toContain("thorough and precise");
    expect(prompt).toContain("Non-Functional Requirements");
    expect(prompt).not.toContain("Implementation Notes");
    expect(prompt).not.toContain("Open Questions");
  });

  it("embeds level 5 guidance with implementation notes and open questions", async () => {
    await generateSpec("build a REST API", undefined, undefined, 5);
    const prompt = lastPrompt();
    expect(prompt).toContain("detail level 5 of 5");
    expect(prompt).toContain("exhaustive");
    expect(prompt).toContain("Non-Functional Requirements");
    expect(prompt).toContain("Implementation Notes");
    expect(prompt).toContain("Open Questions");
  });

  it("includes clarification answers alongside detail level", async () => {
    await generateSpec("build a REST API", "Q: auth?\nA: OAuth2", undefined, 4);
    const prompt = lastPrompt();
    expect(prompt).toContain("detail level 4 of 5");
    expect(prompt).toContain("## Clarification Answers");
    expect(prompt).toContain("OAuth2");
  });

  it.each([1, 2, 3, 4, 5] as DetailLevel[])(
    "produces a distinct prompt for every detail level (%i)",
    async (level) => {
      mockSpawn.mockClear();
      await generateSpec("build a REST API", undefined, undefined, level);
      expect(lastPrompt()).toContain(`detail level ${level} of 5`);
    },
  );
});
