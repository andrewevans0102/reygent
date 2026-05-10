import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Chesstrace, getChesstrace, resetChesstrace } from './index.js';
import { TelemetryLevel, Events } from './events.js';
import type { StorageBackend, EventFilter, RunSummary } from './backends/types.js';
import type { TelemetryEvent } from './events.js';

// Mock storage backend
class MockBackend implements StorageBackend {
  public initCalled = false;
  public writeCalls: TelemetryEvent[] = [];
  public writeBatchCalls: TelemetryEvent[][] = [];
  public flushCalls = 0;
  public closeCalls = 0;
  public queryCalls: EventFilter[] = [];
  public listRunsCalls = 0;
  public pruneCalls: number[] = [];
  public shouldThrow = false;
  public queryResults: TelemetryEvent[] = [];
  public runsResults: RunSummary[] = [];
  public pruneResult = 0;

  async init(): Promise<void> {
    this.initCalled = true;
  }

  async write(event: TelemetryEvent): Promise<void> {
    if (this.shouldThrow) throw new Error('Mock write error');
    this.writeCalls.push(event);
  }

  async writeBatch(events: TelemetryEvent[]): Promise<void> {
    if (this.shouldThrow) throw new Error('Mock writeBatch error');
    this.writeBatchCalls.push(events);
  }

  async query(filter: EventFilter): Promise<TelemetryEvent[]> {
    this.queryCalls.push(filter);
    return this.queryResults;
  }

  async listRuns(): Promise<RunSummary[]> {
    this.listRunsCalls++;
    return this.runsResults;
  }

  async flush(): Promise<void> {
    this.flushCalls++;
  }

  async prune(olderThan: number): Promise<number> {
    this.pruneCalls.push(olderThan);
    return this.pruneResult;
  }

  async close(): Promise<void> {
    this.closeCalls++;
  }
}

