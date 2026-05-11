import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Chesstrace, getChesstrace, resetChesstrace } from '../src/chesstrace/index.js';
import { Events, TelemetryLevel } from '../src/chesstrace/events.js';
import type { TelemetryEvent } from '../src/chesstrace/events.js';
import type { StorageBackend } from '../src/chesstrace/backends/types.js';
import type { ActivityEvent } from '../src/providers/types.js';

/**
 * Functional tests for CT-11: Tool invocation tracking via onActivity
 *
 * Coverage:
 * - onActivity callback emits tool.invoke (standard) with agent, tool, detail
 * - Verbose level emits tool.invoke.full with truncated input/output (500 chars)
 * - Stage end emits tool.summary (minimal) with aggregate counts per agent
 * - In-memory tracking during stage execution
 */

class MockBackend implements StorageBackend {
  public events: TelemetryEvent[] = [];
  public initialized = false;
  public closed = false;

  async init(): Promise<void> {
    this.initialized = true;
  }

  async write(event: TelemetryEvent): Promise<void> {
    this.events.push(event);
  }

  async writeBatch(events: TelemetryEvent[]): Promise<void> {
    this.events.push(...events);
  }

  async flush(): Promise<void> {
    // no-op for tests
  }

  async query(): Promise<TelemetryEvent[]> {
    return this.events;
  }

  async listRuns() {
    return [];
  }

