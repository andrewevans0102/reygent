import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runGate, runUnitTestGate, runFunctionalTestGate } from "../src/gate.js";
import type { TaskContext } from "../src/task.js";
import * as implement from "../src/implement.js";

vi.mock("../src/implement.js", () => ({
  spawnAgent: vi.fn(),
}));

describe("gate.ts telemetry instrumentation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("runGate - gate.result events", () => {
    it("should emit gate.result with passed=true when gate passes", async () => {
      const mockSpawnAgent = vi.mocked(implement.spawnAgent);
      mockSpawnAgent.mockResolvedValue({
        stdout: "Tests running...\nGATE_RESULT:PASS\n",
        stderr: "",
        exitCode: 0,
        usage: {
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
          cost: 0.001,
        },
      });

      const result = await runGate("gate:unit-tests", "Run tests", {});

      expect(result.gate.passed).toBe(true);
      expect(result.gate.output).toContain("GATE_RESULT:PASS");
      expect(result.usage).toEqual({
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        cost: 0.001,
      });
    });

    it("should emit gate.result with passed=false when gate fails", async () => {
      const mockSpawnAgent = vi.mocked(implement.spawnAgent);
      mockSpawnAgent.mockResolvedValue({
        stdout: "Tests running...\n2 tests failed\nGATE_RESULT:FAIL\n",
        stderr: "",
        exitCode: 1,
        usage: {
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
          cost: 0.001,
        },
      });

      const result = await runGate("gate:unit-tests", "Run tests", {});

      expect(result.gate.passed).toBe(false);
      expect(result.gate.output).toContain("GATE_RESULT:FAIL");
    });

    it("should emit gate.result with passed=false when exit code non-zero", async () => {
      const mockSpawnAgent = vi.mocked(implement.spawnAgent);
      mockSpawnAgent.mockResolvedValue({
        stdout: "GATE_RESULT:PASS\n",
        stderr: "Error occurred",
        exitCode: 1,
        usage: undefined,
      });

      const result = await runGate("gate:unit-tests", "Run tests", {});

      expect(result.gate.passed).toBe(false);
    });

    it("should emit gate.result with passed=false when no marker present", async () => {
      const mockSpawnAgent = vi.mocked(implement.spawnAgent);
      mockSpawnAgent.mockResolvedValue({
        stdout: "Tests completed\n",
        stderr: "",
        exitCode: 0,
        usage: undefined,
      });

      const result = await runGate("gate:unit-tests", "Run tests", {});

      expect(result.gate.passed).toBe(false);
    });

    it("should emit gate.result with passed=false when both PASS and FAIL markers present", async () => {
      const mockSpawnAgent = vi.mocked(implement.spawnAgent);
      mockSpawnAgent.mockResolvedValue({
        stdout: "GATE_RESULT:PASS\nGATE_RESULT:FAIL\n",
        stderr: "",
        exitCode: 0,
        usage: undefined,
      });

      const result = await runGate("gate:unit-tests", "Run tests", {});

      expect(result.gate.passed).toBe(false);
    });
  });

  describe("runUnitTestGate - gate execution", () => {
    it("should execute gate with correct prompt and agent name", async () => {
      const mockSpawnAgent = vi.mocked(implement.spawnAgent);
      mockSpawnAgent.mockResolvedValue({
        stdout: "GATE_RESULT:PASS\n",
        stderr: "",
        exitCode: 0,
        usage: undefined,
      });

      const context: TaskContext = {
        spec: {
          source: "markdown",
          path: "/test/spec.md",
          title: "Test spec",
          content: "# Test",
        },
        results: [],
        implement: {
          dev: {
            files: ["src/foo.ts", "src/bar.ts"],
          },
          qe: null,
        },
      };

      await runUnitTestGate(context, {});

      expect(mockSpawnAgent).toHaveBeenCalledWith(
        "gate:unit-tests",
        expect.stringContaining("test-execution mode"),
        {},
      );
      expect(mockSpawnAgent).toHaveBeenCalledWith(
        "gate:unit-tests",
        expect.stringContaining("src/foo.ts"),
        {},
      );
    });

    it("should throw when implement stage has not run", async () => {
      const context: TaskContext = {
        spec: {
          source: "markdown",
          path: "/test/spec.md",
          title: "Test spec",
          content: "# Test",
        },
        results: [],
      };

      await expect(runUnitTestGate(context, {})).rejects.toThrow(
        "gate:unit-tests: implement stage has not run",
      );
    });

    it("should throw when dev output is null", async () => {
      const context: TaskContext = {
        spec: {
          source: "markdown",
          path: "/test/spec.md",
          title: "Test spec",
          content: "# Test",
        },
        results: [],
        implement: {
          dev: null,
          qe: null,
        },
      };

      await expect(runUnitTestGate(context, {})).rejects.toThrow(
        "gate:unit-tests: dev output is null",
      );
    });

    it("should include file list in prompt when files present", async () => {
      const mockSpawnAgent = vi.mocked(implement.spawnAgent);
      mockSpawnAgent.mockResolvedValue({
        stdout: "GATE_RESULT:PASS\n",
        stderr: "",
        exitCode: 0,
        usage: undefined,
      });

      const context: TaskContext = {
        spec: {
          source: "markdown",
          path: "/test/spec.md",
          title: "Test spec",
          content: "# Test",
        },
        results: [],
        implement: {
          dev: {
            files: ["src/new-feature.ts"],
          },
          qe: null,
        },
      };

      await runUnitTestGate(context, {});

      expect(mockSpawnAgent).toHaveBeenCalledWith(
        "gate:unit-tests",
        expect.stringContaining("- src/new-feature.ts"),
        {},
      );
    });

    it("should handle empty file list", async () => {
      const mockSpawnAgent = vi.mocked(implement.spawnAgent);
      mockSpawnAgent.mockResolvedValue({
        stdout: "GATE_RESULT:PASS\n",
        stderr: "",
        exitCode: 0,
        usage: undefined,
      });

      const context: TaskContext = {
        spec: {
          source: "markdown",
          path: "/test/spec.md",
          title: "Test spec",
          content: "# Test",
        },
        results: [],
        implement: {
          dev: {
            files: [],
          },
          qe: null,
        },
      };

      await runUnitTestGate(context, {});

      expect(mockSpawnAgent).toHaveBeenCalledWith(
        "gate:unit-tests",
        expect.stringContaining("no new files"),
        {},
      );
    });
  });

  describe("runFunctionalTestGate - gate execution", () => {
    it("should execute gate with correct prompt and agent name", async () => {
      const mockSpawnAgent = vi.mocked(implement.spawnAgent);
      mockSpawnAgent.mockResolvedValue({
        stdout: "GATE_RESULT:PASS\n",
        stderr: "",
        exitCode: 0,
        usage: undefined,
      });

      const context: TaskContext = {
        spec: {
          source: "markdown",
          path: "/test/spec.md",
          title: "Test spec",
          content: "# Test",
        },
        results: [],
        implement: {
          dev: null,
          qe: {
            testFiles: ["tests/feature.test.ts"],
          },
        },
      };

      await runFunctionalTestGate(context, {});

      expect(mockSpawnAgent).toHaveBeenCalledWith(
        "gate:functional-tests",
        expect.stringContaining("test-execution mode"),
        {},
      );
      expect(mockSpawnAgent).toHaveBeenCalledWith(
        "gate:functional-tests",
        expect.stringContaining("tests/feature.test.ts"),
        {},
      );
    });

    it("should throw when implement stage has not run", async () => {
      const context: TaskContext = {
        spec: {
          source: "markdown",
          path: "/test/spec.md",
          title: "Test spec",
          content: "# Test",
        },
        results: [],
      };

      await expect(runFunctionalTestGate(context, {})).rejects.toThrow(
        "gate:functional-tests: implement stage has not run",
      );
    });

    it("should throw when qe output is null", async () => {
      const context: TaskContext = {
        spec: {
          source: "markdown",
          path: "/test/spec.md",
          title: "Test spec",
          content: "# Test",
        },
        results: [],
        implement: {
          dev: null,
          qe: null,
        },
      };

      await expect(runFunctionalTestGate(context, {})).rejects.toThrow(
        "gate:functional-tests: qe output is null",
      );
    });

    it("should include test file list in prompt when files present", async () => {
      const mockSpawnAgent = vi.mocked(implement.spawnAgent);
      mockSpawnAgent.mockResolvedValue({
        stdout: "GATE_RESULT:PASS\n",
        stderr: "",
        exitCode: 0,
        usage: undefined,
      });

      const context: TaskContext = {
        spec: {
          source: "markdown",
          path: "/test/spec.md",
          title: "Test spec",
          content: "# Test",
        },
        results: [],
        implement: {
          dev: null,
          qe: {
            testFiles: ["tests/integration.test.ts", "tests/unit.test.ts"],
          },
        },
      };

      await runFunctionalTestGate(context, {});

      expect(mockSpawnAgent).toHaveBeenCalledWith(
        "gate:functional-tests",
        expect.stringContaining("- tests/integration.test.ts"),
        {},
      );
      expect(mockSpawnAgent).toHaveBeenCalledWith(
        "gate:functional-tests",
        expect.stringContaining("- tests/unit.test.ts"),
        {},
      );
    });

    it("should handle empty test file list", async () => {
      const mockSpawnAgent = vi.mocked(implement.spawnAgent);
      mockSpawnAgent.mockResolvedValue({
        stdout: "GATE_RESULT:PASS\n",
        stderr: "",
        exitCode: 0,
        usage: undefined,
      });

      const context: TaskContext = {
        spec: {
          source: "markdown",
          path: "/test/spec.md",
          title: "Test spec",
          content: "# Test",
        },
        results: [],
        implement: {
          dev: null,
          qe: {
            testFiles: [],
          },
        },
      };

      await runFunctionalTestGate(context, {});

      expect(mockSpawnAgent).toHaveBeenCalledWith(
        "gate:functional-tests",
        expect.stringContaining("no new test files"),
        {},
      );
    });
  });

  describe("gate result edge cases", () => {
    it("should handle missing usage info gracefully", async () => {
      const mockSpawnAgent = vi.mocked(implement.spawnAgent);
      mockSpawnAgent.mockResolvedValue({
        stdout: "GATE_RESULT:PASS\n",
        stderr: "",
        exitCode: 0,
        usage: undefined,
      });

      const result = await runGate("gate:unit-tests", "Run tests", {});

      expect(result.gate.passed).toBe(true);
      expect(result.usage).toBeUndefined();
    });

    it("should preserve full output in gate result", async () => {
      const mockSpawnAgent = vi.mocked(implement.spawnAgent);
      const fullOutput = "Starting tests...\nTest 1: PASS\nTest 2: PASS\nGATE_RESULT:PASS\n";
      mockSpawnAgent.mockResolvedValue({
        stdout: fullOutput,
        stderr: "",
        exitCode: 0,
        usage: undefined,
      });

      const result = await runGate("gate:unit-tests", "Run tests", {});

      expect(result.gate.output).toBe(fullOutput);
    });
  });
});
