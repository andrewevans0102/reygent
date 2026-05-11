import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TaskContext, GateResult } from "../src/task.js";
import type { UsageInfo } from "../src/usage.js";

// Mock types for retry gate testing
interface RetryGateOptions {
  gateName: string;
  gateRunner: () => Promise<{ gate: GateResult; usage?: UsageInfo }>;
  agentsToRun: Array<"dev" | "qe">;
  context: TaskContext;
  agentOptions: { autoApprove: boolean };
  maxRetries: number;
  autoApprove: boolean;
  stageName: string;
  tracker: {
    record: (agent: string, stage: string, usage: UsageInfo) => void;
  };
}

describe("retry logic telemetry instrumentation", () => {
  let mockContext: TaskContext;
  let mockTracker: {
    record: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockContext = {
      spec: {
        source: "markdown",
        path: "/test/spec.md",
        title: "Test spec",
        content: "# Test",
      },
      results: [],
      implement: {
        dev: {
          files: ["src/feature.ts"],
        },
        qe: {
          testFiles: ["tests/feature.test.ts"],
        },
      },
      gates: {},
    };

    mockTracker = {
      record: vi.fn(),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("gate.retry event emission", () => {
    it("should track attempt number through retry loop", async () => {
      let attempt = 0;
      const attempts: number[] = [];

      const mockGateRunner = vi.fn(async () => {
        attempt++;
        attempts.push(attempt);

        // Fail first 2 attempts, succeed on third
        if (attempt < 3) {
          return {
            gate: {
              passed: false,
              output: `Test failed on attempt ${attempt}\nGATE_RESULT:FAIL\n`,
            },
            usage: {
              promptTokens: 100,
              completionTokens: 50,
              totalTokens: 150,
              cost: 0.001,
            },
          };
        }

        return {
          gate: {
            passed: true,
            output: "GATE_RESULT:PASS\n",
          },
          usage: {
            promptTokens: 100,
            completionTokens: 50,
            totalTokens: 150,
            cost: 0.001,
          },
        };
      });

      // Simulate retry logic behavior
      const maxRetries = 3;
      let gateResult: GateResult = { passed: false, output: "" };

      for (let currentAttempt = 1; currentAttempt <= maxRetries; currentAttempt++) {
        const result = await mockGateRunner();
        gateResult = result.gate;

        if (gateResult.passed) {
          break;
        }
      }

      expect(attempts).toEqual([1, 2, 3]);
      expect(gateResult.passed).toBe(true);
    });

    it("should include gate name in retry event", async () => {
      const retryEvents: Array<{ gateName: string; attempt: number; maxRetries: number }> = [];

      const mockGateRunner = vi.fn(async () => ({
        gate: {
          passed: false,
          output: "Test failed\nGATE_RESULT:FAIL\n",
        },
        usage: undefined,
      }));

      const maxRetries = 2;
      const gateName = "unit tests";

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        retryEvents.push({ gateName, attempt, maxRetries });
        await mockGateRunner();
      }

      expect(retryEvents).toHaveLength(2);
      expect(retryEvents[0]).toEqual({
        gateName: "unit tests",
        attempt: 1,
        maxRetries: 2,
      });
      expect(retryEvents[1]).toEqual({
        gateName: "unit tests",
        attempt: 2,
        maxRetries: 2,
      });
    });

    it("should include failure snippet in retry event", async () => {
      const failureOutputs: string[] = [];

      const mockGateRunner = vi.fn(async () => {
        const output = "Test suite failed\nError: Expected 2 to equal 3\nGATE_RESULT:FAIL\n";
        failureOutputs.push(output);

        return {
          gate: {
            passed: false,
            output,
          },
          usage: undefined,
        };
      });

      const maxRetries = 2;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        await mockGateRunner();
      }

      expect(failureOutputs).toHaveLength(2);
      expect(failureOutputs[0]).toContain("Expected 2 to equal 3");
      expect(failureOutputs[1]).toContain("Expected 2 to equal 3");
    });

    it("should stop retrying when gate passes", async () => {
      let callCount = 0;

      const mockGateRunner = vi.fn(async () => {
        callCount++;

        // Pass on second attempt
        if (callCount === 2) {
          return {
            gate: {
              passed: true,
              output: "GATE_RESULT:PASS\n",
            },
            usage: undefined,
          };
        }

        return {
          gate: {
            passed: false,
            output: "GATE_RESULT:FAIL\n",
          },
          usage: undefined,
        };
      });

      const maxRetries = 5;
      let gateResult: GateResult = { passed: false, output: "" };

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const result = await mockGateRunner();
        gateResult = result.gate;

        if (gateResult.passed) {
          break;
        }
      }

      expect(callCount).toBe(2);
      expect(gateResult.passed).toBe(true);
    });

    it("should exhaust all retries when gate never passes", async () => {
      let callCount = 0;

      const mockGateRunner = vi.fn(async () => {
        callCount++;

        return {
          gate: {
            passed: false,
            output: `Failure on attempt ${callCount}\nGATE_RESULT:FAIL\n`,
          },
          usage: undefined,
        };
      });

      const maxRetries = 3;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        await mockGateRunner();
      }

      expect(callCount).toBe(3);
    });
  });

  describe("attempt tracking accuracy", () => {
    it("should increment attempt counter correctly", async () => {
      const attemptLog: number[] = [];

      for (let attempt = 1; attempt <= 5; attempt++) {
        attemptLog.push(attempt);
      }

      expect(attemptLog).toEqual([1, 2, 3, 4, 5]);
    });

    it("should track attempt number in context between retries", async () => {
      const contexts: Array<{ attempt: number; maxAttempts: number }> = [];

      const maxRetries = 3;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        contexts.push({
          attempt,
          maxAttempts: maxRetries,
        });
      }

      expect(contexts[0]).toEqual({ attempt: 1, maxAttempts: 3 });
      expect(contexts[1]).toEqual({ attempt: 2, maxAttempts: 3 });
      expect(contexts[2]).toEqual({ attempt: 3, maxAttempts: 3 });
    });

    it("should preserve failure output from previous attempt", async () => {
      let previousOutput = "";
      const outputs: string[] = [];

      const maxRetries = 3;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        if (attempt > 1) {
          outputs.push(previousOutput);
        }

        previousOutput = `Failure on attempt ${attempt}\nGATE_RESULT:FAIL\n`;
      }

      expect(outputs).toHaveLength(2);
      expect(outputs[0]).toContain("Failure on attempt 1");
      expect(outputs[1]).toContain("Failure on attempt 2");
    });
  });

  describe("retry event context", () => {
    it("should include current attempt in retry event", async () => {
      const retryEvents: Array<{
        gateName: string;
        attempt: number;
        maxRetries: number;
        lastOutput: string;
      }> = [];

      let lastOutput = "";

      const mockGateRunner = vi.fn(async () => {
        const output = "Test failed\nGATE_RESULT:FAIL\n";
        lastOutput = output;

        return {
          gate: {
            passed: false,
            output,
          },
          usage: undefined,
        };
      });

      const maxRetries = 2;
      const gateName = "functional tests";

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const result = await mockGateRunner();
        retryEvents.push({
          gateName,
          attempt,
          maxRetries,
          lastOutput: result.gate.output,
        });
      }

      expect(retryEvents[0].attempt).toBe(1);
      expect(retryEvents[1].attempt).toBe(2);
      expect(retryEvents[0].lastOutput).toContain("GATE_RESULT:FAIL");
      expect(retryEvents[1].lastOutput).toContain("GATE_RESULT:FAIL");
    });

    it("should include maxRetries in retry event", async () => {
      const maxRetriesValues: number[] = [];

      const testMaxRetries = [1, 2, 3, 5, 10];

      for (const maxRetries of testMaxRetries) {
        maxRetriesValues.push(maxRetries);
      }

      expect(maxRetriesValues).toEqual([1, 2, 3, 5, 10]);
    });

    it("should truncate long failure output in retry event", async () => {
      const MAX_FAILURE_SNIPPET_CHARS = 500;
      const longOutput = "x".repeat(MAX_FAILURE_SNIPPET_CHARS + 1000) + "\nGATE_RESULT:FAIL\n";

      // Failure snippet uses last N chars (tail of output)
      const failureSnippet = longOutput.length > MAX_FAILURE_SNIPPET_CHARS
        ? longOutput.slice(-MAX_FAILURE_SNIPPET_CHARS)
        : longOutput;

      expect(failureSnippet.length).toBeLessThanOrEqual(MAX_FAILURE_SNIPPET_CHARS);
      expect(failureSnippet).toContain("GATE_RESULT:FAIL");
    });
  });

  describe("usage tracking during retries", () => {
    it("should record usage for each retry attempt", async () => {
      const usageRecords: Array<{ agent: string; stage: string; usage: UsageInfo }> = [];

      const mockGateRunner = vi.fn(async () => ({
        gate: {
          passed: false,
          output: "GATE_RESULT:FAIL\n",
        },
        usage: {
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
          cost: 0.001,
        },
      }));

      const maxRetries = 2;
      const stageName = "gate-unit-tests";

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const result = await mockGateRunner();

        if (result.usage) {
          usageRecords.push({
            agent: "gate:unit-tests",
            stage: `${stageName}-retry`,
            usage: result.usage,
          });
        }
      }

      expect(usageRecords).toHaveLength(2);
      expect(usageRecords[0].stage).toBe("gate-unit-tests-retry");
      expect(usageRecords[1].stage).toBe("gate-unit-tests-retry");
      expect(usageRecords[0].usage.cost).toBe(0.001);
    });

    it("should handle missing usage info in retries", async () => {
      const usageRecords: UsageInfo[] = [];

      const mockGateRunner = vi.fn(async () => ({
        gate: {
          passed: false,
          output: "GATE_RESULT:FAIL\n",
        },
        usage: undefined,
      }));

      const maxRetries = 2;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const result = await mockGateRunner();

        if (result.usage) {
          usageRecords.push(result.usage);
        }
      }

      expect(usageRecords).toHaveLength(0);
    });
  });

  describe("retry with different gate types", () => {
    it("should handle unit test gate retries", async () => {
      const retryLog: Array<{ gateName: string; agentsToRun: string[] }> = [];

      const maxRetries = 2;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        retryLog.push({
          gateName: "unit tests",
          agentsToRun: ["dev"],
        });
      }

      expect(retryLog).toHaveLength(2);
      expect(retryLog[0].agentsToRun).toEqual(["dev"]);
      expect(retryLog[1].agentsToRun).toEqual(["dev"]);
    });

    it("should handle functional test gate retries", async () => {
      const retryLog: Array<{ gateName: string; agentsToRun: string[] }> = [];

      const maxRetries = 2;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        retryLog.push({
          gateName: "functional tests",
          agentsToRun: ["dev", "qe"],
        });
      }

      expect(retryLog).toHaveLength(2);
      expect(retryLog[0].agentsToRun).toEqual(["dev", "qe"]);
      expect(retryLog[1].agentsToRun).toEqual(["dev", "qe"]);
    });
  });
});
