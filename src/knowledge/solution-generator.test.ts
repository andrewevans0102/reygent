import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateSolution } from "./solution-generator.js";
import type { FailurePattern } from "./analyzer.js";
import type { SqliteBackend } from "../chesstrace/backends/sqlite.js";
import type { TelemetryEvent } from "../chesstrace/events.js";
import { Events } from "../chesstrace/events.js";

// Mock modules
vi.mock("../model.js", () => ({
  resolveProvider: vi.fn(() => "claude"),
  resolveModel: vi.fn(() => Promise.resolve("claude-sonnet-4-20250514")),
}));

vi.mock("../providers/index.js", () => ({
  getProvider: vi.fn(),
}));

import { getProvider } from "../providers/index.js";

const mockGetProvider = vi.mocked(getProvider);

function makePattern(overrides?: Partial<FailurePattern>): FailurePattern {
  return {
    pattern: "Circular import error",
    occurrences: 3,
    runIds: ["run1", "run2", "run3"],
    agents: ["dev"],
    lastSeen: Date.now(),
    suggestedEntry: "",
    ...overrides,
  };
}

function makeBackend(events: TelemetryEvent[] = []): SqliteBackend {
  return {
    query: vi.fn(() => Promise.resolve(events)),
    getEvents: vi.fn(() => events),
  } as unknown as SqliteBackend;
}

function makeAdapter(spawnResult?: Partial<{ stdout: string; exitCode: number }>) {
  return {
    name: "claude" as const,
    isAvailable: vi.fn(() => Promise.resolve({ available: true })),
    spawn: vi.fn(() =>
      Promise.resolve({
        stdout: "Check import paths and ensure no circular references between modules. Move shared types to a dedicated types file.",
        exitCode: 0,
        ...spawnResult,
      }),
    ),
    supportedModels: [],
    defaultModel: "claude-sonnet-4-20250514",
    shortAliases: {},
    type: "cli" as const,
    spawnInteractive: vi.fn(),
  };
}

describe("generateSolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("generates LLM solution with correct spawn options", async () => {
    const adapter = makeAdapter();
    mockGetProvider.mockReturnValue(adapter);
    const backend = makeBackend();
    const pattern = makePattern();

    const solution = await generateSolution(pattern, backend, "dev");

    expect(solution).toContain("circular references");
    expect(adapter.spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedTools: [],
        timeoutMs: 30_000,
        quiet: true,
        agentName: "knowledge-solution-generator",
      }),
    );
  });

  it("falls back when provider unavailable", async () => {
    const adapter = makeAdapter();
    adapter.isAvailable.mockResolvedValue({ available: false, reason: "no API key" });
    mockGetProvider.mockReturnValue(adapter);
    const backend = makeBackend();
    const pattern = makePattern();

    const solution = await generateSolution(pattern, backend, "dev");

    expect(solution).toContain("Error occurred 3 time(s)");
    expect(solution).toContain("dev");
    expect(adapter.spawn).not.toHaveBeenCalled();
  });

  it("falls back on non-zero exit code", async () => {
    const adapter = makeAdapter({ exitCode: 1, stdout: "" });
    mockGetProvider.mockReturnValue(adapter);
    const backend = makeBackend();
    const pattern = makePattern();

    const solution = await generateSolution(pattern, backend, "dev");

    expect(solution).toContain("Error occurred 3 time(s)");
  });

  it("falls back on empty stdout", async () => {
    const adapter = makeAdapter({ exitCode: 0, stdout: "   " });
    mockGetProvider.mockReturnValue(adapter);
    const backend = makeBackend();
    const pattern = makePattern();

    const solution = await generateSolution(pattern, backend, "dev");

    expect(solution).toContain("Error occurred 3 time(s)");
  });

  it("falls back on exception", async () => {
    const adapter = makeAdapter();
    adapter.spawn.mockRejectedValue(new Error("timeout"));
    mockGetProvider.mockReturnValue(adapter);
    const backend = makeBackend();
    const pattern = makePattern();

    const solution = await generateSolution(pattern, backend, "dev");

    expect(solution).toContain("Error occurred 3 time(s)");
    expect(solution).toContain("reygent telemetry");
  });

  it("sanitizes solution — truncates long output", async () => {
    const longText = "Fix the issue by doing this. ".repeat(50); // >500 chars
    const adapter = makeAdapter({ stdout: longText });
    mockGetProvider.mockReturnValue(adapter);
    const backend = makeBackend();
    const pattern = makePattern();

    const solution = await generateSolution(pattern, backend, "dev");

    expect(solution.length).toBeLessThanOrEqual(504); // 500 + "..."
    expect(solution.endsWith("...")).toBe(true);
  });

  it("sanitizes solution — strips markdown headers", async () => {
    const adapter = makeAdapter({
      stdout: "## Solution\nCheck import paths and remove circular deps.",
    });
    mockGetProvider.mockReturnValue(adapter);
    const backend = makeBackend();
    const pattern = makePattern();

    const solution = await generateSolution(pattern, backend, "dev");

    expect(solution).not.toContain("## Solution");
    expect(solution).toContain("Check import paths");
  });

  it("gathers context events from most recent failing run", async () => {
    const adapter = makeAdapter();
    mockGetProvider.mockReturnValue(adapter);

    const contextEvents: TelemetryEvent[] = [
      {
        id: "e1",
        runId: "run3",
        timestamp: Date.now(),
        category: "error",
        event: Events.ERROR_TASK,
        minLevel: 0,
        data: { message: "Circular import error", agent: "dev" },
      },
      {
        id: "e2",
        runId: "run3",
        timestamp: Date.now(),
        category: "agent",
        event: Events.AGENT_SPAWN,
        minLevel: 1,
        data: { agent: "dev", provider: "claude" },
      },
      {
        id: "e3",
        runId: "run3",
        timestamp: Date.now(),
        category: "llm",
        event: "llm.request", // not in RELEVANT_EVENTS — should be filtered
        minLevel: 2,
        data: { model: "claude-sonnet" },
      },
    ];

    const backend = makeBackend(contextEvents);
    const pattern = makePattern();

    await generateSolution(pattern, backend, "dev");

    // Should query for run3 (last runId)
    expect(backend.query).toHaveBeenCalledWith({ runId: "run3" });

    // Prompt should include context from relevant events only
    const spawnCall = adapter.spawn.mock.calls[0][0];
    expect(spawnCall.prompt).toContain("Recent run context");
    expect(spawnCall.prompt).toContain(Events.ERROR_TASK);
    expect(spawnCall.prompt).toContain(Events.AGENT_SPAWN);
    // llm.request not in relevant events
    expect(spawnCall.prompt).not.toContain("llm.request");
  });

  it("limits context to 20 events", async () => {
    const adapter = makeAdapter();
    mockGetProvider.mockReturnValue(adapter);

    // Create 30 relevant events
    const contextEvents: TelemetryEvent[] = Array.from({ length: 30 }, (_, i) => ({
      id: `e${i}`,
      runId: "run3",
      timestamp: Date.now() + i,
      category: "error" as const,
      event: Events.ERROR_TASK,
      minLevel: 0,
      data: { message: `Error ${i}`, agent: "dev" },
    }));

    const backend = makeBackend(contextEvents);
    const pattern = makePattern();

    await generateSolution(pattern, backend, "dev");

    const spawnCall = adapter.spawn.mock.calls[0][0];
    // Count occurrences of event markers in prompt
    const matches = spawnCall.prompt.match(/\[error\.task\]/g);
    expect(matches).toHaveLength(20);
  });
});
