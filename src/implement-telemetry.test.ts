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

import { runImplement } from "./implement.js";
import { getAgents } from "./config.js";
import { spawnAgentStream } from "./spawn.js";
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

describe("implement stage context telemetry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAgents.mockReturnValue([devAgent, qeAgent]);
    mockSpawnAgentStream.mockResolvedValue({
      stdout: '{"files": []}',
      exitCode: 0,
    });
  });

  describe("stage context passed to dev agent", () => {
    it("passes stage=implement to dev agent spawn call", async () => {
      mockSpawnAgentStream.mockImplementation(async (name: string) => {
        if (name === "dev") {
          return {
            stdout: '{ "files": ["src/foo.ts"] }',
            exitCode: 0,
          };
        }
        return { stdout: '{ "testFiles": [] }', exitCode: 0 };
      });

      await runImplement(spec, plan, { autoApprove: true });

      const devCalls = mockSpawnAgentStream.mock.calls.filter(
        (call) => call[0] === "dev",
      );
      expect(devCalls.length).toBe(1);

      const [_name, _prompt, _timeout, options] = devCalls[0];
      expect(options?.stage).toBe("implement");
    });

    it("passes stage in sequential mode", async () => {
      mockSpawnAgentStream.mockResolvedValue({
        stdout: '{ "files": [] }',
        exitCode: 0,
      });

      await runImplement(spec, plan, { autoApprove: false });

      const devCalls = mockSpawnAgentStream.mock.calls.filter(
        (call) => call[0] === "dev",
      );
      const [_name, _prompt, _timeout, options] = devCalls[0];
      expect(options?.stage).toBe("implement");
    });
  });

  describe("stage context passed to qe agent", () => {
    it("passes stage=implement to qe agent spawn call", async () => {
      mockSpawnAgentStream.mockImplementation(async (name: string) => {
        if (name === "qe") {
          return {
            stdout: '{ "testFiles": ["tests/foo.test.ts"] }',
            exitCode: 0,
          };
        }
        return { stdout: '{ "files": [] }', exitCode: 0 };
      });

      await runImplement(spec, plan, { autoApprove: true });

      const qeCalls = mockSpawnAgentStream.mock.calls.filter(
        (call) => call[0] === "qe",
      );
      expect(qeCalls.length).toBe(1);

      const [_name, _prompt, _timeout, options] = qeCalls[0];
      expect(options?.stage).toBe("implement");
    });

    it("passes stage in sequential mode", async () => {
      mockSpawnAgentStream.mockResolvedValue({
        stdout: '{ "testFiles": [] }',
        exitCode: 0,
      });

      await runImplement(spec, plan, { autoApprove: false });

      const qeCalls = mockSpawnAgentStream.mock.calls.filter(
        (call) => call[0] === "qe",
      );
      const [_name, _prompt, _timeout, options] = qeCalls[0];
      expect(options?.stage).toBe("implement");
    });
  });

  describe("stage context in parallel mode", () => {
    it("passes stage to both dev and qe in parallel execution", async () => {
      mockSpawnAgentStream.mockResolvedValue({
        stdout: '{}',
        exitCode: 0,
      });

      await runImplement(spec, plan, { autoApprove: true });

      expect(mockSpawnAgentStream).toHaveBeenCalledTimes(2);

      const devCalls = mockSpawnAgentStream.mock.calls.filter(
        (call) => call[0] === "dev",
      );
      const qeCalls = mockSpawnAgentStream.mock.calls.filter(
        (call) => call[0] === "qe",
      );

      expect(devCalls[0][3]?.stage).toBe("implement");
      expect(qeCalls[0][3]?.stage).toBe("implement");
    });
  });

  describe("stage context with retry", () => {
    it("passes stage when retrying dev agent only", async () => {
      mockSpawnAgentStream.mockResolvedValue({
        stdout: '{ "files": ["src/fix.ts"] }',
        exitCode: 0,
      });

      await runImplement(
        spec,
        plan,
        { autoApprove: true },
        { agentsToRun: ["dev"] },
      );

      const devCalls = mockSpawnAgentStream.mock.calls.filter(
        (call) => call[0] === "dev",
      );
      expect(devCalls.length).toBe(1);

      const [_name, _prompt, _timeout, options] = devCalls[0];
      expect(options?.stage).toBe("implement");
    });

    it("passes stage when retrying qe agent only", async () => {
      mockSpawnAgentStream.mockResolvedValue({
        stdout: '{ "testFiles": ["tests/fix.test.ts"] }',
        exitCode: 0,
      });

      await runImplement(
        spec,
        plan,
        { autoApprove: true },
        { agentsToRun: ["qe"] },
      );

      const qeCalls = mockSpawnAgentStream.mock.calls.filter(
        (call) => call[0] === "qe",
      );
      expect(qeCalls.length).toBe(1);

      const [_name, _prompt, _timeout, options] = qeCalls[0];
      expect(options?.stage).toBe("implement");
    });
  });

  describe("stage context with other options", () => {
    it("passes stage along with provider and model options", async () => {
      const devAgentWithProvider = {
        ...devAgent,
        provider: "claude",
        model: "claude-opus-4-6",
      };

      mockGetAgents.mockReturnValue([devAgentWithProvider, qeAgent]);
      mockSpawnAgentStream.mockResolvedValue({
        stdout: '{ "files": [] }',
        exitCode: 0,
      });

      await runImplement(spec, plan, { autoApprove: true });

      const devCalls = mockSpawnAgentStream.mock.calls.filter(
        (call) => call[0] === "dev",
      );
      const [_name, _prompt, _timeout, options] = devCalls[0];

      expect(options?.stage).toBe("implement");
      expect(options?.provider).toBe("claude");
      expect(options?.model).toBe("claude-opus-4-6");
    });

    it("passes stage along with autoApprove option", async () => {
      mockSpawnAgentStream.mockResolvedValue({
        stdout: '{ "files": [] }',
        exitCode: 0,
      });

      await runImplement(spec, plan, { autoApprove: true });

      const devCalls = mockSpawnAgentStream.mock.calls.filter(
        (call) => call[0] === "dev",
      );
      const [_name, _prompt, _timeout, options] = devCalls[0];

      expect(options?.stage).toBe("implement");
      expect(options?.autoApprove).toBe(true);
    });

    it("passes stage along with quiet option", async () => {
      mockSpawnAgentStream.mockResolvedValue({
        stdout: '{ "files": [] }',
        exitCode: 0,
      });

      await runImplement(spec, plan, { autoApprove: true, quiet: true });

      const devCalls = mockSpawnAgentStream.mock.calls.filter(
        (call) => call[0] === "dev",
      );
      const [_name, _prompt, _timeout, options] = devCalls[0];

      expect(options?.stage).toBe("implement");
      expect(options?.quiet).toBe(true);
    });
  });
});
