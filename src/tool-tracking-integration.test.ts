import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Chesstrace } from "./chesstrace/index.js";
import { Events, TelemetryLevel } from "./chesstrace/events.js";
import type { ActivityEvent } from "./providers/types.js";

/**
 * Integration tests for CT-11 tool tracking
 *
 * Tests full flow:
 * 1. onActivity callback receives tool invocations
 * 2. Emits tool.invoke (standard) events with agent, tool, detail
 * 3. Emits tool.invoke.full (verbose) events with truncated input/output
 * 4. Tracks counts in-memory during stage
 * 5. Emits tool.summary (minimal) at stage end with aggregates
 */

interface ToolTracker {
  counts: Map<string, Map<string, number>>;
  track: (agent: string, tool: string) => void;
  getSummary: () => { toolCounts: Record<string, Record<string, number>>; totalTools: number };
  reset: () => void;
}

function createToolTracker(): ToolTracker {
  const counts = new Map<string, Map<string, number>>();

  return {
    counts,
    track(agent: string, tool: string) {
      if (!counts.has(agent)) {
        counts.set(agent, new Map());
      }
      const agentCounts = counts.get(agent)!;
      agentCounts.set(tool, (agentCounts.get(tool) || 0) + 1);
    },
    getSummary() {
      const toolCounts: Record<string, Record<string, number>> = {};
      let totalTools = 0;

      for (const [agent, tools] of counts.entries()) {
        toolCounts[agent] = {};
        for (const [tool, count] of tools.entries()) {
          toolCounts[agent][tool] = count;
          totalTools += count;
        }
      }

      return { toolCounts, totalTools };
    },
    reset() {
      counts.clear();
    },
  };
}

function truncateToolData(data: string | undefined, maxLength: number): string | undefined {
  if (!data) return data;
  return data.length > maxLength ? data.slice(0, maxLength) : data;
}

