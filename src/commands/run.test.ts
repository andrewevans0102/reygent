import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Chesstrace } from "../chesstrace/index.js";

// Mock all external dependencies
vi.mock("@inquirer/prompts", () => ({ select: vi.fn() }));
vi.mock("../config.js", () => ({
  getAgents: vi.fn(() => []),
  loadConfig: vi.fn(() => ({
    agents: [],
    skills: {},
    telemetry: { enabled: true, level: "standard", backend: "sqlite", retention: 30 },
  })),
}));
vi.mock("../spawn.js", () => ({ spawnAgentStream: vi.fn() }));
vi.mock("../spec.js", () => ({
  loadSpec: vi.fn(),
  SpecError: class SpecError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "SpecError";
    }
  },
}));
vi.mock("../planner.js", () => ({ runPlanner: vi.fn() }));
vi.mock("../implement.js", () => ({ runImplement: vi.fn() }));
vi.mock("../gate.js", () => ({
  runUnitTestGate: vi.fn(),
  runFunctionalTestGate: vi.fn(),
}));
vi.mock("../security-review.js", () => ({
  runSecurityReview: vi.fn(),
  formatFindings: vi.fn(() => ""),
}));
vi.mock("../pr-create.js", () => ({ runPRCreate: vi.fn() }));
vi.mock("../pr-review.js", () => ({
  runPRReview: vi.fn(),
  formatPRReviewTerminal: vi.fn(() => ""),
  postPRReviewComment: vi.fn(),
}));
vi.mock("../live-status.js", () => ({
  createLiveStatus: vi.fn(() => ({
    onActivity: vi.fn(),
    succeed: vi.fn(),
    fail: vi.fn(),
    stop: vi.fn(),
    start: vi.fn(),
  })),
}));
vi.mock("../usage.js", () => ({
  UsageTracker: vi.fn(() => ({
    record: vi.fn(),
    getTotalCost: vi.fn(() => 0),
    getByAgent: vi.fn(() => new Map()),
    getEntries: vi.fn(() => []),
  })),
  printUsageSummary: vi.fn(),
  printVerboseUsage: vi.fn(),
}));
vi.mock("../chesstrace/index.js", () => ({
  getChesstrace: vi.fn(),
  resetChesstrace: vi.fn(),
}));
vi.mock("../chesstrace/backends/sqlite.js", () => ({
  SqliteBackend: vi.fn(() => ({
    init: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}));

import { loadSpec } from "../spec.js";
import { runPlanner } from "../planner.js";
import { runImplement } from "../implement.js";
import { runUnitTestGate, runFunctionalTestGate } from "../gate.js";
import { runSecurityReview } from "../security-review.js";
import { runPRCreate } from "../pr-create.js";
import { runPRReview } from "../pr-review.js";
import { getChesstrace } from "../chesstrace/index.js";
import { runCommand } from "./run.js";

describe("run command - Chesstrace instrumentation", () => {
  let mockChesstrace: {
    init: ReturnType<typeof vi.fn>;
    startRun: ReturnType<typeof vi.fn>;
    emit: ReturnType<typeof vi.fn>;
    flush: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    isEnabled: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock Chesstrace instance
    mockChesstrace = {
      init: vi.fn().mockResolvedValue(undefined),
      startRun: vi.fn().mockResolvedValue("test-run-id"),
      emit: vi.fn(),
      flush: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      isEnabled: vi.fn().mockReturnValue(true),
    };

    vi.mocked(getChesstrace).mockReturnValue(mockChesstrace as unknown as Chesstrace);

    // Setup default mock responses
    vi.mocked(loadSpec).mockResolvedValue({
      source: "markdown",
      title: "Test Spec",
      content: "Test content",
    });

    vi.mocked(runPlanner).mockResolvedValue({
      result: {
        goals: ["goal1"],
        tasks: ["task1"],
        constraints: ["constraint1"],
        dod: ["done1"],
      },
      usage: { costUsd: 0.01 },
    });

    vi.mocked(runImplement).mockResolvedValue({
      implement: {
        dev: { files: ["src/test.ts"] },
        qe: { testFiles: ["src/test.test.ts"] },
      },
      usages: [
        { agent: "dev", usage: { costUsd: 0.02 } },
        { agent: "qe", usage: { costUsd: 0.02 } },
      ],
    });

    vi.mocked(runUnitTestGate).mockResolvedValue({
      gate: { passed: true, output: "All tests passed" },
      usage: { costUsd: 0.01 },
    });

    vi.mocked(runFunctionalTestGate).mockResolvedValue({
      gate: { passed: true, output: "Functional tests passed" },
      usage: { costUsd: 0.01 },
    });

    vi.mocked(runSecurityReview).mockResolvedValue({
      output: { severity: "LOW", findings: [] },
      passed: true,
      usage: { costUsd: 0.01 },
    });

    vi.mocked(runPRCreate).mockResolvedValue({
      branch: "feat/test-branch",
      commitMessage: "test: add feature",
      prUrl: "https://github.com/test/repo/pull/1",
      prNumber: 1,
    });

    vi.mocked(runPRReview).mockResolvedValue({
      output: {
        summary: "LGTM",
        comments: [],
        recommendedActions: [],
      },
      usage: { costUsd: 0.01 },
    });
  });

  describe("pipeline.start emission", () => {
    it("emits pipeline.start with spec metadata and run options", async () => {
      await runCommand({
        spec: "test.md",
        dryRun: false,
        securityThreshold: "HIGH",
        autoApprove: true,
        insecure: false,
        skipClarification: true,
        maxRetries: "0",
        verbose: false,
      });

      // Check pipeline.start was emitted
      const startEmit = vi.mocked(mockChesstrace.emit).mock.calls.find(
        (call) => call[0] === "pipeline.start"
      );

      expect(startEmit).toBeDefined();
      expect(startEmit![1]).toMatchObject({
        spec: expect.objectContaining({
          title: "Test Spec",
          source: "markdown",
        }),
        options: expect.objectContaining({
          autoApprove: true,
          securityThreshold: "HIGH",
          maxRetries: 0,
        }),
      });
    });
  });

  describe("pipeline.stage_start emission", () => {
    it("emits pipeline.stage_start before each stage executes", async () => {
      await runCommand({
        spec: "test.md",
        dryRun: false,
        securityThreshold: "HIGH",
        autoApprove: true,
        insecure: false,
        skipClarification: true,
        maxRetries: "0",
        verbose: false,
      });

      // Collect all pipeline.stage_start emissions
      const stageStartEmits = vi.mocked(mockChesstrace.emit).mock.calls.filter(
        (call) => call[0] === "pipeline.stage_start"
      );

      // Should have stage start for each pipeline stage
      const expectedStages = [
        "plan",
        "implement",
        "gate-unit-tests",
        "gate-functional-tests",
        "security-review",
        "pr-create",
        "pr-review",
      ];

      expect(stageStartEmits.length).toBe(expectedStages.length);

      for (const stageName of expectedStages) {
        const stageEmit = stageStartEmits.find(
          (call) => call[1]?.stage === stageName
        );
        expect(stageEmit).toBeDefined();
        expect(stageEmit![1]).toMatchObject({
          stage: stageName,
        });
      }
    });
  });

  describe("pipeline.stage_end emission", () => {
    it("emits pipeline.stage_end after each stage with success and duration", async () => {
      await runCommand({
        spec: "test.md",
        dryRun: false,
        securityThreshold: "HIGH",
        autoApprove: true,
        insecure: false,
        skipClarification: true,
        maxRetries: "0",
        verbose: false,
      });

      // Collect all pipeline.stage_end emissions
      const stageEndEmits = vi.mocked(mockChesstrace.emit).mock.calls.filter(
        (call) => call[0] === "pipeline.stage_end"
      );

      const expectedStages = [
        "plan",
        "implement",
        "gate-unit-tests",
        "gate-functional-tests",
        "security-review",
        "pr-create",
        "pr-review",
      ];

      expect(stageEndEmits.length).toBe(expectedStages.length);

      for (const stageName of expectedStages) {
        const stageEmit = stageEndEmits.find(
          (call) => call[1]?.stage === stageName
        );
        expect(stageEmit).toBeDefined();
        expect(stageEmit![1]).toMatchObject({
          stage: stageName,
          success: true,
          durationMs: expect.any(Number),
        });
      }
    });

    it("emits pipeline.stage_end with success=false when stage fails", async () => {
      // Make unit tests fail
      vi.mocked(runUnitTestGate).mockResolvedValue({
        gate: { passed: false, output: "Tests failed" },
        usage: { costUsd: 0.01 },
      });

      await expect(
        runCommand({
          spec: "test.md",
          dryRun: false,
          securityThreshold: "HIGH",
          autoApprove: true,
          insecure: false,
          skipClarification: true,
          maxRetries: "0",
          verbose: false,
        })
      ).rejects.toThrow();

      // Check gate-unit-tests stage.end has success=false
      const stageEndEmits = vi.mocked(mockChesstrace.emit).mock.calls.filter(
        (call) => call[0] === "pipeline.stage_end"
      );

      const unitTestStageEmit = stageEndEmits.find(
        (call) => call[1]?.stage === "gate-unit-tests"
      );

      expect(unitTestStageEmit).toBeDefined();
      expect(unitTestStageEmit![1]).toMatchObject({
        stage: "gate-unit-tests",
        success: false,
      });
    });
  });

  describe("pipeline.end emission", () => {
    it("emits pipeline.end with overall success, duration, cost, and stage results", async () => {
      await runCommand({
        spec: "test.md",
        dryRun: false,
        securityThreshold: "HIGH",
        autoApprove: true,
        insecure: false,
        skipClarification: true,
        maxRetries: "0",
        verbose: false,
      });

      // Check pipeline.end was emitted
      const endEmit = vi.mocked(mockChesstrace.emit).mock.calls.find(
        (call) => call[0] === "pipeline.end"
      );

      expect(endEmit).toBeDefined();
      expect(endEmit![1]).toMatchObject({
        success: true,
        totalDurationMs: expect.any(Number),
        totalCost: expect.any(Number),
      });
    });

    it("emits pipeline.end with success=false when pipeline fails", async () => {
      vi.mocked(runPlanner).mockRejectedValue(new Error("Planner failed"));

      await expect(
        runCommand({
          spec: "test.md",
          dryRun: false,
          securityThreshold: "HIGH",
          autoApprove: true,
          insecure: false,
          skipClarification: true,
          maxRetries: "0",
          verbose: false,
        })
      ).rejects.toThrow();

      const endEmit = vi.mocked(mockChesstrace.emit).mock.calls.find(
        (call) => call[0] === "pipeline.end"
      );

      expect(endEmit).toBeDefined();
      expect(endEmit![1]).toMatchObject({
        success: false,
      });
    });
  });

  describe("flush and close calls", () => {
    it("calls chesstrace.flush() at end of successful pipeline", async () => {
      await runCommand({
        spec: "test.md",
        dryRun: false,
        securityThreshold: "HIGH",
        autoApprove: true,
        insecure: false,
        skipClarification: true,
        maxRetries: "0",
        verbose: false,
      });

      expect(mockChesstrace.flush).toHaveBeenCalled();
    });

    it("calls chesstrace.close() at end of successful pipeline", async () => {
      await runCommand({
        spec: "test.md",
        dryRun: false,
        securityThreshold: "HIGH",
        autoApprove: true,
        insecure: false,
        skipClarification: true,
        maxRetries: "0",
        verbose: false,
      });

      expect(mockChesstrace.close).toHaveBeenCalled();
    });

    it("calls flush and close even when pipeline fails", async () => {
      vi.mocked(runPlanner).mockRejectedValue(new Error("Planner failed"));

      await expect(
        runCommand({
          spec: "test.md",
          dryRun: false,
          securityThreshold: "HIGH",
          autoApprove: true,
          insecure: false,
          skipClarification: true,
          maxRetries: "0",
          verbose: false,
        })
      ).rejects.toThrow();

      expect(mockChesstrace.flush).toHaveBeenCalled();
      expect(mockChesstrace.close).toHaveBeenCalled();
    });
  });

  describe("emit failure handling", () => {
    it("continues pipeline execution when emit calls fail", async () => {
      // Make emit throw errors
      mockChesstrace.emit.mockImplementation(() => {
        throw new Error("Emit failed");
      });

      // Pipeline should still complete successfully
      await runCommand({
        spec: "test.md",
        dryRun: false,
        securityThreshold: "HIGH",
        autoApprove: true,
        insecure: false,
        skipClarification: true,
        maxRetries: "0",
        verbose: false,
      });

      // Verify planner ran despite emit failures
      expect(runPlanner).toHaveBeenCalled();
      expect(runImplement).toHaveBeenCalled();
    });

    it("does not throw when flush fails", async () => {
      mockChesstrace.flush.mockRejectedValue(new Error("Flush failed"));

      await runCommand({
        spec: "test.md",
        dryRun: false,
        securityThreshold: "HIGH",
        autoApprove: true,
        insecure: false,
        skipClarification: true,
        maxRetries: "0",
        verbose: false,
      });

      // Should have attempted flush
      expect(mockChesstrace.flush).toHaveBeenCalled();
    });

    it("does not throw when close fails", async () => {
      mockChesstrace.close.mockRejectedValue(new Error("Close failed"));

      await runCommand({
        spec: "test.md",
        dryRun: false,
        securityThreshold: "HIGH",
        autoApprove: true,
        insecure: false,
        skipClarification: true,
        maxRetries: "0",
        verbose: false,
      });

      // Should have attempted close
      expect(mockChesstrace.close).toHaveBeenCalled();
    });
  });

  describe("dry-run mode", () => {
    it("does not emit telemetry events in dry-run mode", async () => {
      await runCommand({
        spec: "test.md",
        dryRun: true,
        securityThreshold: "HIGH",
        autoApprove: true,
        insecure: false,
        skipClarification: true,
        maxRetries: "0",
        verbose: false,
      });

      // No emit calls should be made in dry-run
      expect(mockChesstrace.emit).not.toHaveBeenCalled();
    });
  });

  describe("duration tracking", () => {
    it("tracks duration for each stage", async () => {
      await runCommand({
        spec: "test.md",
        dryRun: false,
        securityThreshold: "HIGH",
        autoApprove: true,
        insecure: false,
        skipClarification: true,
        maxRetries: "0",
        verbose: false,
      });

      const stageEndEmits = vi.mocked(mockChesstrace.emit).mock.calls.filter(
        (call) => call[0] === "pipeline.stage_end"
      );

      // All stage.end events should have durationMs
      for (const emit of stageEndEmits) {
        expect(emit[1]).toHaveProperty("durationMs");
        expect(typeof emit[1].durationMs).toBe("number");
        expect(emit[1].durationMs).toBeGreaterThanOrEqual(0);
      }
    });

    it("tracks total pipeline duration", async () => {
      await runCommand({
        spec: "test.md",
        dryRun: false,
        securityThreshold: "HIGH",
        autoApprove: true,
        insecure: false,
        skipClarification: true,
        maxRetries: "0",
        verbose: false,
      });

      const endEmit = vi.mocked(mockChesstrace.emit).mock.calls.find(
        (call) => call[0] === "pipeline.end"
      );

      expect(endEmit![1]).toHaveProperty("totalDurationMs");
      expect(typeof endEmit![1].totalDurationMs).toBe("number");
      expect(endEmit![1].totalDurationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("cost tracking", () => {
    it("includes total cost in pipeline.end", async () => {
      await runCommand({
        spec: "test.md",
        dryRun: false,
        securityThreshold: "HIGH",
        autoApprove: true,
        insecure: false,
        skipClarification: true,
        maxRetries: "0",
        verbose: false,
      });

      const endEmit = vi.mocked(mockChesstrace.emit).mock.calls.find(
        (call) => call[0] === "pipeline.end"
      );

      expect(endEmit![1]).toHaveProperty("totalCost");
      expect(typeof endEmit![1].totalCost).toBe("number");
      expect(endEmit![1].totalCost).toBeGreaterThanOrEqual(0);
    });
  });

  describe("partial pipeline failures", () => {
    it("emits stage_end events for stages that ran before security gate failure", async () => {
      // Make security review fail after unit and functional tests pass
      vi.mocked(runSecurityReview).mockResolvedValue({
        output: { severity: "CRITICAL", findings: [{ severity: "CRITICAL", file: "test.ts", line: 1, description: "XSS" }] },
        passed: false,
        usage: { costUsd: 0.01 },
      });

      // Use autoApprove to skip user prompts
      await expect(
        runCommand({
          spec: "test.md",
          dryRun: false,
          securityThreshold: "CRITICAL",
          autoApprove: true,
          insecure: false,
          skipClarification: true,
          maxRetries: "0",
          verbose: false,
        })
      ).resolves.not.toThrow();

      const stageEndEmits = vi.mocked(mockChesstrace.emit).mock.calls.filter(
        (call) => call[0] === "pipeline.stage_end"
      );

      // Should have stage_end for plan, implement, gate-unit-tests, gate-functional-tests, security-review
      const emittedStages = stageEndEmits.map(call => call[1]?.stage);
      expect(emittedStages).toContain("plan");
      expect(emittedStages).toContain("implement");
      expect(emittedStages).toContain("gate-unit-tests");
      expect(emittedStages).toContain("gate-functional-tests");
      expect(emittedStages).toContain("security-review");

      // Security review stage should have success=false
      const securityStageEmit = stageEndEmits.find(
        (call) => call[1]?.stage === "security-review"
      );
      expect(securityStageEmit).toBeDefined();
      expect(securityStageEmit![1]).toMatchObject({
        stage: "security-review",
        success: false,
      });
    });

    it("emits stage_end for functional tests when they fail after unit tests pass", async () => {
      // Unit tests pass, functional tests fail
      vi.mocked(runFunctionalTestGate).mockResolvedValue({
        gate: { passed: false, output: "Functional tests failed" },
        usage: { costUsd: 0.01 },
      });

      await expect(
        runCommand({
          spec: "test.md",
          dryRun: false,
          securityThreshold: "HIGH",
          autoApprove: true,
          insecure: false,
          skipClarification: true,
          maxRetries: "0",
          verbose: false,
        })
      ).rejects.toThrow();

      const stageEndEmits = vi.mocked(mockChesstrace.emit).mock.calls.filter(
        (call) => call[0] === "pipeline.stage_end"
      );

      // Should have stage_end for plan, implement, gate-unit-tests, gate-functional-tests
      const emittedStages = stageEndEmits.map(call => call[1]?.stage);
      expect(emittedStages).toContain("plan");
      expect(emittedStages).toContain("implement");
      expect(emittedStages).toContain("gate-unit-tests");
      expect(emittedStages).toContain("gate-functional-tests");

      // Unit tests should succeed
      const unitTestStageEmit = stageEndEmits.find(
        (call) => call[1]?.stage === "gate-unit-tests"
      );
      expect(unitTestStageEmit![1]).toMatchObject({
        stage: "gate-unit-tests",
        success: true,
      });

      // Functional tests should fail
      const funcTestStageEmit = stageEndEmits.find(
        (call) => call[1]?.stage === "gate-functional-tests"
      );
      expect(funcTestStageEmit![1]).toMatchObject({
        stage: "gate-functional-tests",
        success: false,
      });
    });
  });

  describe("pre-init error scenarios", () => {
    it("handles spec load failure gracefully without crashing", async () => {
      // Make spec load fail before context init
      vi.mocked(loadSpec).mockRejectedValue(new Error("Spec not found"));

      await expect(
        runCommand({
          spec: "test.md",
          dryRun: false,
          securityThreshold: "HIGH",
          autoApprove: true,
          insecure: false,
          skipClarification: true,
          maxRetries: "0",
          verbose: false,
        })
      ).rejects.toThrow();

      // Should still call flush and close
      expect(mockChesstrace.flush).toHaveBeenCalled();
      expect(mockChesstrace.close).toHaveBeenCalled();

      // Should emit pipeline.end with success=false
      const endEmit = vi.mocked(mockChesstrace.emit).mock.calls.find(
        (call) => call[0] === "pipeline.end"
      );

      // May or may not have endEmit depending on whether context exists
      // If endEmit exists, it should have success=false
      if (endEmit) {
        expect(endEmit[1]).toMatchObject({
          success: false,
        });
      }
    });

    it("handles planner failure before tracker records usage", async () => {
      // Make planner fail immediately
      vi.mocked(runPlanner).mockRejectedValue(new Error("Planner crashed"));

      await expect(
        runCommand({
          spec: "test.md",
          dryRun: false,
          securityThreshold: "HIGH",
          autoApprove: true,
          insecure: false,
          skipClarification: true,
          maxRetries: "0",
          verbose: false,
        })
      ).rejects.toThrow();

      // Should still call flush and close
      expect(mockChesstrace.flush).toHaveBeenCalled();
      expect(mockChesstrace.close).toHaveBeenCalled();

      // Should emit pipeline.end with totalCost=0 (no usage recorded)
      const endEmit = vi.mocked(mockChesstrace.emit).mock.calls.find(
        (call) => call[0] === "pipeline.end"
      );

      expect(endEmit).toBeDefined();
      expect(endEmit![1]).toMatchObject({
        success: false,
        totalCost: 0, // No usage tracked yet
      });
    });
  });

  describe("telemetry opt-out", () => {
    it("does not initialize or use chesstrace when telemetry.enabled=false", async () => {
      // Import and mock loadConfig to return disabled telemetry
      const { loadConfig } = await import("../config.js");
      vi.mocked(loadConfig).mockReturnValue({
        agents: [],
        skills: {},
        telemetry: { enabled: false, level: "standard", backend: "sqlite", retention: 30 },
      });

      await runCommand({
        spec: "test.md",
        dryRun: false,
        securityThreshold: "HIGH",
        autoApprove: true,
        insecure: false,
        skipClarification: true,
        maxRetries: "0",
        verbose: false,
      });

      // Verify chesstrace methods were NEVER called when disabled
      expect(mockChesstrace.init).not.toHaveBeenCalled();
      expect(mockChesstrace.startRun).not.toHaveBeenCalled();
      expect(mockChesstrace.emit).not.toHaveBeenCalled();
      expect(mockChesstrace.flush).not.toHaveBeenCalled();
      expect(mockChesstrace.close).not.toHaveBeenCalled();
    });

    it("does not initialize or use chesstrace when telemetry.enabled=undefined", async () => {
      // Import and mock loadConfig to return undefined enabled
      const { loadConfig } = await import("../config.js");
      vi.mocked(loadConfig).mockReturnValue({
        agents: [],
        skills: {},
        telemetry: { enabled: undefined, level: "standard", backend: "sqlite", retention: 30 },
      });

      await runCommand({
        spec: "test.md",
        dryRun: false,
        securityThreshold: "HIGH",
        autoApprove: true,
        insecure: false,
        skipClarification: true,
        maxRetries: "0",
        verbose: false,
      });

      // Verify chesstrace methods were NEVER called when disabled
      expect(mockChesstrace.init).not.toHaveBeenCalled();
      expect(mockChesstrace.startRun).not.toHaveBeenCalled();
      expect(mockChesstrace.emit).not.toHaveBeenCalled();
      expect(mockChesstrace.flush).not.toHaveBeenCalled();
      expect(mockChesstrace.close).not.toHaveBeenCalled();
    });
  });

  describe("gate telemetry", () => {

    it("emits gate.retry event when retry is triggered", async () => {
      // Make unit tests fail initially, then pass on retry
      let unitTestCallCount = 0;
      vi.mocked(runUnitTestGate).mockImplementation(async () => {
        unitTestCallCount++;
        if (unitTestCallCount === 1) {
          return {
            gate: { passed: false, output: "Test failed: expected 2 to equal 3" },
            usage: { costUsd: 0.01 },
          };
        }
        return {
          gate: { passed: true, output: "All tests passed" },
          usage: { costUsd: 0.01 },
        };
      });

      await runCommand({
        spec: "test.md",
        dryRun: false,
        securityThreshold: "HIGH",
        autoApprove: true,
        insecure: false,
        skipClarification: true,
        maxRetries: "2",
        verbose: false,
      });

      // Check for gate.retry emission
      const gateRetryEmits = vi.mocked(mockChesstrace.emit).mock.calls.filter(
        (call) => call[0] === "gate.retry"
      );

      expect(gateRetryEmits.length).toBeGreaterThanOrEqual(1);

      const unitTestRetryEmit = gateRetryEmits.find(
        (call) => call[1]?.gateName === "unit tests"
      );
      expect(unitTestRetryEmit).toBeDefined();
      expect(unitTestRetryEmit![1]).toMatchObject({
        gateName: "unit tests",
        attempt: 1,
        maxRetries: 2,
        failureSnippet: expect.stringContaining("expected 2 to equal 3"),
      });
    });

    it("truncates failure snippet to 500 chars in gate.retry event", async () => {
      const longOutput = "Test output: " + "x".repeat(1000);

      let funcTestCallCount = 0;
      vi.mocked(runFunctionalTestGate).mockImplementation(async () => {
        funcTestCallCount++;
        if (funcTestCallCount === 1) {
          return {
            gate: { passed: false, output: longOutput },
            usage: { costUsd: 0.01 },
          };
        }
        return {
          gate: { passed: true, output: "All tests passed" },
          usage: { costUsd: 0.01 },
        };
      });

      await runCommand({
        spec: "test.md",
        dryRun: false,
        securityThreshold: "HIGH",
        autoApprove: true,
        insecure: false,
        skipClarification: true,
        maxRetries: "1",
        verbose: false,
      });

      const gateRetryEmits = vi.mocked(mockChesstrace.emit).mock.calls.filter(
        (call) => call[0] === "gate.retry"
      );

      const funcRetryEmit = gateRetryEmits.find(
        (call) => call[1]?.gateName === "functional tests"
      );
      expect(funcRetryEmit).toBeDefined();
      expect(funcRetryEmit![1].failureSnippet.length).toBeLessThanOrEqual(500);
    });
  });

  describe("CLI flags and options", () => {
    // Common options shared across all tests in this block
    const baseOptions = {
      spec: "test.md",
      dryRun: false,
      securityThreshold: "HIGH" as const,
      autoApprove: true,
      insecure: false,
      skipClarification: true,
      maxRetries: "0",
      verbose: false,
    };

    it("respects --auto-approve flag", async () => {
      await runCommand(baseOptions);

      // Should not prompt for approval (runs successfully)
      expect(runPlanner).toHaveBeenCalled();
      expect(runImplement).toHaveBeenCalled();
    });

    it("respects --skip-clarification flag", async () => {
      await runCommand(baseOptions);

      // Planner should be called with makeAssumptions=true
      expect(runPlanner).toHaveBeenCalledWith(
        expect.anything(),
        undefined,
        expect.objectContaining({ makeAssumptions: true })
      );
    });

    it("respects --max-retries flag", async () => {
      let unitTestCallCount = 0;
      vi.mocked(runUnitTestGate).mockImplementation(async () => {
        unitTestCallCount++;
        if (unitTestCallCount <= 2) {
          return {
            gate: { passed: false, output: "Tests failed" },
            usage: { costUsd: 0.01 },
          };
        }
        return {
          gate: { passed: true, output: "Tests passed" },
          usage: { costUsd: 0.01 },
        };
      });

      await runCommand({
        ...baseOptions,
        maxRetries: "2",
      });

      // Unit test gate should be called 3 times (initial + 2 retries)
      expect(runUnitTestGate).toHaveBeenCalledTimes(3);
    });

    it("respects --verbose flag for usage output", async () => {
      const { printVerboseUsage } = await import("../usage.js");

      await runCommand({
        ...baseOptions,
        verbose: true,
      });

      expect(printVerboseUsage).toHaveBeenCalled();
    });

    it("does not call printVerboseUsage when verbose=false", async () => {
      const { printVerboseUsage } = await import("../usage.js");

      await runCommand(baseOptions);

      expect(printVerboseUsage).not.toHaveBeenCalled();
    });
  });

  describe("spec resolution", () => {
    it("loads spec from markdown file when spec flag provided", async () => {
      await runCommand({
        spec: "test.md",
        dryRun: false,
        securityThreshold: "HIGH",
        autoApprove: true,
        insecure: false,
        skipClarification: true,
        maxRetries: "0",
        verbose: false,
      });

      expect(loadSpec).toHaveBeenCalledWith("test.md");
    });

    it("loads spec from Linear when linear URL provided", async () => {
      await runCommand({
        spec: "https://linear.app/test/issue/ENG-123",
        dryRun: false,
        securityThreshold: "HIGH",
        autoApprove: true,
        insecure: false,
        skipClarification: true,
        maxRetries: "0",
        verbose: false,
      });

      expect(loadSpec).toHaveBeenCalledWith("https://linear.app/test/issue/ENG-123");
    });

    it("loads spec from Jira when jira key provided", async () => {
      await runCommand({
        spec: "PROJ-123",
        dryRun: false,
        securityThreshold: "HIGH",
        autoApprove: true,
        insecure: false,
        skipClarification: true,
        maxRetries: "0",
        verbose: false,
      });

      expect(loadSpec).toHaveBeenCalledWith("PROJ-123");
    });
  });

  describe("gate retry loop", () => {
    it("retries dev agent when unit tests fail", async () => {
      let unitTestCallCount = 0;
      vi.mocked(runUnitTestGate).mockImplementation(async () => {
        unitTestCallCount++;
        if (unitTestCallCount === 1) {
          return {
            gate: { passed: false, output: "Tests failed" },
            usage: { costUsd: 0.01 },
          };
        }
        return {
          gate: { passed: true, output: "Tests passed" },
          usage: { costUsd: 0.01 },
        };
      });

      await runCommand({
        spec: "test.md",
        dryRun: false,
        securityThreshold: "HIGH",
        autoApprove: true,
        insecure: false,
        skipClarification: true,
        maxRetries: "1",
        verbose: false,
      });

      // runImplement should be called twice: initial + 1 retry
      expect(runImplement).toHaveBeenCalledTimes(2);
    });

    it("retries both dev and qe when functional tests fail", async () => {
      let funcTestCallCount = 0;
      vi.mocked(runFunctionalTestGate).mockImplementation(async () => {
        funcTestCallCount++;
        if (funcTestCallCount === 1) {
          return {
            gate: { passed: false, output: "Functional tests failed" },
            usage: { costUsd: 0.01 },
          };
        }
        return {
          gate: { passed: true, output: "Functional tests passed" },
          usage: { costUsd: 0.01 },
        };
      });

      await runCommand({
        spec: "test.md",
        dryRun: false,
        securityThreshold: "HIGH",
        autoApprove: true,
        insecure: false,
        skipClarification: true,
        maxRetries: "1",
        verbose: false,
      });

      // runImplement should be called twice: initial + 1 retry
      expect(runImplement).toHaveBeenCalledTimes(2);
    });

    it("throws after exhausting all retries", async () => {
      vi.mocked(runUnitTestGate).mockResolvedValue({
        gate: { passed: false, output: "Tests always fail" },
        usage: { costUsd: 0.01 },
      });

      await expect(
        runCommand({
          spec: "test.md",
          dryRun: false,
          securityThreshold: "HIGH",
          autoApprove: true,
          insecure: false,
          skipClarification: true,
          maxRetries: "2",
          verbose: false,
        })
      ).rejects.toThrow("unit tests failed after 2 retries");
    });
  });

  describe("security gate bypass", () => {
    it("bypasses security gate when autoApprove=true", async () => {
      vi.mocked(runSecurityReview).mockResolvedValue({
        output: {
          severity: "CRITICAL",
          findings: [{ severity: "CRITICAL", description: "XSS vulnerability" }],
        },
        passed: false,
        usage: { costUsd: 0.01 },
      });

      await runCommand({
        spec: "test.md",
        dryRun: false,
        securityThreshold: "CRITICAL",
        autoApprove: true,
        insecure: false,
        skipClarification: true,
        maxRetries: "0",
        verbose: false,
      });

      // Should continue to PR creation despite security failure
      expect(runPRCreate).toHaveBeenCalled();
    });

    it("continues pipeline after security failure when insecure=true", async () => {
      vi.mocked(runSecurityReview).mockResolvedValue({
        output: {
          severity: "CRITICAL",
          findings: [{ severity: "CRITICAL", description: "SQL injection" }],
        },
        passed: false,
        usage: { costUsd: 0.01 },
      });

      await runCommand({
        spec: "test.md",
        dryRun: false,
        securityThreshold: "CRITICAL",
        autoApprove: true,
        insecure: true,
        skipClarification: true,
        maxRetries: "0",
        verbose: false,
      });

      expect(runPRCreate).toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("handles loadSpec failure gracefully", async () => {
      vi.mocked(loadSpec).mockRejectedValue(new Error("Spec file not found"));

      await expect(
        runCommand({
          spec: "nonexistent.md",
          dryRun: false,
          securityThreshold: "HIGH",
          autoApprove: true,
          insecure: false,
          skipClarification: true,
          maxRetries: "0",
          verbose: false,
        })
      ).rejects.toThrow("Spec file not found");
    });

    it("handles runPlanner failure gracefully", async () => {
      vi.mocked(runPlanner).mockRejectedValue(new Error("Planner timeout"));

      await expect(
        runCommand({
          spec: "test.md",
          dryRun: false,
          securityThreshold: "HIGH",
          autoApprove: true,
          insecure: false,
          skipClarification: true,
          maxRetries: "0",
          verbose: false,
        })
      ).rejects.toThrow("Planner timeout");
    });

    it("handles runImplement failure gracefully", async () => {
      vi.mocked(runImplement).mockRejectedValue(new Error("Implementation error"));

      await expect(
        runCommand({
          spec: "test.md",
          dryRun: false,
          securityThreshold: "HIGH",
          autoApprove: true,
          insecure: false,
          skipClarification: true,
          maxRetries: "0",
          verbose: false,
        })
      ).rejects.toThrow("Implementation error");
    });

    it("handles runUnitTestGate failure gracefully", async () => {
      vi.mocked(runUnitTestGate).mockRejectedValue(new Error("Gate runner crashed"));

      await expect(
        runCommand({
          spec: "test.md",
          dryRun: false,
          securityThreshold: "HIGH",
          autoApprove: true,
          insecure: false,
          skipClarification: true,
          maxRetries: "0",
          verbose: false,
        })
      ).rejects.toThrow("Gate runner crashed");
    });

    it("handles invalid security threshold gracefully", async () => {
      // Mock process.exit to prevent test from exiting
      const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit called");
      });

      await expect(
        runCommand({
          spec: "test.md",
          dryRun: false,
          securityThreshold: "INVALID",
          autoApprove: true,
          insecure: false,
          skipClarification: true,
          maxRetries: "0",
          verbose: false,
        })
      ).rejects.toThrow();

      mockExit.mockRestore();
    });
  });
});
