import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Events } from './chesstrace/events.js';
import type { TelemetryEvent } from './chesstrace/events.js';
import type { StorageBackend, EventFilter, RunSummary } from './chesstrace/backends/types.js';

// Mock backend that captures events
class MockBackend implements StorageBackend {
  public events: TelemetryEvent[] = [];
  public flushCalls = 0;
  public closeCalls = 0;
  public shouldThrowOnInit = false;

  async init(): Promise<void> {
    if (this.shouldThrowOnInit) throw new Error('Mock init error');
  }
  async write(event: TelemetryEvent): Promise<void> {
    this.events.push(event);
  }
  async writeBatch(events: TelemetryEvent[]): Promise<void> {
    this.events.push(...events);
  }
  async query(_filter: EventFilter): Promise<TelemetryEvent[]> {
    return [];
  }
  async listRuns(): Promise<RunSummary[]> {
    return [];
  }
  async flush(): Promise<void> {
    this.flushCalls++;
  }
  async prune(_olderThan: number): Promise<number> {
    return 0;
  }
  async close(): Promise<void> {
    this.closeCalls++;
  }
}

// We need to mock modules before importing withTelemetry
let mockEnabled = false;
let mockBackend: MockBackend;

vi.mock('./config.js', () => ({
  loadConfig: () => ({
    telemetry: { enabled: mockEnabled, level: 'minimal', retention: 30 },
  }),
}));

vi.mock('./telemetry-override.js', () => ({
  getTelemetryOverride: () => ({}),
  resolveTelemetryEnabled: (_override: unknown, config: { telemetry?: { enabled?: boolean } }) => ({
    enabled: config?.telemetry?.enabled ?? false,
    level: 'minimal',
  }),
}));

vi.mock('./project-detection.js', () => ({
  findProjectRoot: () => '/fake/project',
}));

vi.mock('./chesstrace/backends/dual.ts', () => ({
  DualBackend: class {
    async init() { return mockBackend.init(); }
    async write(e: TelemetryEvent) { return mockBackend.write(e); }
    async writeBatch(e: TelemetryEvent[]) { return mockBackend.writeBatch(e); }
    async query(f: EventFilter) { return mockBackend.query(f); }
    async listRuns() { return mockBackend.listRuns(); }
    async flush() { return mockBackend.flush(); }
    async prune(o: number) { return mockBackend.prune(o); }
    async close() { return mockBackend.close(); }
  },
}));

// Import after mocks
import { withTelemetry } from './telemetry-lifecycle.js';
import { resetChesstrace } from './chesstrace/index.js';

describe('withTelemetry', () => {
  beforeEach(() => {
    resetChesstrace();
    mockBackend = new MockBackend();
    mockEnabled = false;
  });

  it('runs body with null chesstrace when telemetry disabled', async () => {
    mockEnabled = false;
    let receivedCtx: unknown;

    await withTelemetry('test-cmd', async (ctx) => {
      receivedCtx = ctx;
      return 'ok';
    });

    expect((receivedCtx as { chesstrace: unknown }).chesstrace).toBeNull();
  });

  it('returns body result', async () => {
    mockEnabled = false;
    const result = await withTelemetry('test-cmd', async () => 42);
    expect(result).toBe(42);
  });

  it('re-throws errors from body', async () => {
    mockEnabled = false;
    await expect(
      withTelemetry('test-cmd', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });

  it('emits COMMAND_START and COMMAND_END on success when enabled', async () => {
    mockEnabled = true;

    await withTelemetry('my-cmd', async () => 'ok');

    const eventNames = mockBackend.events.map((e) => e.event);
    expect(eventNames).toContain(Events.COMMAND_START);
    expect(eventNames).toContain(Events.COMMAND_END);

    const startEvent = mockBackend.events.find((e) => e.event === Events.COMMAND_START);
    expect(startEvent?.data.command).toBe('my-cmd');

    const endEvent = mockBackend.events.find((e) => e.event === Events.COMMAND_END);
    expect(endEvent?.data.command).toBe('my-cmd');
    expect(endEvent?.data.success).toBe(true);
    expect(typeof endEvent?.data.durationMs).toBe('number');
  });

  it('emits COMMAND_START and COMMAND_ERROR on throw when enabled', async () => {
    mockEnabled = true;

    await expect(
      withTelemetry('fail-cmd', async () => {
        throw new Error('test error');
      }),
    ).rejects.toThrow('test error');

    const eventNames = mockBackend.events.map((e) => e.event);
    expect(eventNames).toContain(Events.COMMAND_START);
    expect(eventNames).toContain(Events.COMMAND_ERROR);

    const errorEvent = mockBackend.events.find((e) => e.event === Events.COMMAND_ERROR);
    expect(errorEvent?.data.command).toBe('fail-cmd');
    expect(errorEvent?.data.error).toBe('test error');
  });

  it('calls flush and close when enabled', async () => {
    mockEnabled = true;

    await withTelemetry('test-cmd', async () => 'ok');

    expect(mockBackend.flushCalls).toBeGreaterThanOrEqual(1);
    expect(mockBackend.closeCalls).toBeGreaterThanOrEqual(1);
  });

  it('calls flush and close even on error', async () => {
    mockEnabled = true;

    await expect(
      withTelemetry('test-cmd', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow();

    expect(mockBackend.flushCalls).toBeGreaterThanOrEqual(1);
    expect(mockBackend.closeCalls).toBeGreaterThanOrEqual(1);
  });

  it('runs body with null chesstrace when init fails', async () => {
    mockEnabled = true;
    mockBackend.shouldThrowOnInit = true;

    let receivedCtx: unknown;
    const result = await withTelemetry('test-cmd', async (ctx) => {
      receivedCtx = ctx;
      return 'still works';
    });

    expect(result).toBe('still works');
    expect((receivedCtx as { chesstrace: unknown }).chesstrace).toBeNull();
  });
});