describe("Tool tracking integration", () => {
  let mockChesstrace: Chesstrace;
  let tracker: ToolTracker;
  let telemetryLevel: TelemetryLevel;

  beforeEach(() => {
    mockChesstrace = {
      emit: vi.fn(),
    } as unknown as Chesstrace;
    tracker = createToolTracker();
    telemetryLevel = TelemetryLevel.standard;
  });

  describe("Standard level (tool.invoke)", () => {
    it("emits tool.invoke on each activity event", () => {
      const events: ActivityEvent[] = [
        { agent: "dev", tool: "Read", detail: "src/file.ts" },
        { agent: "dev", tool: "Edit", detail: "src/file.ts" },
        { agent: "qe", tool: "Write", detail: "tests/file.test.ts" },
      ];

      for (const event of events) {
        if (event.tool) {
          tracker.track(event.agent, event.tool);
          mockChesstrace.emit(Events.TOOL_INVOKE, {
            agent: event.agent,
            tool: event.tool,
            detail: event.detail,
          });
        }
      }

      expect(mockChesstrace.emit).toHaveBeenCalledTimes(3);
      expect(mockChesstrace.emit).toHaveBeenNthCalledWith(1, Events.TOOL_INVOKE, {
        agent: "dev",
        tool: "Read",
        detail: "src/file.ts",
      });
      expect(mockChesstrace.emit).toHaveBeenNthCalledWith(2, Events.TOOL_INVOKE, {
        agent: "dev",
        tool: "Edit",
        detail: "src/file.ts",
      });
      expect(mockChesstrace.emit).toHaveBeenNthCalledWith(3, Events.TOOL_INVOKE, {
        agent: "qe",
        tool: "Write",
        detail: "tests/file.test.ts",
      });
    });

    it("tracks counts while emitting events", () => {
      const events: ActivityEvent[] = [
        { agent: "dev", tool: "Read", detail: "file1.ts" },
        { agent: "dev", tool: "Read", detail: "file2.ts" },
        { agent: "dev", tool: "Edit", detail: "file1.ts" },
        { agent: "qe", tool: "Write", detail: "test.ts" },
      ];

      for (const event of events) {
        if (event.tool) {
          tracker.track(event.agent, event.tool);
          mockChesstrace.emit(Events.TOOL_INVOKE, {
            agent: event.agent,
            tool: event.tool,
            detail: event.detail,
          });
        }
      }

      expect(tracker.counts.get("dev")?.get("Read")).toBe(2);
      expect(tracker.counts.get("dev")?.get("Edit")).toBe(1);
      expect(tracker.counts.get("qe")?.get("Write")).toBe(1);
    });

    it("handles activity events without tool field", () => {
      const events: ActivityEvent[] = [
        { agent: "dev" },
        { agent: "dev", tool: "Read", detail: "file.ts" },
      ];

      for (const event of events) {
        if (event.tool) {
          tracker.track(event.agent, event.tool);
          mockChesstrace.emit(Events.TOOL_INVOKE, {
            agent: event.agent,
            tool: event.tool,
            detail: event.detail,
          });
        }
      }

      // Only second event should emit
      expect(mockChesstrace.emit).toHaveBeenCalledTimes(1);
      expect(tracker.counts.get("dev")?.get("Read")).toBe(1);
    });

    it("handles activity events without detail field", () => {
      const event: ActivityEvent = { agent: "dev", tool: "Glob" };

      if (event.tool) {
        tracker.track(event.agent, event.tool);
        mockChesstrace.emit(Events.TOOL_INVOKE, {
          agent: event.agent,
          tool: event.tool,
          detail: event.detail,
        });
      }

      expect(mockChesstrace.emit).toHaveBeenCalledWith(Events.TOOL_INVOKE, {
        agent: "dev",
        tool: "Glob",
        detail: undefined,
      });
    });
  });

  describe("Verbose level (tool.invoke.full)", () => {
    beforeEach(() => {
      telemetryLevel = TelemetryLevel.verbose;
    });

    it("emits both tool.invoke and tool.invoke.full", () => {
      const event: ActivityEvent = {
        agent: "dev",
        tool: "Read",
        detail: "file.ts",
      };

      const input = "file_path: file.ts";
      const output = "File contents: ...";

      if (event.tool) {
        tracker.track(event.agent, event.tool);

        // Emit standard event
        mockChesstrace.emit(Events.TOOL_INVOKE, {
          agent: event.agent,
          tool: event.tool,
          detail: event.detail,
        });

        // Emit verbose event with input/output
        mockChesstrace.emit(Events.TOOL_INVOKE_FULL, {
          agent: event.agent,
          tool: event.tool,
          detail: event.detail,
          input: truncateToolData(input, 500),
          output: truncateToolData(output, 500),
        });
      }

      expect(mockChesstrace.emit).toHaveBeenCalledTimes(2);
      expect(mockChesstrace.emit).toHaveBeenNthCalledWith(1, Events.TOOL_INVOKE, expect.any(Object));
      expect(mockChesstrace.emit).toHaveBeenNthCalledWith(2, Events.TOOL_INVOKE_FULL, {
        agent: "dev",
        tool: "Read",
        detail: "file.ts",
        input: "file_path: file.ts",
        output: "File contents: ...",
      });
    });

    it("truncates input to 500 chars", () => {
      const longInput = "x".repeat(1000);
      const event: ActivityEvent = {
        agent: "dev",
        tool: "Edit",
        detail: "file.ts",
      };

      if (event.tool) {
        tracker.track(event.agent, event.tool);

        mockChesstrace.emit(Events.TOOL_INVOKE_FULL, {
          agent: event.agent,
          tool: event.tool,
          detail: event.detail,
          input: truncateToolData(longInput, 500),
          output: "ok",
        });
      }

      const call = (mockChesstrace.emit as ReturnType<typeof vi.fn>).mock.calls[0];
      expect((call[1] as { input: string }).input).toHaveLength(500);
    });

    it("truncates output to 500 chars", () => {
      const longOutput = "y".repeat(1000);
      const event: ActivityEvent = {
        agent: "qe",
        tool: "Bash",
        detail: "npm test",
      };

      if (event.tool) {
        tracker.track(event.agent, event.tool);

        mockChesstrace.emit(Events.TOOL_INVOKE_FULL, {
          agent: event.agent,
          tool: event.tool,
          detail: event.detail,
          input: "npm test",
          output: truncateToolData(longOutput, 500),
        });
      }

      const call = (mockChesstrace.emit as ReturnType<typeof vi.fn>).mock.calls[0];
      expect((call[1] as { output: string }).output).toHaveLength(500);
    });

    it("preserves short input and output", () => {
      const shortInput = "read file.ts";
      const shortOutput = "Contents here";
      const event: ActivityEvent = {
        agent: "dev",
        tool: "Read",
        detail: "file.ts",
      };

      if (event.tool) {
        tracker.track(event.agent, event.tool);

        mockChesstrace.emit(Events.TOOL_INVOKE_FULL, {
          agent: event.agent,
          tool: event.tool,
          detail: event.detail,
          input: truncateToolData(shortInput, 500),
          output: truncateToolData(shortOutput, 500),
        });
      }

      const call = (mockChesstrace.emit as ReturnType<typeof vi.fn>).mock.calls[0];
      expect((call[1] as { input: string }).input).toBe("read file.ts");
      expect((call[1] as { output: string }).output).toBe("Contents here");
    });
  });

  describe("Minimal level (tool.summary)", () => {
    it("emits summary at stage end", () => {
      const events: ActivityEvent[] = [
        { agent: "dev", tool: "Read", detail: "file1.ts" },
        { agent: "dev", tool: "Read", detail: "file2.ts" },
        { agent: "dev", tool: "Edit", detail: "file1.ts" },
        { agent: "qe", tool: "Write", detail: "test.ts" },
        { agent: "qe", tool: "Bash", detail: "npm test" },
      ];

      // Track all tool calls
      for (const event of events) {
        if (event.tool) {
          tracker.track(event.agent, event.tool);
        }
      }

      // Emit summary at stage end
      const summary = tracker.getSummary();
      mockChesstrace.emit(Events.TOOL_SUMMARY, {
        stage: "implement",
        ...summary,
      });

      expect(mockChesstrace.emit).toHaveBeenCalledWith(Events.TOOL_SUMMARY, {
        stage: "implement",
        toolCounts: {
          dev: { Read: 2, Edit: 1 },
          qe: { Write: 1, Bash: 1 },
        },
        totalTools: 5,
      });
    });

    it("calculates correct totals", () => {
      const events: ActivityEvent[] = [
        { agent: "dev", tool: "Read" },
        { agent: "dev", tool: "Read" },
        { agent: "dev", tool: "Read" },
        { agent: "qe", tool: "Write" },
        { agent: "qe", tool: "Write" },
      ];

      for (const event of events) {
        if (event.tool) {
          tracker.track(event.agent, event.tool);
        }
      }

      const summary = tracker.getSummary();

      expect(summary.totalTools).toBe(5);
      expect(summary.toolCounts.dev.Read).toBe(3);
      expect(summary.toolCounts.qe.Write).toBe(2);
    });

    it("handles empty summary", () => {
      const summary = tracker.getSummary();

      mockChesstrace.emit(Events.TOOL_SUMMARY, {
        stage: "implement",
        ...summary,
      });

      expect(mockChesstrace.emit).toHaveBeenCalledWith(Events.TOOL_SUMMARY, {
        stage: "implement",
        toolCounts: {},
        totalTools: 0,
      });
    });

    it("includes stage name in summary", () => {
      const event: ActivityEvent = { agent: "dev", tool: "Bash", detail: "npm test" };

      if (event.tool) {
        tracker.track(event.agent, event.tool);
      }

      const summary = tracker.getSummary();
      mockChesstrace.emit(Events.TOOL_SUMMARY, {
        stage: "gate-unit-tests",
        ...summary,
      });

      const call = (mockChesstrace.emit as ReturnType<typeof vi.fn>).mock.calls[0];
      expect((call[1] as { stage: string }).stage).toBe("gate-unit-tests");
    });

    it("resets tracker between stages", () => {
      // Stage 1
      const stage1Events: ActivityEvent[] = [
        { agent: "dev", tool: "Read", detail: "file.ts" },
        { agent: "dev", tool: "Edit", detail: "file.ts" },
      ];

      for (const event of stage1Events) {
        if (event.tool) {
          tracker.track(event.agent, event.tool);
        }
      }

      let summary = tracker.getSummary();
      expect(summary.totalTools).toBe(2);

      // Reset for stage 2
      tracker.reset();

      // Stage 2
      const stage2Events: ActivityEvent[] = [
        { agent: "qe", tool: "Write", detail: "test.ts" },
      ];

      for (const event of stage2Events) {
        if (event.tool) {
          tracker.track(event.agent, event.tool);
        }
      }

      summary = tracker.getSummary();
      expect(summary.totalTools).toBe(1);
      expect(summary.toolCounts.dev).toBeUndefined();
      expect(summary.toolCounts.qe.Write).toBe(1);
    });
  });

  describe("Full stage execution flow", () => {
    it("simulates complete implement stage with tracking", () => {
      telemetryLevel = TelemetryLevel.verbose;

      // Simulate dev agent tool calls
      const devEvents: ActivityEvent[] = [
        { agent: "dev", tool: "Read", detail: "src/example.ts" },
        { agent: "dev", tool: "Read", detail: "src/config.ts" },
        { agent: "dev", tool: "Edit", detail: "src/example.ts" },
        { agent: "dev", tool: "Bash", detail: "npm run build" },
      ];

      for (const event of devEvents) {
        if (event.tool) {
          tracker.track(event.agent, event.tool);

          // Standard event
          mockChesstrace.emit(Events.TOOL_INVOKE, {
            agent: event.agent,
            tool: event.tool,
            detail: event.detail,
          });

          // Verbose event (simulated input/output)
          mockChesstrace.emit(Events.TOOL_INVOKE_FULL, {
            agent: event.agent,
            tool: event.tool,
            detail: event.detail,
            input: `${event.tool} ${event.detail || ""}`.slice(0, 500),
            output: "ok".slice(0, 500),
          });
        }
      }

      // Simulate qe agent tool calls
      const qeEvents: ActivityEvent[] = [
        { agent: "qe", tool: "Write", detail: "tests/example.test.ts" },
        { agent: "qe", tool: "Bash", detail: "npm test" },
      ];

      for (const event of qeEvents) {
        if (event.tool) {
          tracker.track(event.agent, event.tool);

          mockChesstrace.emit(Events.TOOL_INVOKE, {
            agent: event.agent,
            tool: event.tool,
            detail: event.detail,
          });

          mockChesstrace.emit(Events.TOOL_INVOKE_FULL, {
            agent: event.agent,
            tool: event.tool,
            detail: event.detail,
            input: `${event.tool} ${event.detail || ""}`.slice(0, 500),
            output: "ok".slice(0, 500),
          });
        }
      }

      // Emit summary at stage end
      const summary = tracker.getSummary();
      mockChesstrace.emit(Events.TOOL_SUMMARY, {
        stage: "implement",
        ...summary,
      });

      // Verify all events emitted
      const totalEvents = (devEvents.length + qeEvents.length) * 2 + 1; // 2 events per tool + 1 summary
      expect(mockChesstrace.emit).toHaveBeenCalledTimes(totalEvents);

      // Verify summary
      const summaryCalls = (mockChesstrace.emit as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call) => call[0] === Events.TOOL_SUMMARY,
      );
      expect(summaryCalls).toHaveLength(1);
      expect(summaryCalls[0][1]).toEqual({
        stage: "implement",
        toolCounts: {
          dev: { Read: 2, Edit: 1, Bash: 1 },
          qe: { Write: 1, Bash: 1 },
        },
        totalTools: 6,
      });
    });

    it("simulates gate stage with single agent", () => {
      const gateEvents: ActivityEvent[] = [
        { agent: "gate:unit-tests", tool: "Bash", detail: "npm run test:unit" },
      ];

      for (const event of gateEvents) {
        if (event.tool) {
          tracker.track(event.agent, event.tool);

          mockChesstrace.emit(Events.TOOL_INVOKE, {
            agent: event.agent,
            tool: event.tool,
            detail: event.detail,
          });
        }
      }

      const summary = tracker.getSummary();
      mockChesstrace.emit(Events.TOOL_SUMMARY, {
        stage: "gate-unit-tests",
        ...summary,
      });

      expect(mockChesstrace.emit).toHaveBeenCalledWith(Events.TOOL_SUMMARY, {
        stage: "gate-unit-tests",
        toolCounts: {
          "gate:unit-tests": { Bash: 1 },
        },
        totalTools: 1,
      });
    });

    it("tracks multiple stages independently", () => {
      // Implement stage
      const implementEvents: ActivityEvent[] = [
        { agent: "dev", tool: "Read" },
        { agent: "dev", tool: "Edit" },
        { agent: "qe", tool: "Write" },
      ];

      for (const event of implementEvents) {
        if (event.tool) {
          tracker.track(event.agent, event.tool);
        }
      }

      let summary = tracker.getSummary();
      mockChesstrace.emit(Events.TOOL_SUMMARY, {
        stage: "implement",
        ...summary,
      });

      // Reset for gate stage
      tracker.reset();

      // Gate stage
      const gateEvents: ActivityEvent[] = [
        { agent: "gate:unit-tests", tool: "Bash" },
      ];

      for (const event of gateEvents) {
        if (event.tool) {
          tracker.track(event.agent, event.tool);
        }
      }

      summary = tracker.getSummary();
      mockChesstrace.emit(Events.TOOL_SUMMARY, {
        stage: "gate-unit-tests",
        ...summary,
      });

      // Verify both summaries emitted
      const summaryCalls = (mockChesstrace.emit as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call) => call[0] === Events.TOOL_SUMMARY,
      );
      expect(summaryCalls).toHaveLength(2);
      expect(summaryCalls[0][1]).toMatchObject({ stage: "implement", totalTools: 3 });
      expect(summaryCalls[1][1]).toMatchObject({ stage: "gate-unit-tests", totalTools: 1 });
    });
  });

  describe("Edge cases", () => {
    it("handles tool with very long detail", () => {
      const longDetail = "a".repeat(5000);
      const event: ActivityEvent = {
        agent: "dev",
        tool: "Read",
        detail: longDetail,
      };

      if (event.tool) {
        tracker.track(event.agent, event.tool);

        mockChesstrace.emit(Events.TOOL_INVOKE, {
          agent: event.agent,
          tool: event.tool,
          detail: event.detail,
        });
      }

      expect(mockChesstrace.emit).toHaveBeenCalledWith(Events.TOOL_INVOKE, {
        agent: "dev",
        tool: "Read",
        detail: longDetail,
      });
    });

    it("handles special characters in tool data", () => {
      const event: ActivityEvent = {
        agent: "dev",
        tool: "Bash",
        detail: 'git commit -m "fix: handle \\"quotes\\""',
      };

      if (event.tool) {
        tracker.track(event.agent, event.tool);

        mockChesstrace.emit(Events.TOOL_INVOKE, {
          agent: event.agent,
          tool: event.tool,
          detail: event.detail,
        });
      }

      const call = (mockChesstrace.emit as ReturnType<typeof vi.fn>).mock.calls[0];
      expect((call[1] as { detail: string }).detail).toBe('git commit -m "fix: handle \\"quotes\\""');
    });

    it("handles unicode in tool data", () => {
      const event: ActivityEvent = {
        agent: "dev",
        tool: "Read",
        detail: "测试文件.ts",
      };

      if (event.tool) {
        tracker.track(event.agent, event.tool);

        const input = "file_path: 测试文件.ts";
        const output = "内容: ...";

        mockChesstrace.emit(Events.TOOL_INVOKE_FULL, {
          agent: event.agent,
          tool: event.tool,
          detail: event.detail,
          input: truncateToolData(input, 500),
          output: truncateToolData(output, 500),
        });
      }

      const call = (mockChesstrace.emit as ReturnType<typeof vi.fn>).mock.calls[0];
      expect((call[1] as { detail: string }).detail).toBe("测试文件.ts");
    });

    it("handles exactly 500 char boundary", () => {
      const input = "x".repeat(500);
      const event: ActivityEvent = {
        agent: "dev",
        tool: "Edit",
        detail: "file.ts",
      };

      if (event.tool) {
        tracker.track(event.agent, event.tool);

        mockChesstrace.emit(Events.TOOL_INVOKE_FULL, {
          agent: event.agent,
          tool: event.tool,
          detail: event.detail,
          input: truncateToolData(input, 500),
          output: "ok",
        });
      }

      const call = (mockChesstrace.emit as ReturnType<typeof vi.fn>).mock.calls[0];
      expect((call[1] as { input: string }).input).toHaveLength(500);
    });

    it("handles rapid successive tool calls", () => {
      const events: ActivityEvent[] = Array.from({ length: 100 }, (_, i) => ({
        agent: "dev",
        tool: "Read",
        detail: `file${i}.ts`,
      }));

      for (const event of events) {
        if (event.tool) {
          tracker.track(event.agent, event.tool);

          mockChesstrace.emit(Events.TOOL_INVOKE, {
            agent: event.agent,
            tool: event.tool,
            detail: event.detail,
          });
        }
      }

      expect(mockChesstrace.emit).toHaveBeenCalledTimes(100);
      expect(tracker.counts.get("dev")?.get("Read")).toBe(100);
    });
  });
});
