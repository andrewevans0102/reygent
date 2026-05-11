import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@inquirer/prompts", () => ({ select: vi.fn() }));
vi.mock("./config.js", () => ({ getAgents: vi.fn(() => []) }));
vi.mock("./spawn.js", () => ({ spawnAgentStream: vi.fn() }));

const mockChesstrace = { emit: vi.fn() };
vi.mock("./chesstrace/index.js", () => ({
  getChesstrace: vi.fn(() => mockChesstrace),
}));

const mockSpawnAgent = vi.fn();
vi.mock("./implement.js", () => ({
  spawnAgent: (...args: unknown[]) => mockSpawnAgent(...args),
}));

import { runGate, runUnitTestGate, runFunctionalTestGate } from "./gate.js";
import { TaskError } from "./task.js";
import type { TaskContext } from "./task.js";
import { Events } from "./chesstrace/events.js";

describe("runGate", () => {
  beforeEach(() => {
    mockSpawnAgent.mockReset();
    mockChesstrace.emit.mockReset();
  });

  it("returns passed=true when GATE_RESULT:PASS and exit 0", async () => {
    mockSpawnAgent.mockResolvedValue({
      stdout: "Tests ran\nGATE_RESULT:PASS",
      exitCode: 0,
      usage: { costUsd: 0.01 },
    });

    const { gate } = await runGate("test-gate", "prompt");
    expect(gate.passed).toBe(true);
    expect(gate.output).toContain("GATE_RESULT:PASS");
  });

  it("returns passed=false when GATE_RESULT:FAIL", async () => {
    mockSpawnAgent.mockResolvedValue({
      stdout: "Tests failed\nGATE_RESULT:FAIL",
      exitCode: 0,
      usage: {},
    });

    const { gate } = await runGate("test-gate", "prompt");
    expect(gate.passed).toBe(false);
  });

  it("returns passed=false when non-zero exit code", async () => {
    mockSpawnAgent.mockResolvedValue({
      stdout: "GATE_RESULT:PASS",
      exitCode: 1,
      usage: {},
    });

    const { gate } = await runGate("test-gate", "prompt");
    expect(gate.passed).toBe(false);
  });

  it("returns passed=false when both PASS and FAIL present", async () => {
    mockSpawnAgent.mockResolvedValue({
      stdout: "GATE_RESULT:PASS\nGATE_RESULT:FAIL",
      exitCode: 0,
      usage: {},
    });

    const { gate } = await runGate("test-gate", "prompt");
    expect(gate.passed).toBe(false);
  });

  it("returns passed=false when no marker present", async () => {
    mockSpawnAgent.mockResolvedValue({
      stdout: "No marker here",
      exitCode: 0,
      usage: {},
    });

    const { gate } = await runGate("test-gate", "prompt");
    expect(gate.passed).toBe(false);
  });

  it("returns usage info", async () => {
    mockSpawnAgent.mockResolvedValue({
      stdout: "GATE_RESULT:PASS",
      exitCode: 0,
      usage: { costUsd: 0.05 },
    });

    const { usage } = await runGate("test-gate", "prompt");
    expect(usage?.costUsd).toBe(0.05);
  });

  it("emits gate.result telemetry with default attempt 1", async () => {
    mockSpawnAgent.mockResolvedValue({
      stdout: "GATE_RESULT:PASS",
      exitCode: 0,
      usage: {},
    });

    await runGate("test-gate", "prompt");
    expect(mockChesstrace.emit).toHaveBeenCalledWith(Events.GATE_RESULT, {
      gateName: "test-gate",
      passed: true,
      attempt: 1,
    });
  });

  it("emits gate.result telemetry with custom attempt", async () => {
    mockSpawnAgent.mockResolvedValue({
      stdout: "GATE_RESULT:FAIL",
      exitCode: 0,
      usage: {},
    });

    await runGate("test-gate", "prompt", { attempt: 3 });
    expect(mockChesstrace.emit).toHaveBeenCalledWith(Events.GATE_RESULT, {
      gateName: "test-gate",
      passed: false,
      attempt: 3,
    });
  });

  it("swallows telemetry emit errors", async () => {
    mockSpawnAgent.mockResolvedValue({
      stdout: "GATE_RESULT:PASS",
      exitCode: 0,
      usage: {},
    });
    mockChesstrace.emit.mockImplementation(() => {
      throw new Error("Telemetry error");
    });

    const { gate } = await runGate("test-gate", "prompt");
    expect(gate.passed).toBe(true);
  });
});

describe("runUnitTestGate", () => {
  beforeEach(() => {
    mockSpawnAgent.mockReset();
  });

  function makeContext(overrides: Partial<TaskContext> = {}): TaskContext {
    return {
      spec: { source: "markdown", title: "T", content: "C" },
      results: [],
      implement: {
        dev: { files: ["src/a.ts"] },
        qe: { testFiles: ["test/a.test.ts"] },
      },
      ...overrides,
    };
  }

  it("throws when implement not run", async () => {
    const ctx = makeContext({ implement: undefined });
    await expect(runUnitTestGate(ctx)).rejects.toThrow(TaskError);
    await expect(runUnitTestGate(ctx)).rejects.toThrow(/implement stage/i);
  });

  it("throws when dev output null", async () => {
    const ctx = makeContext({ implement: { dev: null, qe: { testFiles: [] } } });
    await expect(runUnitTestGate(ctx)).rejects.toThrow(/dev output/i);
  });

  it("runs gate and returns result", async () => {
    mockSpawnAgent.mockResolvedValue({
      stdout: "All passed\nGATE_RESULT:PASS",
      exitCode: 0,
      usage: {},
    });

    const ctx = makeContext();
    const { gate } = await runUnitTestGate(ctx);
    expect(gate.passed).toBe(true);
    expect(mockSpawnAgent).toHaveBeenCalledWith(
      "gate:unit-tests",
      expect.stringContaining("src/a.ts"),
      undefined,
    );
  });
});

describe("runFunctionalTestGate", () => {
  beforeEach(() => {
    mockSpawnAgent.mockReset();
  });

  function makeContext(overrides: Partial<TaskContext> = {}): TaskContext {
    return {
      spec: { source: "markdown", title: "T", content: "C" },
      results: [],
      implement: {
        dev: { files: ["src/a.ts"] },
        qe: { testFiles: ["test/a.test.ts"] },
      },
      ...overrides,
    };
  }

  it("throws when implement not run", async () => {
    const ctx = makeContext({ implement: undefined });
    await expect(runFunctionalTestGate(ctx)).rejects.toThrow(/implement stage/i);
  });

  it("throws when qe output null", async () => {
    const ctx = makeContext({ implement: { dev: { files: [] }, qe: null } });
    await expect(runFunctionalTestGate(ctx)).rejects.toThrow(/qe output/i);
  });

  it("runs gate and returns result", async () => {
    mockSpawnAgent.mockResolvedValue({
      stdout: "Functional tests ok\nGATE_RESULT:PASS",
      exitCode: 0,
      usage: {},
    });

    const ctx = makeContext();
    const { gate } = await runFunctionalTestGate(ctx);
    expect(gate.passed).toBe(true);
    expect(mockSpawnAgent).toHaveBeenCalledWith(
      "gate:functional-tests",
      expect.stringContaining("test/a.test.ts"),
      undefined,
    );
  });
});
