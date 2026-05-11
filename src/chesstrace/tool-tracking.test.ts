import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Chesstrace, getChesstrace, resetChesstrace } from './index.js';
import { Events, TelemetryLevel } from './events.js';
import type { TelemetryEvent } from './events.js';
import type { StorageBackend } from './backends/types.js';

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

describe('Tool Tracking Telemetry', () => {
  let chesstrace: Chesstrace;
  let backend: MockBackend;

  beforeEach(async () => {
    resetChesstrace();
    backend = new MockBackend();
    chesstrace = new Chesstrace({ level: TelemetryLevel.verbose });
    await chesstrace.init(backend);
    await chesstrace.startRun();
  });

  afterEach(async () => {
    await chesstrace.close();
    resetChesstrace();
  });

  describe('TOOL_INVOKE events', () => {
    it('emits tool.invoke at standard level', async () => {
      chesstrace.emit(Events.TOOL_INVOKE, {
        agent: 'dev',
        tool: 'Read',
        detail: 'src/example.ts',
      });

      await chesstrace.flush();

      const toolEvents = backend.events.filter(e => e.event === Events.TOOL_INVOKE);
      expect(toolEvents).toHaveLength(1);
      expect(toolEvents[0].category).toBe('tool');
      expect(toolEvents[0].minLevel).toBe(TelemetryLevel.standard);
      expect(toolEvents[0].data).toEqual({
        agent: 'dev',
        tool: 'Read',
        detail: 'src/example.ts',
      });
    });

    it('filters tool.invoke when level is minimal', async () => {
      const minimalChesstrace = new Chesstrace({ level: TelemetryLevel.minimal });
      const minimalBackend = new MockBackend();
      await minimalChesstrace.init(minimalBackend);
      await minimalChesstrace.startRun();

      minimalChesstrace.emit(Events.TOOL_INVOKE, {
        agent: 'dev',
        tool: 'Read',
      });

      await minimalChesstrace.flush();
      await minimalChesstrace.close();

      const toolEvents = minimalBackend.events.filter(e => e.event === Events.TOOL_INVOKE);
      expect(toolEvents).toHaveLength(0);
    });
  });

  describe('TOOL_INVOKE_FULL events', () => {
    it('emits tool.invoke.full at verbose level', async () => {
      chesstrace.emit(Events.TOOL_INVOKE_FULL, {
        agent: 'dev',
        tool: 'Edit',
        detail: 'Modified src/example.ts with new function',
      });

      await chesstrace.flush();

      const toolEvents = backend.events.filter(e => e.event === Events.TOOL_INVOKE_FULL);
      expect(toolEvents).toHaveLength(1);
      expect(toolEvents[0].category).toBe('tool');
      expect(toolEvents[0].minLevel).toBe(TelemetryLevel.verbose);
      expect(toolEvents[0].data.agent).toBe('dev');
      expect(toolEvents[0].data.tool).toBe('Edit');
    });

    it('filters tool.invoke.full when level is standard', async () => {
      const standardChesstrace = new Chesstrace({ level: TelemetryLevel.standard });
      const standardBackend = new MockBackend();
      await standardChesstrace.init(standardBackend);
      await standardChesstrace.startRun();

      standardChesstrace.emit(Events.TOOL_INVOKE_FULL, {
        agent: 'dev',
        tool: 'Edit',
        detail: 'some detail',
      });

      await standardChesstrace.flush();
      await standardChesstrace.close();

      const toolEvents = standardBackend.events.filter(e => e.event === Events.TOOL_INVOKE_FULL);
      expect(toolEvents).toHaveLength(0);
    });

    it('handles truncated detail (500 char limit)', async () => {
      const longDetail = 'x'.repeat(600);

      chesstrace.emit(Events.TOOL_INVOKE_FULL, {
        agent: 'dev',
        tool: 'Write',
        detail: longDetail.slice(0, 500),
      });

      await chesstrace.flush();

      const toolEvents = backend.events.filter(e => e.event === Events.TOOL_INVOKE_FULL);
      expect(toolEvents).toHaveLength(1);
      const detail = toolEvents[0].data.detail as string;
      expect(detail.length).toBe(500);
    });
  });

  describe('TOOL_SUMMARY events', () => {
    it('emits tool.summary at minimal level', async () => {
      const toolCounts = {
        dev: { Read: 3, Edit: 2, Write: 1 },
        qe: { Bash: 5 },
      };

      chesstrace.emit(Events.TOOL_SUMMARY, {
        stage: 'implement',
        toolCounts,
      });

      await chesstrace.flush();

      const summaryEvents = backend.events.filter(e => e.event === Events.TOOL_SUMMARY);
      expect(summaryEvents).toHaveLength(1);
      expect(summaryEvents[0].category).toBe('tool');
      expect(summaryEvents[0].minLevel).toBe(TelemetryLevel.minimal);
      expect(summaryEvents[0].data).toEqual({
        stage: 'implement',
        toolCounts,
      });
    });

    it('emits tool.summary at all telemetry levels', async () => {
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

    it('handles empty tool counts', async () => {
      chesstrace.emit(Events.TOOL_SUMMARY, {
        stage: 'plan',
        toolCounts: {},
      });

      await chesstrace.flush();

      const summaryEvents = backend.events.filter(e => e.event === Events.TOOL_SUMMARY);
      expect(summaryEvents).toHaveLength(1);
      expect(summaryEvents[0].data.toolCounts).toEqual({});
    });
  });

  describe('Integration: Multiple tool events in sequence', () => {
    it('tracks sequence of tool invocations', async () => {
      const tools = [
        { agent: 'dev', tool: 'Read', detail: 'src/a.ts' },
        { agent: 'dev', tool: 'Edit', detail: 'src/a.ts' },
        { agent: 'qe', tool: 'Write', detail: 'tests/a.test.ts' },
      ];

      for (const t of tools) {
        chesstrace.emit(Events.TOOL_INVOKE, t);
      }

      chesstrace.emit(Events.TOOL_SUMMARY, {
        stage: 'implement',
        toolCounts: {
          dev: { Read: 1, Edit: 1 },
          qe: { Write: 1 },
        },
      });

      await chesstrace.flush();

      const invokeEvents = backend.events.filter(e => e.event === Events.TOOL_INVOKE);
      const summaryEvents = backend.events.filter(e => e.event === Events.TOOL_SUMMARY);

      expect(invokeEvents).toHaveLength(3);
      expect(summaryEvents).toHaveLength(1);
    });
  });
});
