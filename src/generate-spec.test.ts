import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./config.js", () => ({
  getAgents: vi.fn(() => [
    { name: "planner", systemPrompt: "You are a planner", role: "planner" },
  ]),
}));
vi.mock("./debug.js", () => ({ isDebug: vi.fn(() => false) }));
vi.mock("./planner.js", () => ({ extractJSON: vi.fn((s: string) => s) }));
vi.mock("./spawn.js", () => ({ spawnAgentStream: vi.fn() }));

import { runClarification, generateSpec } from "./generate-spec.js";
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