describe('Chesstrace', () => {
  let backend: MockBackend;

  beforeEach(() => {
    backend = new MockBackend();
    resetChesstrace();
  });

  describe('constructor', () => {
    it('accepts TelemetryConfig', () => {
      const chesstrace = new Chesstrace({ level: TelemetryLevel.minimal });
      expect(chesstrace).toBeDefined();
    });

    it('accepts verbose level', () => {
      const chesstrace = new Chesstrace({ level: TelemetryLevel.verbose });
      expect(chesstrace).toBeDefined();
    });

    it('accepts standard level', () => {
      const chesstrace = new Chesstrace({ level: TelemetryLevel.standard });
      expect(chesstrace).toBeDefined();
    });
  });

  describe('init', () => {
    it('initializes backend', async () => {
      const chesstrace = new Chesstrace({ level: TelemetryLevel.minimal });
      await chesstrace.init(backend);
      expect(backend.initCalled).toBe(true);
    });

    it('processes buffered events after init', async () => {
      const chesstrace = new Chesstrace({ level: TelemetryLevel.minimal });

      // Emit before init
      chesstrace.emit(Events.COMMAND_START, { cmd: 'test' });
      expect(backend.writeBatchCalls.length).toBe(0);

      // Init should flush buffer
      await chesstrace.init(backend);
      expect(backend.writeBatchCalls.length).toBe(1);
      expect(backend.writeBatchCalls[0].length).toBe(1);
      expect(backend.writeBatchCalls[0][0].event).toBe(Events.COMMAND_START);
    });

    it('handles multiple buffered events', async () => {
      const chesstrace = new Chesstrace({ level: TelemetryLevel.minimal });

      chesstrace.emit(Events.COMMAND_START, { cmd: 'test1' });
      chesstrace.emit(Events.COMMAND_END, { cmd: 'test1' });
      chesstrace.emit(Events.ERROR_UNHANDLED, { err: 'oops' });

      await chesstrace.init(backend);
      expect(backend.writeBatchCalls.length).toBe(1);
      expect(backend.writeBatchCalls[0].length).toBe(3);
    });

    it('only calls backend.init once', async () => {
      const chesstrace = new Chesstrace({ level: TelemetryLevel.minimal });
      await chesstrace.init(backend);
      await chesstrace.init(backend);
      expect(backend.initCalled).toBe(true);
    });
  });

  describe('startRun', () => {
    it('generates UUID v4 runId', async () => {
      const chesstrace = new Chesstrace({ level: TelemetryLevel.minimal });
      await chesstrace.init(backend);
      const runId = await chesstrace.startRun();

      // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
      expect(runId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it('stores runId', async () => {
      const chesstrace = new Chesstrace({ level: TelemetryLevel.minimal });
      await chesstrace.init(backend);
      const runId = await chesstrace.startRun();

      // Emit event to verify runId is used
      chesstrace.emit(Events.COMMAND_START, { cmd: 'test' });
      await chesstrace.flush();

      expect(backend.writeBatchCalls[0][0].runId).toBe(runId);
    });

    it('generates different runIds on subsequent calls', async () => {
      const chesstrace = new Chesstrace({ level: TelemetryLevel.minimal });
      await chesstrace.init(backend);
      const runId1 = await chesstrace.startRun();
      const runId2 = await chesstrace.startRun();

      expect(runId1).not.toBe(runId2);
    });
  });

  describe('emit', () => {
    it('constructs TelemetryEvent', async () => {
      const chesstrace = new Chesstrace({ level: TelemetryLevel.minimal });
      await chesstrace.init(backend);
      await chesstrace.startRun();

      chesstrace.emit(Events.COMMAND_START, { cmd: 'test' });
      await chesstrace.flush();

      const event = backend.writeBatchCalls[0][0];
      expect(event).toHaveProperty('id');
      expect(event).toHaveProperty('runId');
      expect(event).toHaveProperty('timestamp');
      expect(event.category).toBe('command');
      expect(event.event).toBe(Events.COMMAND_START);
      expect(event.minLevel).toBe(TelemetryLevel.minimal);
      expect(event.data).toEqual({ cmd: 'test' });
    });

    it('filters by level - minimal blocks standard', async () => {
      const chesstrace = new Chesstrace({ level: TelemetryLevel.minimal });
      await chesstrace.init(backend);
      await chesstrace.startRun();

      chesstrace.emit(Events.AGENT_START, { agent: 'test' }); // standard level
      await chesstrace.flush();

      expect(backend.writeBatchCalls.length).toBe(0);
    });

    it('filters by level - minimal blocks verbose', async () => {
      const chesstrace = new Chesstrace({ level: TelemetryLevel.minimal });
      await chesstrace.init(backend);
      await chesstrace.startRun();

      chesstrace.emit(Events.LLM_REQUEST, { model: 'gpt' }); // verbose level
      await chesstrace.flush();

      expect(backend.writeBatchCalls.length).toBe(0);
    });

    it('filters by level - minimal allows minimal', async () => {
      const chesstrace = new Chesstrace({ level: TelemetryLevel.minimal });
      await chesstrace.init(backend);
      await chesstrace.startRun();

      chesstrace.emit(Events.COMMAND_START, { cmd: 'test' }); // minimal level
      await chesstrace.flush();

      expect(backend.writeBatchCalls.length).toBe(1);
    });

    it('filters by level - standard allows minimal and standard', async () => {
      const chesstrace = new Chesstrace({ level: TelemetryLevel.standard });
      await chesstrace.init(backend);
      await chesstrace.startRun();

      chesstrace.emit(Events.COMMAND_START, { cmd: 'test' }); // minimal
      chesstrace.emit(Events.AGENT_START, { agent: 'test' }); // standard
      await chesstrace.flush();

      expect(backend.writeBatchCalls[0].length).toBe(2);
    });

    it('filters by level - standard blocks verbose', async () => {
      const chesstrace = new Chesstrace({ level: TelemetryLevel.standard });
      await chesstrace.init(backend);
      await chesstrace.startRun();

      chesstrace.emit(Events.LLM_REQUEST, { model: 'gpt' }); // verbose
      await chesstrace.flush();

      expect(backend.writeBatchCalls.length).toBe(0);
    });

    it('filters by level - verbose allows all', async () => {
      const chesstrace = new Chesstrace({ level: TelemetryLevel.verbose });
      await chesstrace.init(backend);
      await chesstrace.startRun();

      chesstrace.emit(Events.COMMAND_START, { cmd: 'test' }); // minimal
      chesstrace.emit(Events.AGENT_START, { agent: 'test' }); // standard
      chesstrace.emit(Events.LLM_REQUEST, { model: 'gpt' }); // verbose
      await chesstrace.flush();

      expect(backend.writeBatchCalls[0].length).toBe(3);
    });

    it('buffers events before init', async () => {
      const chesstrace = new Chesstrace({ level: TelemetryLevel.minimal });

      chesstrace.emit(Events.COMMAND_START, { cmd: 'test' });
      expect(backend.writeCalls.length).toBe(0);

      await chesstrace.init(backend);
      expect(backend.writeBatchCalls.length).toBe(1);
    });

    it('writes to backend after init', async () => {
      const chesstrace = new Chesstrace({ level: TelemetryLevel.minimal });
      await chesstrace.init(backend);
      await chesstrace.startRun();

      chesstrace.emit(Events.COMMAND_START, { cmd: 'test' });
      await chesstrace.flush();

      expect(backend.writeBatchCalls.length).toBe(1);
    });

    it('catches and swallows write errors', async () => {
      const chesstrace = new Chesstrace({ level: TelemetryLevel.minimal });
      await chesstrace.init(backend);
      await chesstrace.startRun();

      backend.shouldThrow = true;

      // Should not throw
      expect(() => {
        chesstrace.emit(Events.COMMAND_START, { cmd: 'test' });
      }).not.toThrow();
    });

    it('generates unique event IDs', async () => {
      const chesstrace = new Chesstrace({ level: TelemetryLevel.minimal });
      await chesstrace.init(backend);
      await chesstrace.startRun();

      chesstrace.emit(Events.COMMAND_START, { cmd: 'test1' });
      chesstrace.emit(Events.COMMAND_START, { cmd: 'test2' });
      await chesstrace.flush();

      const ids = backend.writeBatchCalls[0].map((e) => e.id);
      expect(new Set(ids).size).toBe(2);
    });

    it('sets timestamp', async () => {
      const chesstrace = new Chesstrace({ level: TelemetryLevel.minimal });
      await chesstrace.init(backend);
      await chesstrace.startRun();

      const before = Date.now();
      chesstrace.emit(Events.COMMAND_START, { cmd: 'test' });
      const after = Date.now();
      await chesstrace.flush();

      const event = backend.writeBatchCalls[0][0];
      expect(event.timestamp).toBeGreaterThanOrEqual(before);
      expect(event.timestamp).toBeLessThanOrEqual(after);
    });

    it('extracts category from event name', async () => {
      const chesstrace = new Chesstrace({ level: TelemetryLevel.verbose });
      await chesstrace.init(backend);
      await chesstrace.startRun();

      chesstrace.emit(Events.COMMAND_START, {});
      chesstrace.emit(Events.AGENT_START, {});
      chesstrace.emit(Events.LLM_REQUEST, {});
      chesstrace.emit(Events.GIT_COMMIT, {});
      await chesstrace.flush();

      const categories = backend.writeBatchCalls[0].map((e) => e.category);
      expect(categories).toEqual(['command', 'agent', 'llm', 'git']);
    });

    it('preserves data object', async () => {
      const chesstrace = new Chesstrace({ level: TelemetryLevel.minimal });
      await chesstrace.init(backend);
      await chesstrace.startRun();

      const data = { cmd: 'test', args: [1, 2, 3], nested: { key: 'value' } };
      chesstrace.emit(Events.COMMAND_START, data);
      await chesstrace.flush();

      expect(backend.writeBatchCalls[0][0].data).toEqual(data);
    });
  });

  describe('flush', () => {
    it('delegates to backend', async () => {
      const chesstrace = new Chesstrace({ level: TelemetryLevel.minimal });
      await chesstrace.init(backend);

      await chesstrace.flush();
      expect(backend.flushCalls).toBe(1);
    });

    it('flushes buffered events', async () => {
      const chesstrace = new Chesstrace({ level: TelemetryLevel.minimal });
      await chesstrace.init(backend);
      await chesstrace.startRun();

      chesstrace.emit(Events.COMMAND_START, { cmd: 'test' });
      expect(backend.writeBatchCalls.length).toBe(0);

      await chesstrace.flush();
      expect(backend.writeBatchCalls.length).toBe(1);
    });

    it('can be called multiple times', async () => {
      const chesstrace = new Chesstrace({ level: TelemetryLevel.minimal });
      await chesstrace.init(backend);

      await chesstrace.flush();
      await chesstrace.flush();
      expect(backend.flushCalls).toBe(2);
    });

    it('handles empty buffer', async () => {
      const chesstrace = new Chesstrace({ level: TelemetryLevel.minimal });
      await chesstrace.init(backend);

      await chesstrace.flush();
      expect(backend.writeBatchCalls.length).toBe(0);
    });
  });

  describe('query', () => {
    it('delegates to backend', async () => {
      const chesstrace = new Chesstrace({ level: TelemetryLevel.minimal });
      await chesstrace.init(backend);

      const filter = { runId: 'test-run' };
      await chesstrace.query(filter);

      expect(backend.queryCalls.length).toBe(1);
      expect(backend.queryCalls[0]).toEqual(filter);
    });

    it('returns backend results', async () => {
      const chesstrace = new Chesstrace({ level: TelemetryLevel.minimal });
      await chesstrace.init(backend);

      const mockEvent: TelemetryEvent = {
        id: 'evt1',
        runId: 'run1',
        timestamp: Date.now(),
        category: 'command',
        event: Events.COMMAND_START,
        minLevel: TelemetryLevel.minimal,
        data: {},
      };
      backend.queryResults = [mockEvent];

      const results = await chesstrace.query({});
      expect(results).toEqual([mockEvent]);
    });

    it('passes all filter fields', async () => {
      const chesstrace = new Chesstrace({ level: TelemetryLevel.minimal });
      await chesstrace.init(backend);

      const filter: EventFilter = {
        runId: 'run1',
        category: 'command',
        event: Events.COMMAND_START,
        minLevel: TelemetryLevel.minimal,
        startTime: 1000,
        endTime: 2000,
      };

      await chesstrace.query(filter);
      expect(backend.queryCalls[0]).toEqual(filter);
    });
  });

  describe('listRuns', () => {
    it('delegates to backend', async () => {
      const chesstrace = new Chesstrace({ level: TelemetryLevel.minimal });
      await chesstrace.init(backend);

      await chesstrace.listRuns();
      expect(backend.listRunsCalls).toBe(1);
    });

    it('returns backend results', async () => {
      const chesstrace = new Chesstrace({ level: TelemetryLevel.minimal });
      await chesstrace.init(backend);

      const mockSummary: RunSummary = {
        runId: 'run1',
        startTime: 1000,
        endTime: 2000,
        eventCount: 5,
        categories: ['command', 'agent'],
      };
      backend.runsResults = [mockSummary];

      const results = await chesstrace.listRuns();
      expect(results).toEqual([mockSummary]);
    });

    it('handles empty results', async () => {
      const chesstrace = new Chesstrace({ level: TelemetryLevel.minimal });
      await chesstrace.init(backend);

      const results = await chesstrace.listRuns();
      expect(results).toEqual([]);
    });
  });

  describe('prune', () => {
    it('delegates to backend', async () => {
      const chesstrace = new Chesstrace({ level: TelemetryLevel.minimal });
      await chesstrace.init(backend);

      const days = 30;
      await chesstrace.prune(days);

      expect(backend.pruneCalls.length).toBe(1);
    });

    it('converts days to timestamp', async () => {
      const chesstrace = new Chesstrace({ level: TelemetryLevel.minimal });
      await chesstrace.init(backend);

      const days = 30;
      const before = Date.now() - days * 24 * 60 * 60 * 1000;
      await chesstrace.prune(days);
      const after = Date.now() - days * 24 * 60 * 60 * 1000;

      const timestamp = backend.pruneCalls[0];
      expect(timestamp).toBeGreaterThanOrEqual(before);
      expect(timestamp).toBeLessThanOrEqual(after);
    });

    it('returns delete count', async () => {
      const chesstrace = new Chesstrace({ level: TelemetryLevel.minimal });
      await chesstrace.init(backend);

      backend.pruneResult = 42;
      const count = await chesstrace.prune(30);
      expect(count).toBe(42);
    });

    it('handles zero days', async () => {
      const chesstrace = new Chesstrace({ level: TelemetryLevel.minimal });
      await chesstrace.init(backend);

      await chesstrace.prune(0);
      const timestamp = backend.pruneCalls[0];
      expect(timestamp).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('close', () => {
    it('flushes before closing', async () => {
      const chesstrace = new Chesstrace({ level: TelemetryLevel.minimal });
      await chesstrace.init(backend);

      await chesstrace.close();
      expect(backend.flushCalls).toBe(1);
      expect(backend.closeCalls).toBe(1);
    });

    it('delegates to backend', async () => {
      const chesstrace = new Chesstrace({ level: TelemetryLevel.minimal });
      await chesstrace.init(backend);

      await chesstrace.close();
      expect(backend.closeCalls).toBe(1);
    });

    it('can be called multiple times', async () => {
      const chesstrace = new Chesstrace({ level: TelemetryLevel.minimal });
      await chesstrace.init(backend);

      await chesstrace.close();
      await chesstrace.close();
      expect(backend.closeCalls).toBe(2);
    });
  });

  describe('isEnabled', () => {
    it('returns false before init', () => {
      const chesstrace = new Chesstrace({ level: TelemetryLevel.minimal });
      expect(chesstrace.isEnabled()).toBe(false);
    });

    it('returns true after init', async () => {
      const chesstrace = new Chesstrace({ level: TelemetryLevel.minimal });
      await chesstrace.init(backend);
      expect(chesstrace.isEnabled()).toBe(true);
    });

    it('returns false after close', async () => {
      const chesstrace = new Chesstrace({ level: TelemetryLevel.minimal });
      await chesstrace.init(backend);
      await chesstrace.close();
      expect(chesstrace.isEnabled()).toBe(false);
    });
  });
});

describe('singleton pattern', () => {
  beforeEach(() => {
    resetChesstrace();
  });

  describe('getChesstrace', () => {
    it('returns singleton instance', () => {
      const instance1 = getChesstrace();
      const instance2 = getChesstrace();
      expect(instance1).toBe(instance2);
    });

    it('uses default config', () => {
      const instance = getChesstrace();
      expect(instance).toBeDefined();
    });
  });

  describe('resetChesstrace', () => {
    it('resets singleton instance', () => {
      const instance1 = getChesstrace();
      resetChesstrace();
      const instance2 = getChesstrace();
      expect(instance1).not.toBe(instance2);
    });

    it('creates fresh instance after reset', async () => {
      const backend1 = new MockBackend();
      const instance1 = getChesstrace();
      await instance1.init(backend1);

      resetChesstrace();

      const instance2 = getChesstrace();
      expect(instance2.isEnabled()).toBe(false);
    });
  });
});

describe('error handling', () => {
  let backend: MockBackend;

  beforeEach(() => {
    backend = new MockBackend();
    resetChesstrace();
  });

  it('swallows flush errors', async () => {
    const chesstrace = new Chesstrace({ level: TelemetryLevel.minimal });
    await chesstrace.init(backend);
    await chesstrace.startRun();

    backend.shouldThrow = true;
    chesstrace.emit(Events.COMMAND_START, { cmd: 'test' });

    // Should not throw
    await expect(chesstrace.flush()).resolves.not.toThrow();
  });

  it('swallows writeBatch errors', async () => {
    const chesstrace = new Chesstrace({ level: TelemetryLevel.minimal });
    backend.shouldThrow = true;
    await chesstrace.init(backend);
    await chesstrace.startRun();

    chesstrace.emit(Events.COMMAND_START, { cmd: 'test' });

    // Should not throw on flush
    await expect(chesstrace.flush()).resolves.not.toThrow();
  });

  it('continues after write error', async () => {
    const chesstrace = new Chesstrace({ level: TelemetryLevel.minimal });
    await chesstrace.init(backend);
    await chesstrace.startRun();

    backend.shouldThrow = true;
    chesstrace.emit(Events.COMMAND_START, { cmd: 'test1' });
    await chesstrace.flush();

    backend.shouldThrow = false;
    chesstrace.emit(Events.COMMAND_END, { cmd: 'test1' });
    await chesstrace.flush();

    expect(backend.writeBatchCalls.length).toBe(1);
    expect(backend.writeBatchCalls[0][0].event).toBe(Events.COMMAND_END);
  });
});

describe('integration scenarios', () => {
  let backend: MockBackend;

  beforeEach(() => {
    backend = new MockBackend();
    resetChesstrace();
  });

  it('full lifecycle', async () => {
    const chesstrace = new Chesstrace({ level: TelemetryLevel.standard });
    await chesstrace.init(backend);
    const runId = await chesstrace.startRun();

    chesstrace.emit(Events.COMMAND_START, { cmd: 'run' });
    chesstrace.emit(Events.AGENT_START, { agent: 'planner' });
    chesstrace.emit(Events.AGENT_END, { agent: 'planner' });
    chesstrace.emit(Events.COMMAND_END, { cmd: 'run' });

    await chesstrace.flush();
    await chesstrace.close();

    expect(backend.writeBatchCalls.length).toBe(1);
    expect(backend.writeBatchCalls[0].length).toBe(4);
    expect(backend.writeBatchCalls[0].every((e) => e.runId === runId)).toBe(true);
    expect(backend.flushCalls).toBe(1);
    expect(backend.closeCalls).toBe(1);
  });

  it('multiple runs', async () => {
    const chesstrace = new Chesstrace({ level: TelemetryLevel.minimal });
    await chesstrace.init(backend);

    const runId1 = await chesstrace.startRun();
    chesstrace.emit(Events.COMMAND_START, { cmd: 'test1' });
    await chesstrace.flush();

    const runId2 = await chesstrace.startRun();
    chesstrace.emit(Events.COMMAND_START, { cmd: 'test2' });
    await chesstrace.flush();

    expect(backend.writeBatchCalls.length).toBe(2);
    expect(backend.writeBatchCalls[0][0].runId).toBe(runId1);
    expect(backend.writeBatchCalls[1][0].runId).toBe(runId2);
  });

  it('buffering across init boundary', async () => {
    const chesstrace = new Chesstrace({ level: TelemetryLevel.minimal });

    // Before init
    chesstrace.emit(Events.COMMAND_START, { cmd: 'early1' });
    chesstrace.emit(Events.COMMAND_START, { cmd: 'early2' });

    await chesstrace.init(backend);
    await chesstrace.startRun();

    // After init
    chesstrace.emit(Events.COMMAND_START, { cmd: 'late' });
    await chesstrace.flush();

    // Should have buffered events + new event
    expect(backend.writeBatchCalls.length).toBe(2);
    expect(backend.writeBatchCalls[0].length).toBe(2); // buffered
    expect(backend.writeBatchCalls[1].length).toBe(1); // new
  });
});