  async prune(): Promise<number> {
    return 0;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

/**
 * Tool tracker simulating the one in src/commands/run.ts
 */
interface ToolTracker {
  counts: Map<string, Map<string, number>>;
  record(agent: string, tool: string): void;
  getSummary(): Record<string, Record<string, number>>;
  reset(): void;
}

function createToolTracker(): ToolTracker {
  const counts = new Map<string, Map<string, number>>();

  return {
    counts,
    record(agent: string, tool: string) {
      if (!counts.has(agent)) {
        counts.set(agent, new Map());
      }
      const agentMap = counts.get(agent)!;
      agentMap.set(tool, (agentMap.get(tool) ?? 0) + 1);
    },
    getSummary() {
      const summary: Record<string, Record<string, number>> = {};
      for (const [agent, toolMap] of counts) {
        summary[agent] = Object.fromEntries(toolMap);
      }
      return summary;
    },
    reset() {
      counts.clear();
    },
  };
}

/**
 * Simulate withActivity wrapper from src/commands/run.ts
 */
function createActivityHandler(
  chesstrace: Chesstrace | null,
  tracker: ToolTracker,
  verbose: boolean,
) {
  return (event: ActivityEvent) => {
    if (event.tool) {
      // Track count
      tracker.record(event.agent, event.tool);

      // Emit standard event
      if (chesstrace) {
        try {
          chesstrace.emit(Events.TOOL_INVOKE, {
            agent: event.agent,
            tool: event.tool,
            detail: event.detail,
          });

          // Emit verbose event if verbose enabled
          if (verbose) {
            chesstrace.emit(Events.TOOL_INVOKE_FULL, {
              agent: event.agent,
              tool: event.tool,
              detail: event.detail ? event.detail.slice(0, 500) : undefined,
            });
          }
        } catch {
          // Swallow telemetry errors
        }
      }
    }
  };
}

describe('CT-11: Tool invocation tracking via onActivity', () => {
  let chesstrace: Chesstrace;
  let backend: MockBackend;
  let tracker: ToolTracker;

  beforeEach(async () => {
    resetChesstrace();
    backend = new MockBackend();
    chesstrace = new Chesstrace({ level: TelemetryLevel.verbose });
    await chesstrace.init(backend);
    await chesstrace.startRun();
    tracker = createToolTracker();
  });

  afterEach(async () => {
    await chesstrace.close();
    resetChesstrace();
  });

  describe('Standard level: tool.invoke events', () => {
    it('emits tool.invoke with agent, tool, and detail', async () => {
      const onActivity = createActivityHandler(chesstrace, tracker, false);

      onActivity({ agent: 'dev', tool: 'Read', detail: 'src/example.ts' });

      await chesstrace.flush();

      const toolEvents = backend.events.filter(e => e.event === Events.TOOL_INVOKE);
      expect(toolEvents).toHaveLength(1);
      expect(toolEvents[0].data).toEqual({
        agent: 'dev',
        tool: 'Read',
        detail: 'src/example.ts',
      });
      expect(toolEvents[0].minLevel).toBe(TelemetryLevel.standard);
    });

    it('emits tool.invoke for each tool call', async () => {
      const onActivity = createActivityHandler(chesstrace, tracker, false);

      const calls = [
        { agent: 'dev', tool: 'Read', detail: 'file1.ts' },
        { agent: 'dev', tool: 'Edit', detail: 'file1.ts' },
        { agent: 'dev', tool: 'Bash', detail: 'npm test' },
      ];

      for (const call of calls) {
        onActivity(call);
      }

      await chesstrace.flush();

      const toolEvents = backend.events.filter(e => e.event === Events.TOOL_INVOKE);
      expect(toolEvents).toHaveLength(3);
    });

    it('handles missing detail field', async () => {
      const onActivity = createActivityHandler(chesstrace, tracker, false);

      onActivity({ agent: 'dev', tool: 'Glob' });

      await chesstrace.flush();

      const toolEvents = backend.events.filter(e => e.event === Events.TOOL_INVOKE);
      expect(toolEvents).toHaveLength(1);
      expect(toolEvents[0].data).toEqual({
        agent: 'dev',
        tool: 'Glob',
        detail: undefined,
      });
    });

    it('skips events without tool field', async () => {
      const onActivity = createActivityHandler(chesstrace, tracker, false);

      onActivity({ agent: 'dev' });

      await chesstrace.flush();

      const toolEvents = backend.events.filter(e => e.event === Events.TOOL_INVOKE);
      expect(toolEvents).toHaveLength(0);
    });

    it('filtered out at minimal telemetry level', async () => {
      const minimalChesstrace = new Chesstrace({ level: TelemetryLevel.minimal });
      const minimalBackend = new MockBackend();
      await minimalChesstrace.init(minimalBackend);
      await minimalChesstrace.startRun();

      const onActivity = createActivityHandler(minimalChesstrace, tracker, false);
      onActivity({ agent: 'dev', tool: 'Read', detail: 'file.ts' });

      await minimalChesstrace.flush();
      await minimalChesstrace.close();

      const toolEvents = minimalBackend.events.filter(e => e.event === Events.TOOL_INVOKE);
      expect(toolEvents).toHaveLength(0);
    });
  });

  describe('Verbose level: tool.invoke.full events', () => {
    it('emits tool.invoke.full with truncated detail', async () => {
      const onActivity = createActivityHandler(chesstrace, tracker, true);

      onActivity({ agent: 'dev', tool: 'Edit', detail: 'Modified src/file.ts' });

      await chesstrace.flush();

      const fullEvents = backend.events.filter(e => e.event === Events.TOOL_INVOKE_FULL);
      expect(fullEvents).toHaveLength(1);
      expect(fullEvents[0].data).toEqual({
        agent: 'dev',
        tool: 'Edit',
        detail: 'Modified src/file.ts',
      });
      expect(fullEvents[0].minLevel).toBe(TelemetryLevel.verbose);
    });

    it('truncates detail to 500 chars', async () => {
      const onActivity = createActivityHandler(chesstrace, tracker, true);
      const longDetail = 'x'.repeat(1000);

      onActivity({ agent: 'dev', tool: 'Write', detail: longDetail });

      await chesstrace.flush();

      const fullEvents = backend.events.filter(e => e.event === Events.TOOL_INVOKE_FULL);
      expect(fullEvents).toHaveLength(1);
      const detail = fullEvents[0].data.detail as string;
      expect(detail).toHaveLength(500);
    });

    it('preserves detail under 500 chars', async () => {
      const onActivity = createActivityHandler(chesstrace, tracker, true);
      const shortDetail = 'src/example.ts:42';

      onActivity({ agent: 'dev', tool: 'Read', detail: shortDetail });

      await chesstrace.flush();

      const fullEvents = backend.events.filter(e => e.event === Events.TOOL_INVOKE_FULL);
      expect(fullEvents).toHaveLength(1);
      expect(fullEvents[0].data.detail).toBe(shortDetail);
    });

    it('emits both tool.invoke and tool.invoke.full when verbose', async () => {
      const onActivity = createActivityHandler(chesstrace, tracker, true);

      onActivity({ agent: 'dev', tool: 'Read', detail: 'file.ts' });

      await chesstrace.flush();

      const standardEvents = backend.events.filter(e => e.event === Events.TOOL_INVOKE);
      const verboseEvents = backend.events.filter(e => e.event === Events.TOOL_INVOKE_FULL);

      expect(standardEvents).toHaveLength(1);
      expect(verboseEvents).toHaveLength(1);
    });

    it('filtered out at standard telemetry level', async () => {
      const standardChesstrace = new Chesstrace({ level: TelemetryLevel.standard });
      const standardBackend = new MockBackend();
      await standardChesstrace.init(standardBackend);
      await standardChesstrace.startRun();

      const onActivity = createActivityHandler(standardChesstrace, tracker, true);
      onActivity({ agent: 'dev', tool: 'Edit', detail: 'file.ts' });

      await standardChesstrace.flush();
      await standardChesstrace.close();

      const fullEvents = standardBackend.events.filter(e => e.event === Events.TOOL_INVOKE_FULL);
      expect(fullEvents).toHaveLength(0);
    });
  });

  describe('In-memory tool count tracking', () => {
    it('records each tool invocation', () => {
      const onActivity = createActivityHandler(chesstrace, tracker, false);

      onActivity({ agent: 'dev', tool: 'Read', detail: 'file.ts' });

      expect(tracker.counts.get('dev')?.get('Read')).toBe(1);
    });

    it('increments count for repeated tool calls', () => {
      const onActivity = createActivityHandler(chesstrace, tracker, false);

      onActivity({ agent: 'dev', tool: 'Read', detail: 'file1.ts' });
      onActivity({ agent: 'dev', tool: 'Read', detail: 'file2.ts' });
      onActivity({ agent: 'dev', tool: 'Read', detail: 'file3.ts' });

      expect(tracker.counts.get('dev')?.get('Read')).toBe(3);
    });

    it('tracks multiple tools per agent', () => {
      const onActivity = createActivityHandler(chesstrace, tracker, false);

      onActivity({ agent: 'dev', tool: 'Read', detail: 'file.ts' });
      onActivity({ agent: 'dev', tool: 'Edit', detail: 'file.ts' });
      onActivity({ agent: 'dev', tool: 'Bash', detail: 'npm test' });

      const devCounts = tracker.counts.get('dev')!;
      expect(devCounts.get('Read')).toBe(1);
      expect(devCounts.get('Edit')).toBe(1);
      expect(devCounts.get('Bash')).toBe(1);
    });

    it('tracks multiple agents separately', () => {
      const onActivity = createActivityHandler(chesstrace, tracker, false);

      onActivity({ agent: 'dev', tool: 'Read', detail: 'src.ts' });
      onActivity({ agent: 'qe', tool: 'Write', detail: 'test.ts' });
      onActivity({ agent: 'dev', tool: 'Read', detail: 'src2.ts' });

      expect(tracker.counts.get('dev')?.get('Read')).toBe(2);
      expect(tracker.counts.get('qe')?.get('Write')).toBe(1);
    });

    it('converts to summary format', () => {
      const onActivity = createActivityHandler(chesstrace, tracker, false);

      onActivity({ agent: 'dev', tool: 'Read', detail: 'f1.ts' });
      onActivity({ agent: 'dev', tool: 'Read', detail: 'f2.ts' });
      onActivity({ agent: 'dev', tool: 'Edit', detail: 'f1.ts' });
      onActivity({ agent: 'qe', tool: 'Write', detail: 'test.ts' });

      const summary = tracker.getSummary();

      expect(summary).toEqual({
        dev: { Read: 2, Edit: 1 },
        qe: { Write: 1 },
      });
    });

    it('resets between stages', () => {
      const onActivity = createActivityHandler(chesstrace, tracker, false);

      // Stage 1
      onActivity({ agent: 'dev', tool: 'Read', detail: 'file.ts' });
      expect(tracker.counts.size).toBe(1);

      // Reset
      tracker.reset();
      expect(tracker.counts.size).toBe(0);

      // Stage 2
      onActivity({ agent: 'qe', tool: 'Write', detail: 'test.ts' });
      expect(tracker.counts.size).toBe(1);
      expect(tracker.counts.get('dev')).toBeUndefined();
    });
  });

  describe('Minimal level: tool.summary at stage end', () => {
    it('emits tool.summary with aggregate counts', async () => {
      const onActivity = createActivityHandler(chesstrace, tracker, false);

      onActivity({ agent: 'dev', tool: 'Read', detail: 'f1.ts' });
      onActivity({ agent: 'dev', tool: 'Edit', detail: 'f1.ts' });
      onActivity({ agent: 'qe', tool: 'Write', detail: 'test.ts' });

      const summary = tracker.getSummary();
      chesstrace.emit(Events.TOOL_SUMMARY, {
        stage: 'implement',
        toolCounts: summary,
      });

      await chesstrace.flush();

      const summaryEvents = backend.events.filter(e => e.event === Events.TOOL_SUMMARY);
      expect(summaryEvents).toHaveLength(1);
      expect(summaryEvents[0].data).toEqual({
        stage: 'implement',
        toolCounts: {
          dev: { Read: 1, Edit: 1 },
          qe: { Write: 1 },
        },
      });
      expect(summaryEvents[0].minLevel).toBe(TelemetryLevel.minimal);
    });

    it('includes stage name in summary', async () => {
      const onActivity = createActivityHandler(chesstrace, tracker, false);

      onActivity({ agent: 'gate:unit-tests', tool: 'Bash', detail: 'npm test' });

      const summary = tracker.getSummary();
      chesstrace.emit(Events.TOOL_SUMMARY, {
        stage: 'gate-unit-tests',
        toolCounts: summary,
      });

      await chesstrace.flush();

      const summaryEvents = backend.events.filter(e => e.event === Events.TOOL_SUMMARY);
      expect(summaryEvents[0].data.stage).toBe('gate-unit-tests');
    });

    it('handles empty tool counts', async () => {
      const summary = tracker.getSummary();

      chesstrace.emit(Events.TOOL_SUMMARY, {
        stage: 'implement',
        toolCounts: summary,
      });

      await chesstrace.flush();

      const summaryEvents = backend.events.filter(e => e.event === Events.TOOL_SUMMARY);
      expect(summaryEvents).toHaveLength(1);
      expect(summaryEvents[0].data.toolCounts).toEqual({});
    });

    it('emitted at all telemetry levels', async () => {
      const levels = [TelemetryLevel.minimal, TelemetryLevel.standard, TelemetryLevel.verbose];

      for (const level of levels) {
        const testChesstrace = new Chesstrace({ level });
        const testBackend = new MockBackend();
        await testChesstrace.init(testBackend);
        await testChesstrace.startRun();

        testChesstrace.emit(Events.TOOL_SUMMARY, {
          stage: 'plan',
          toolCounts: { planner: { Read: 1 } },
        });

        await testChesstrace.flush();
        await testChesstrace.close();

        const summaryEvents = testBackend.events.filter(e => e.event === Events.TOOL_SUMMARY);
        expect(summaryEvents).toHaveLength(1);
      }
    });
  });

  describe('Full stage execution flow', () => {
    it('simulates implement stage with dev and qe agents', async () => {
      const onActivity = createActivityHandler(chesstrace, tracker, true);

      // Dev agent
      onActivity({ agent: 'dev', tool: 'Read', detail: 'src/example.ts' });
      onActivity({ agent: 'dev', tool: 'Read', detail: 'src/config.ts' });
      onActivity({ agent: 'dev', tool: 'Edit', detail: 'src/example.ts' });
      onActivity({ agent: 'dev', tool: 'Bash', detail: 'npm run build' });

      // QE agent
      onActivity({ agent: 'qe', tool: 'Write', detail: 'tests/example.test.ts' });
      onActivity({ agent: 'qe', tool: 'Bash', detail: 'npm test' });

      // Stage end: emit summary
      const summary = tracker.getSummary();
      chesstrace.emit(Events.TOOL_SUMMARY, {
        stage: 'implement',
        toolCounts: summary,
      });

      await chesstrace.flush();

      // Verify tool.invoke events
      const invokeEvents = backend.events.filter(e => e.event === Events.TOOL_INVOKE);
      expect(invokeEvents).toHaveLength(6);

      // Verify tool.invoke.full events (verbose mode)
      const fullEvents = backend.events.filter(e => e.event === Events.TOOL_INVOKE_FULL);
      expect(fullEvents).toHaveLength(6);

      // Verify tool.summary event
      const summaryEvents = backend.events.filter(e => e.event === Events.TOOL_SUMMARY);
      expect(summaryEvents).toHaveLength(1);
      expect(summaryEvents[0].data).toEqual({
        stage: 'implement',
        toolCounts: {
          dev: { Read: 2, Edit: 1, Bash: 1 },
          qe: { Write: 1, Bash: 1 },
        },
      });
    });

    it('simulates gate stage with single agent', async () => {
      const onActivity = createActivityHandler(chesstrace, tracker, false);

      onActivity({ agent: 'gate:unit-tests', tool: 'Bash', detail: 'npm run test:unit' });

      const summary = tracker.getSummary();
      chesstrace.emit(Events.TOOL_SUMMARY, {
        stage: 'gate-unit-tests',
        toolCounts: summary,
      });

      await chesstrace.flush();

      const summaryEvents = backend.events.filter(e => e.event === Events.TOOL_SUMMARY);
      expect(summaryEvents[0].data).toEqual({
        stage: 'gate-unit-tests',
        toolCounts: {
          'gate:unit-tests': { Bash: 1 },
        },
      });
    });

    it('tracks multiple stages independently', async () => {
      const onActivity = createActivityHandler(chesstrace, tracker, false);

      // Implement stage
      onActivity({ agent: 'dev', tool: 'Read' });
      onActivity({ agent: 'dev', tool: 'Edit' });

      let summary = tracker.getSummary();
      chesstrace.emit(Events.TOOL_SUMMARY, {
        stage: 'implement',
        toolCounts: summary,
      });

      // Reset for next stage
      tracker.reset();

      // Gate stage
      onActivity({ agent: 'gate:unit-tests', tool: 'Bash' });

      summary = tracker.getSummary();
      chesstrace.emit(Events.TOOL_SUMMARY, {
        stage: 'gate-unit-tests',
        toolCounts: summary,
      });

      await chesstrace.flush();

      const summaryEvents = backend.events.filter(e => e.event === Events.TOOL_SUMMARY);
      expect(summaryEvents).toHaveLength(2);
      expect(summaryEvents[0].data.stage).toBe('implement');
      expect(summaryEvents[1].data.stage).toBe('gate-unit-tests');
    });
  });

  describe('Edge cases', () => {
    it('handles very long detail strings', async () => {
      const onActivity = createActivityHandler(chesstrace, tracker, false);
      const longDetail = 'a'.repeat(5000);

      onActivity({ agent: 'dev', tool: 'Read', detail: longDetail });

      await chesstrace.flush();

      const toolEvents = backend.events.filter(e => e.event === Events.TOOL_INVOKE);
      expect(toolEvents).toHaveLength(1);
      expect(toolEvents[0].data.detail).toBe(longDetail);
    });

    it('handles special characters in detail', async () => {
      const onActivity = createActivityHandler(chesstrace, tracker, false);

      onActivity({
        agent: 'dev',
        tool: 'Bash',
        detail: 'git commit -m "fix: handle \\"quotes\\""',
      });

      await chesstrace.flush();

      const toolEvents = backend.events.filter(e => e.event === Events.TOOL_INVOKE);
      expect(toolEvents[0].data.detail).toBe('git commit -m "fix: handle \\"quotes\\""');
    });

    it('handles unicode in detail', async () => {
      const onActivity = createActivityHandler(chesstrace, tracker, false);

      onActivity({ agent: 'dev', tool: 'Read', detail: '测试文件.ts' });

      await chesstrace.flush();

      const toolEvents = backend.events.filter(e => e.event === Events.TOOL_INVOKE);
      expect(toolEvents[0].data.detail).toBe('测试文件.ts');
    });

    it('handles exactly 500 char boundary', async () => {
      const onActivity = createActivityHandler(chesstrace, tracker, true);
      const exactDetail = 'x'.repeat(500);

      onActivity({ agent: 'dev', tool: 'Edit', detail: exactDetail });

      await chesstrace.flush();

      const fullEvents = backend.events.filter(e => e.event === Events.TOOL_INVOKE_FULL);
      expect((fullEvents[0].data.detail as string).length).toBe(500);
    });

    it('handles rapid successive tool calls', async () => {
      const onActivity = createActivityHandler(chesstrace, tracker, false);

      for (let i = 0; i < 100; i++) {
        onActivity({ agent: 'dev', tool: 'Read', detail: `file${i}.ts` });
      }

      await chesstrace.flush();

      const toolEvents = backend.events.filter(e => e.event === Events.TOOL_INVOKE);
      expect(toolEvents).toHaveLength(100);
      expect(tracker.counts.get('dev')?.get('Read')).toBe(100);
    });

    it('handles tool invocations without telemetry enabled', () => {
      const onActivity = createActivityHandler(null, tracker, false);

      onActivity({ agent: 'dev', tool: 'Read', detail: 'file.ts' });

      // Should still track counts even without telemetry
      expect(tracker.counts.get('dev')?.get('Read')).toBe(1);
    });

    it('swallows telemetry emit errors', async () => {
      const faultyBackend = new MockBackend();
      faultyBackend.write = vi.fn().mockRejectedValue(new Error('Backend failure'));

      const faultyChesstrace = new Chesstrace({ level: TelemetryLevel.standard });
      await faultyChesstrace.init(faultyBackend);
      await faultyChesstrace.startRun();

      const onActivity = createActivityHandler(faultyChesstrace, tracker, false);

      // Should not throw
      expect(() => {
        onActivity({ agent: 'dev', tool: 'Read', detail: 'file.ts' });
      }).not.toThrow();

      // Tracking should still work
      expect(tracker.counts.get('dev')?.get('Read')).toBe(1);

      await faultyChesstrace.close();
    });
  });

  describe('Acceptance criteria validation', () => {
    it('requirement: emits tool.invoke at standard level with agent, tool, detail', async () => {
      const onActivity = createActivityHandler(chesstrace, tracker, false);

      onActivity({ agent: 'dev', tool: 'Read', detail: 'src/file.ts' });

      await chesstrace.flush();

      const events = backend.events.filter(e => e.event === Events.TOOL_INVOKE);
      expect(events).toHaveLength(1);
      expect(events[0].minLevel).toBe(TelemetryLevel.standard);
      expect(events[0].data.agent).toBe('dev');
      expect(events[0].data.tool).toBe('Read');
      expect(events[0].data.detail).toBe('src/file.ts');
    });

    it('requirement: emits tool.invoke.full at verbose level with truncated detail', async () => {
      const onActivity = createActivityHandler(chesstrace, tracker, true);
      const longDetail = 'x'.repeat(1000);

      onActivity({ agent: 'dev', tool: 'Edit', detail: longDetail });

      await chesstrace.flush();

      const events = backend.events.filter(e => e.event === Events.TOOL_INVOKE_FULL);
      expect(events).toHaveLength(1);
      expect(events[0].minLevel).toBe(TelemetryLevel.verbose);
      expect((events[0].data.detail as string).length).toBe(500);
    });

    it('requirement: emits tool.summary at stage end with aggregate counts', async () => {
      const onActivity = createActivityHandler(chesstrace, tracker, false);

      onActivity({ agent: 'dev', tool: 'Read' });
      onActivity({ agent: 'dev', tool: 'Edit' });
      onActivity({ agent: 'qe', tool: 'Write' });

      const summary = tracker.getSummary();
      chesstrace.emit(Events.TOOL_SUMMARY, {
        stage: 'implement',
        toolCounts: summary,
      });

      await chesstrace.flush();

      const events = backend.events.filter(e => e.event === Events.TOOL_SUMMARY);
      expect(events).toHaveLength(1);
      expect(events[0].minLevel).toBe(TelemetryLevel.minimal);
      expect(events[0].data.toolCounts).toEqual({
        dev: { Read: 1, Edit: 1 },
        qe: { Write: 1 },
      });
    });

    it('requirement: tracks tool counts in-memory during stage execution', () => {
      const onActivity = createActivityHandler(chesstrace, tracker, false);

      onActivity({ agent: 'dev', tool: 'Read' });
      onActivity({ agent: 'dev', tool: 'Read' });
      onActivity({ agent: 'dev', tool: 'Edit' });

      expect(tracker.counts.get('dev')?.get('Read')).toBe(2);
      expect(tracker.counts.get('dev')?.get('Edit')).toBe(1);
    });
  });
});
