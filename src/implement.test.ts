import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./config.js", () => ({ getAgents: vi.fn() }));
vi.mock("./planner.js", () => ({ extractJSON: vi.fn((s: string) => s) }));
vi.mock("./spawn.js", () => ({ spawnAgentStream: vi.fn() }));
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

import { spawnAgent, runImplement } from "./implement.js";
import type { FailureContext, RetryOptions } from "./implement.js";
import { getAgents } from "./config.js";
import { spawnAgentStream } from "./spawn.js";
import { TaskError } from "./task.js";
import type { PlannerOutput } from "./task.js";
import type { SpecPayload } from "./spec.js";

const mockGetAgents = vi.mocked(getAgents);
const mockSpawnAgentStream = vi.mocked(spawnAgentStream);

const devAgent = {
  name: "dev",
  description: "Dev agent",
  systemPrompt: "You are the Dev agent.",
  tools: ["read", "write"],
  role: "developer",
};

const qeAgent = {
  name: "qe",
  description: "QE agent",
  systemPrompt: "You are the QE agent.",
  tools: ["read", "write"],
  role: "quality-engineer",
};

const spec: SpecPayload = {
  source: "markdown",
  title: "Test Feature",
  content: "Implement a test feature",
};

const plan: PlannerOutput = {
  goals: ["Build feature"],
  tasks: ["Write code"],
  constraints: ["No breaking changes"],
  dod: ["Tests pass"],
};

describe("spawnAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates to spawnAgentStream with 15-minute timeout", async () => {
    mockSpawnAgentStream.mockResolvedValue({
      stdout: "done",
      exitCode: 0,
    });

    await spawnAgent("dev", "do something", { autoApprove: true });

    expect(mockSpawnAgentStream).toHaveBeenCalledWith(
      "dev",
      "do something",
      15 * 60 * 1000,
      { autoApprove: true },
    );
  });
});

