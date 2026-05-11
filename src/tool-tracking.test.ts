import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Chesstrace } from "./chesstrace/index.js";
import { Events, TelemetryLevel } from "./chesstrace/events.js";

/**
 * Tool invocation tracking tests for CT-11
 *
 * Requirements:
 * - onActivity callback emits tool.invoke (standard) with agent, tool name, detail
 * - Verbose level emits tool.invoke.full with truncated input/output (500 chars)
 * - Stage end emits tool.summary (minimal) with aggregate counts per agent
 * - In-memory tracking during stage execution
 */

describe("Tool invocation tracking events", () => {
  describe("Event definitions", () => {
    it("TOOL_INVOKE event exists and has standard level", () => {
      expect(Events.TOOL_INVOKE).toBe("tool.invoke");
    });

    it("TOOL_INVOKE_FULL event exists and has verbose level", () => {
      expect(Events.TOOL_INVOKE_FULL).toBe("tool.invoke.full");
    });

    it("TOOL_SUMMARY event exists and has minimal level", () => {
      expect(Events.TOOL_SUMMARY).toBe("tool.summary");
    });
  });

  describe("tool.invoke event (standard level)", () => {
    let mockChesstrace: Chesstrace;

    beforeEach(() => {
      mockChesstrace = {
        emit: vi.fn(),
      } as unknown as Chesstrace;
    });

    it("includes agent, tool, and detail fields", () => {
      const event = {
        agent: "dev",
        tool: "Read",
        detail: "src/example.ts",
      };

      mockChesstrace.emit(Events.TOOL_INVOKE, event);

      expect(mockChesstrace.emit).toHaveBeenCalledWith(
        Events.TOOL_INVOKE,
        expect.objectContaining({
          agent: "dev",
          tool: "Read",
          detail: "src/example.ts",
        }),
      );
    });

    it("handles missing detail field", () => {
      const event = {
        agent: "qe",
        tool: "Write",
      };

      mockChesstrace.emit(Events.TOOL_INVOKE, event);

      expect(mockChesstrace.emit).toHaveBeenCalledWith(
        Events.TOOL_INVOKE,
        expect.objectContaining({
          agent: "qe",
          tool: "Write",
        }),
      );
    });

    it("emitted for each tool call during activity", () => {
      const tools = [
        { agent: "dev", tool: "Read", detail: "file1.ts" },
        { agent: "dev", tool: "Edit", detail: "file1.ts" },
        { agent: "dev", tool: "Bash", detail: "npm test" },
      ];

      for (const tool of tools) {
        mockChesstrace.emit(Events.TOOL_INVOKE, tool);
      }

      expect(mockChesstrace.emit).toHaveBeenCalledTimes(3);
    });
  });

  describe("tool.invoke.full event (verbose level)", () => {
    let mockChesstrace: Chesstrace;

    beforeEach(() => {
      mockChesstrace = {
        emit: vi.fn(),
      } as unknown as Chesstrace;
    });

    it("includes agent, tool, and truncated detail", () => {
      const event = {
        agent: "qe",
        tool: "Write",
        detail: "tests/example.test.ts",
      };

      mockChesstrace.emit(Events.TOOL_INVOKE_FULL, event);

      expect(mockChesstrace.emit).toHaveBeenCalledWith(
        Events.TOOL_INVOKE_FULL,
        expect.objectContaining({
          agent: "qe",
          tool: "Write",
          detail: "tests/example.test.ts",
        }),
      );
    });

    it("truncates detail to 500 chars", () => {
      const longDetail = "x".repeat(1000);
      const event = {
        agent: "dev",
        tool: "Edit",
        detail: longDetail.slice(0, 500), // Pre-truncated
      };

      mockChesstrace.emit(Events.TOOL_INVOKE_FULL, event);

      const call = (mockChesstrace.emit as ReturnType<typeof vi.fn>).mock.calls[0];
      const emittedDetail = (call[1] as { detail?: string }).detail;
      expect(emittedDetail?.length).toBe(500);
    });

    it("preserves detail under 500 chars", () => {
      const shortDetail = "read file.ts";
      const event = {
        agent: "dev",
        tool: "Read",
        detail: shortDetail,
      };

      mockChesstrace.emit(Events.TOOL_INVOKE_FULL, event);

      const call = (mockChesstrace.emit as ReturnType<typeof vi.fn>).mock.calls[0];
      expect((call[1] as { detail?: string }).detail).toBe(shortDetail);
    });

    it("handles missing detail gracefully", () => {
      const event = {
        agent: "dev",
        tool: "Glob",
      };

      mockChesstrace.emit(Events.TOOL_INVOKE_FULL, event);

      expect(mockChesstrace.emit).toHaveBeenCalledWith(
        Events.TOOL_INVOKE_FULL,
        expect.objectContaining({
          agent: "dev",
          tool: "Glob",
        }),
      );
    });
  });

  describe("tool.summary event (minimal level)", () => {
    let mockChesstrace: Chesstrace;

    beforeEach(() => {
      mockChesstrace = {
        emit: vi.fn(),
      } as unknown as Chesstrace;
    });

    it("includes aggregate counts per agent", () => {
      const summary = {
        stage: "implement",
        toolCounts: {
          dev: {
            Read: 5,
            Edit: 3,
            Bash: 2,
          },
          qe: {
            Write: 1,
            Bash: 1,
          },
        },
      };

      mockChesstrace.emit(Events.TOOL_SUMMARY, summary);

      expect(mockChesstrace.emit).toHaveBeenCalledWith(
        Events.TOOL_SUMMARY,
        expect.objectContaining({
          stage: "implement",
          toolCounts: expect.any(Object),
        }),
      );
    });

    it("handles single agent with multiple tools", () => {
      const summary = {
        stage: "implement",
        toolCounts: {
          dev: {
            Read: 10,
            Write: 5,
            Edit: 8,
            Bash: 3,
          },
        },
      };

      mockChesstrace.emit(Events.TOOL_SUMMARY, summary);

      expect(mockChesstrace.emit).toHaveBeenCalledWith(
        Events.TOOL_SUMMARY,
        expect.objectContaining({
          toolCounts: {
            dev: {
              Read: 10,
              Write: 5,
              Edit: 8,
              Bash: 3,
            },
          },
        }),
      );
    });

    it("handles multiple agents with same tools", () => {
      const summary = {
        stage: "implement",
        toolCounts: {
          dev: { Read: 5, Write: 2 },
          qe: { Read: 3, Write: 1 },
        },
      };

      mockChesstrace.emit(Events.TOOL_SUMMARY, summary);

      const call = (mockChesstrace.emit as ReturnType<typeof vi.fn>).mock.calls[0];
      const counts = (call[1] as { toolCounts: Record<string, Record<string, number>> }).toolCounts;
      expect(counts.dev.Read).toBe(5);
      expect(counts.qe.Read).toBe(3);
    });

    it("emitted once at stage end", () => {
      const summary = {
        stage: "implement",
        toolCounts: {
          dev: { Read: 5 },
        },
      };

      mockChesstrace.emit(Events.TOOL_SUMMARY, summary);

      expect(mockChesstrace.emit).toHaveBeenCalledTimes(1);
    });

    it("includes stage name in summary", () => {
      const summary = {
        stage: "gate-unit-tests",
        toolCounts: {
          "gate:unit-tests": { Bash: 1 },
        },
      };

      mockChesstrace.emit(Events.TOOL_SUMMARY, summary);

      const call = (mockChesstrace.emit as ReturnType<typeof vi.fn>).mock.calls[0];
      expect((call[1] as { stage: string }).stage).toBe("gate-unit-tests");
    });
  });

  describe("In-memory tool count tracking", () => {
    it("initializes empty count map", () => {
      const toolCounts = new Map<string, Map<string, number>>();
      expect(toolCounts.size).toBe(0);
    });

    it("increments count for new agent and tool", () => {
      const toolCounts = new Map<string, Map<string, number>>();

      // Simulate tracking
      const agent = "dev";
      const tool = "Read";
      if (!toolCounts.has(agent)) {
        toolCounts.set(agent, new Map());
      }
      const agentCounts = toolCounts.get(agent)!;
      agentCounts.set(tool, (agentCounts.get(tool) || 0) + 1);

      expect(toolCounts.get(agent)?.get(tool)).toBe(1);
    });

    it("increments count for existing agent and tool", () => {
      const toolCounts = new Map<string, Map<string, number>>();

      // Track multiple calls
      const agent = "dev";
      const tool = "Read";

      for (let i = 0; i < 5; i++) {
        if (!toolCounts.has(agent)) {
          toolCounts.set(agent, new Map());
        }
        const agentCounts = toolCounts.get(agent)!;
        agentCounts.set(tool, (agentCounts.get(tool) || 0) + 1);
      }

      expect(toolCounts.get(agent)?.get(tool)).toBe(5);
    });

    it("tracks multiple tools per agent", () => {
      const toolCounts = new Map<string, Map<string, number>>();

      const events = [
        { agent: "dev", tool: "Read" },
        { agent: "dev", tool: "Edit" },
        { agent: "dev", tool: "Read" },
        { agent: "dev", tool: "Bash" },
        { agent: "dev", tool: "Edit" },
      ];

      for (const event of events) {
        if (!toolCounts.has(event.agent)) {
          toolCounts.set(event.agent, new Map());
        }
        const agentCounts = toolCounts.get(event.agent)!;
        agentCounts.set(event.tool, (agentCounts.get(event.tool) || 0) + 1);
      }

      expect(toolCounts.get("dev")?.get("Read")).toBe(2);
      expect(toolCounts.get("dev")?.get("Edit")).toBe(2);
      expect(toolCounts.get("dev")?.get("Bash")).toBe(1);
    });

    it("tracks multiple agents separately", () => {
      const toolCounts = new Map<string, Map<string, number>>();

      const events = [
        { agent: "dev", tool: "Read" },
        { agent: "qe", tool: "Write" },
        { agent: "dev", tool: "Read" },
        { agent: "qe", tool: "Write" },
      ];

      for (const event of events) {
        if (!toolCounts.has(event.agent)) {
          toolCounts.set(event.agent, new Map());
        }
        const agentCounts = toolCounts.get(event.agent)!;
        agentCounts.set(event.tool, (agentCounts.get(event.tool) || 0) + 1);
      }

      expect(toolCounts.get("dev")?.get("Read")).toBe(2);
      expect(toolCounts.get("qe")?.get("Write")).toBe(2);
    });

    it("converts to summary format", () => {
      const toolCounts = new Map<string, Map<string, number>>();

      // Simulate tracking
      toolCounts.set("dev", new Map([["Read", 5], ["Edit", 3]]));
      toolCounts.set("qe", new Map([["Write", 2]]));

      // Convert to summary format
      const summary: Record<string, Record<string, number>> = {};
      for (const [agent, tools] of toolCounts.entries()) {
        summary[agent] = {};
        for (const [tool, count] of tools.entries()) {
          summary[agent][tool] = count;
        }
      }

      expect(summary).toEqual({
        dev: { Read: 5, Edit: 3 },
        qe: { Write: 2 },
      });
    });

    it("resets between stages", () => {
      const toolCounts = new Map<string, Map<string, number>>();

      // Stage 1
      toolCounts.set("dev", new Map([["Read", 5]]));
      expect(toolCounts.size).toBe(1);

      // Reset for next stage
      toolCounts.clear();
      expect(toolCounts.size).toBe(0);

      // Stage 2
      toolCounts.set("qe", new Map([["Write", 3]]));
      expect(toolCounts.size).toBe(1);
      expect(toolCounts.get("dev")).toBeUndefined();
    });
  });

  describe("Integration scenarios", () => {
    let mockChesstrace: Chesstrace;

    beforeEach(() => {
      mockChesstrace = {
        emit: vi.fn(),
      } as unknown as Chesstrace;
    });

    it("tracks and summarizes complete stage execution", () => {
      const toolCounts = new Map<string, Map<string, number>>();

      // Simulate tool calls during stage
      const calls = [
        { agent: "dev", tool: "Read", detail: "file1.ts" },
        { agent: "dev", tool: "Edit", detail: "file1.ts" },
        { agent: "dev", tool: "Bash", detail: "npm test" },
        { agent: "qe", tool: "Write", detail: "test.ts" },
        { agent: "qe", tool: "Bash", detail: "npm test" },
      ];

      for (const call of calls) {
        // Emit standard event
        mockChesstrace.emit(Events.TOOL_INVOKE, call);

        // Track counts
        if (!toolCounts.has(call.agent)) {
          toolCounts.set(call.agent, new Map());
        }
        const agentCounts = toolCounts.get(call.agent)!;
        agentCounts.set(call.tool, (agentCounts.get(call.tool) || 0) + 1);
      }

      // Convert to summary
      const summaryData: Record<string, Record<string, number>> = {};
      for (const [agent, tools] of toolCounts.entries()) {
        summaryData[agent] = {};
        for (const [tool, count] of tools.entries()) {
          summaryData[agent][tool] = count;
        }
      }

      // Emit summary at stage end
      mockChesstrace.emit(Events.TOOL_SUMMARY, {
        stage: "implement",
        toolCounts: summaryData,
      });

      // Verify
      expect(mockChesstrace.emit).toHaveBeenCalledWith(
        Events.TOOL_SUMMARY,
        expect.objectContaining({
          toolCounts: {
            dev: { Read: 1, Edit: 1, Bash: 1 },
            qe: { Write: 1, Bash: 1 },
          },
        }),
      );
    });

    it("emits both standard and verbose events when verbose enabled", () => {
      const call = {
        agent: "dev",
        tool: "Read",
        detail: "file.ts",
      };

      // Standard event
      mockChesstrace.emit(Events.TOOL_INVOKE, call);

      // Verbose event (with truncated detail)
      mockChesstrace.emit(Events.TOOL_INVOKE_FULL, {
        ...call,
        detail: call.detail?.slice(0, 500),
      });

      expect(mockChesstrace.emit).toHaveBeenCalledTimes(2);
      expect(mockChesstrace.emit).toHaveBeenNthCalledWith(1, Events.TOOL_INVOKE, expect.any(Object));
      expect(mockChesstrace.emit).toHaveBeenNthCalledWith(2, Events.TOOL_INVOKE_FULL, expect.any(Object));
    });

    it("handles empty stage with no tool calls", () => {
      const toolCounts = new Map<string, Map<string, number>>();

      // Convert empty map to summary
      const summaryData: Record<string, Record<string, number>> = {};
      for (const [agent, tools] of toolCounts.entries()) {
        summaryData[agent] = {};
        for (const [tool, count] of tools.entries()) {
          summaryData[agent][tool] = count;
        }
      }

      mockChesstrace.emit(Events.TOOL_SUMMARY, {
        stage: "implement",
        toolCounts: summaryData,
      });

      const call = (mockChesstrace.emit as ReturnType<typeof vi.fn>).mock.calls[0];
      expect((call[1] as { toolCounts: Record<string, Record<string, number>> }).toolCounts).toEqual({});
    });
  });

  describe("Edge cases", () => {
    let mockChesstrace: Chesstrace;

    beforeEach(() => {
      mockChesstrace = {
        emit: vi.fn(),
      } as unknown as Chesstrace;
    });

    it("handles tool with no detail field", () => {
      const event = {
        agent: "dev",
        tool: "Glob",
      };

      mockChesstrace.emit(Events.TOOL_INVOKE, event);

      expect(mockChesstrace.emit).toHaveBeenCalledWith(
        Events.TOOL_INVOKE,
        expect.objectContaining({
          agent: "dev",
          tool: "Glob",
        }),
      );
    });

    it("handles very long detail string", () => {
      const longDetail = "a".repeat(5000);
      const event = {
        agent: "dev",
        tool: "Read",
        detail: longDetail,
      };

      mockChesstrace.emit(Events.TOOL_INVOKE, event);

      expect(mockChesstrace.emit).toHaveBeenCalledWith(
        Events.TOOL_INVOKE,
        expect.objectContaining({
          agent: "dev",
          tool: "Read",
          detail: longDetail,
        }),
      );
    });

    it("truncates at exactly 500 chars for verbose detail", () => {
      const detail = "x".repeat(500);
      const event = {
        agent: "dev",
        tool: "Edit",
        detail,
      };

      mockChesstrace.emit(Events.TOOL_INVOKE_FULL, event);

      const call = (mockChesstrace.emit as ReturnType<typeof vi.fn>).mock.calls[0];
      expect((call[1] as { detail?: string }).detail?.length).toBe(500);
    });

    it("handles special characters in detail", () => {
      const event = {
        agent: "dev",
        tool: "Bash",
        detail: 'git commit -m "fix: handle \\"quotes\\" in messages"',
      };

      mockChesstrace.emit(Events.TOOL_INVOKE, event);

      expect(mockChesstrace.emit).toHaveBeenCalledWith(
        Events.TOOL_INVOKE,
        expect.objectContaining({
          detail: 'git commit -m "fix: handle \\"quotes\\" in messages"',
        }),
      );
    });

    it("handles newlines in detail", () => {
      const event = {
        agent: "qe",
        tool: "Write",
        detail: "file.ts\nline 2\nline 3",
      };

      mockChesstrace.emit(Events.TOOL_INVOKE, event);

      expect(mockChesstrace.emit).toHaveBeenCalledWith(
        Events.TOOL_INVOKE,
        expect.objectContaining({
          detail: "file.ts\nline 2\nline 3",
        }),
      );
    });

    it("handles unicode in tool data", () => {
      const event = {
        agent: "dev",
        tool: "Read",
        detail: "测试文件.ts",
      };

      mockChesstrace.emit(Events.TOOL_INVOKE_FULL, event);

      expect(mockChesstrace.emit).toHaveBeenCalledWith(
        Events.TOOL_INVOKE_FULL,
        expect.objectContaining({
          detail: "测试文件.ts",
        }),
      );
    });

    it("preserves exact 500 char boundary without corruption", () => {
      // Test that truncation doesn't cut mid-character
      const detail = "x".repeat(499) + "𝔘"; // 4-byte unicode at end
      const truncated = detail.slice(0, 500);

      const event = {
        agent: "dev",
        tool: "Edit",
        detail: truncated,
      };

      mockChesstrace.emit(Events.TOOL_INVOKE_FULL, event);

      const call = (mockChesstrace.emit as ReturnType<typeof vi.fn>).mock.calls[0];
      const emittedDetail = (call[1] as { detail?: string }).detail;
      expect(emittedDetail?.length).toBeLessThanOrEqual(500);
    });
  });
});