describe("runImplement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAgents.mockReturnValue([devAgent, qeAgent]);
  });

  it("throws TaskError when dev agent not found in config", async () => {
    mockGetAgents.mockReturnValue([qeAgent]);

    await expect(runImplement(spec, plan)).rejects.toThrow(TaskError);
    await expect(runImplement(spec, plan)).rejects.toThrow(
      /missing dev or qe agent config/,
    );
  });

  it("throws TaskError when qe agent not found in config", async () => {
    mockGetAgents.mockReturnValue([devAgent]);

    await expect(runImplement(spec, plan)).rejects.toThrow(TaskError);
    await expect(runImplement(spec, plan)).rejects.toThrow(
      /missing dev or qe agent config/,
    );
  });

  it("runs dev and qe in parallel when autoApprove=true", async () => {
    const callOrder: string[] = [];
    let devResolve: () => void;
    let qeResolve: () => void;

    const devPromise = new Promise<void>((r) => { devResolve = r; });
    const qePromise = new Promise<void>((r) => { qeResolve = r; });

    mockSpawnAgentStream.mockImplementation(async (name: string) => {
      callOrder.push(`start:${name}`);
      if (name === "dev") {
        await devPromise;
      } else {
        await qePromise;
      }
      callOrder.push(`end:${name}`);
      return { stdout: "{}", exitCode: 0 };
    });

    const runPromise = runImplement(spec, plan, { autoApprove: true });

    // Wait for both agents to start
    await new Promise((r) => setTimeout(r, 50));

    // Both should have started before either resolves
    expect(callOrder[0]).toBe("start:dev");
    expect(callOrder[1]).toBe("start:qe");

    // Now allow them to complete
    devResolve!();
    qeResolve!();

    await runPromise;
    expect(mockSpawnAgentStream).toHaveBeenCalledTimes(2);
  });

  it("runs dev then qe sequentially when autoApprove is falsy", async () => {
    const callOrder: string[] = [];

    mockSpawnAgentStream.mockImplementation(async (name: string) => {
      callOrder.push(`start:${name}`);
      await new Promise((r) => setTimeout(r, 10));
      callOrder.push(`end:${name}`);
      return { stdout: "{}", exitCode: 0 };
    });

    await runImplement(spec, plan);

    expect(mockSpawnAgentStream).toHaveBeenCalledTimes(2);
    // Sequential: dev completes before qe starts
    expect(callOrder).toEqual([
      "start:dev",
      "end:dev",
      "start:qe",
      "end:qe",
    ]);
  });

  it("extracts dev output with files array", async () => {
    mockSpawnAgentStream.mockImplementation(async (name: string) => {
      if (name === "dev") {
        return {
          stdout: '{ "files": ["src/foo.ts", "src/bar.ts"] }',
          exitCode: 0,
        };
      }
      return { stdout: '{ "testFiles": [] }', exitCode: 0 };
    });

    const result = await runImplement(spec, plan, { autoApprove: true });

    expect(result.implement.dev).toEqual({
      files: ["src/foo.ts", "src/bar.ts"],
    });
  });

  it("extracts qe output with testFiles array", async () => {
    mockSpawnAgentStream.mockImplementation(async (name: string) => {
      if (name === "qe") {
        return {
          stdout: '{ "testFiles": ["tests/foo.test.ts"] }',
          exitCode: 0,
        };
      }
      return { stdout: '{ "files": [] }', exitCode: 0 };
    });

    const result = await runImplement(spec, plan, { autoApprove: true });

    expect(result.implement.qe).toEqual({
      testFiles: ["tests/foo.test.ts"],
    });
  });

  it("returns empty files when no JSON in output", async () => {
    mockSpawnAgentStream.mockResolvedValue({
      stdout: "No json here, just plain text output",
      exitCode: 0,
    });

    const result = await runImplement(spec, plan, { autoApprove: true });

    expect(result.implement.dev).toEqual({ files: [] });
    expect(result.implement.qe).toEqual({ testFiles: [] });
  });

  it("throws TaskError when both agents fail", async () => {
    mockSpawnAgentStream.mockResolvedValue({
      stdout: "",
      exitCode: 1,
    });

    await expect(
      runImplement(spec, plan, { autoApprove: true }),
    ).rejects.toThrow(TaskError);
    await expect(
      runImplement(spec, plan, { autoApprove: true }),
    ).rejects.toThrow(/all requested agents failed/);
  });

  it("only runs specified agents when agentsToRun set", async () => {
    mockSpawnAgentStream.mockResolvedValue({
      stdout: '{ "files": ["src/fix.ts"] }',
      exitCode: 0,
    });

    const retryOptions: RetryOptions = {
      agentsToRun: ["dev"],
    };

    const result = await runImplement(
      spec,
      plan,
      { autoApprove: true },
      retryOptions,
    );

    expect(mockSpawnAgentStream).toHaveBeenCalledTimes(1);
    expect(mockSpawnAgentStream).toHaveBeenCalledWith(
      "dev",
      expect.any(String),
      15 * 60 * 1000,
      { autoApprove: true },
    );
    expect(result.implement.dev).toEqual({ files: ["src/fix.ts"] });
    expect(result.implement.qe).toBeNull();
  });

  it("includes retry section in prompt when failureContext provided", async () => {
    mockSpawnAgentStream.mockResolvedValue({
      stdout: '{ "files": ["src/fix.ts"] }',
      exitCode: 0,
    });

    const failureContext: FailureContext = {
      gateName: "unit-tests",
      testOutput: "FAIL src/foo.test.ts\nExpected 1 to be 2",
      attempt: 2,
      maxAttempts: 3,
    };

    const retryOptions: RetryOptions = {
      failureContext,
      agentsToRun: ["dev"],
    };

    await runImplement(spec, plan, { autoApprove: true }, retryOptions);

    const promptArg = mockSpawnAgentStream.mock.calls[0][1];
    expect(promptArg).toContain("RETRY (attempt 2/3)");
    expect(promptArg).toContain("unit-tests");
    expect(promptArg).toContain("FAIL src/foo.test.ts");
    expect(promptArg).toContain("Expected 1 to be 2");
  });
});
