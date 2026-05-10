import { describe, it, expect } from 'vitest';
import { TelemetryLevel, TelemetryEvent } from '../events';
import type { StorageBackend, EventFilter, RunSummary } from './types';

/**
 * Contract tests for StorageBackend interface
 * These tests verify the interface shape and contract expectations
 * Implementation-specific tests are in sqlite.test.ts
 */

describe('StorageBackend interface', () => {
  describe('type definitions', () => {
    it('defines required methods', () => {
      const methodNames = [
        'init',
        'write',
        'writeBatch',
        'query',
        'listRuns',
        'flush',
        'prune',
        'close',
      ];

      // Type assertion ensures interface has these methods
      const mockBackend: StorageBackend = {
        init: async () => {},
        write: async (_event: TelemetryEvent) => {},
        writeBatch: async (_events: TelemetryEvent[]) => {},
        query: async (_filter: EventFilter) => [],
        listRuns: async () => [],
        flush: async () => {},
        prune: async (_retentionDays: number) => {},
        close: async () => {},
      };

      expect(mockBackend).toBeDefined();
      methodNames.forEach(method => {
        expect(typeof mockBackend[method as keyof StorageBackend]).toBe('function');
      });
    });

    it('init returns Promise<void>', async () => {
      const backend: StorageBackend = {
        init: async () => {},
        write: async () => {},
        writeBatch: async () => {},
        query: async () => [],
        listRuns: async () => [],
        flush: async () => {},
        prune: async () => {},
        close: async () => {},
      };

      const result = backend.init();
      expect(result).toBeInstanceOf(Promise);
      await expect(result).resolves.toBeUndefined();
    });

    it('write accepts TelemetryEvent and returns Promise<void>', async () => {
      const backend: StorageBackend = {
        init: async () => {},
        write: async (event: TelemetryEvent) => {
          expect(event).toHaveProperty('id');
          expect(event).toHaveProperty('runId');
          expect(event).toHaveProperty('timestamp');
          expect(event).toHaveProperty('category');
          expect(event).toHaveProperty('event');
          expect(event).toHaveProperty('minLevel');
          expect(event).toHaveProperty('data');
        },
        writeBatch: async () => {},
        query: async () => [],
        listRuns: async () => [],
        flush: async () => {},
        prune: async () => {},
        close: async () => {},
      };

      const event: TelemetryEvent = {
        id: 'test',
        runId: 'run',
        timestamp: Date.now(),
        category: 'command',
        event: 'command.start',
        minLevel: TelemetryLevel.minimal,
        data: {},
      };

      const result = backend.write(event);
      expect(result).toBeInstanceOf(Promise);
      await expect(result).resolves.toBeUndefined();
    });

    it('writeBatch accepts TelemetryEvent[] and returns Promise<void>', async () => {
      const backend: StorageBackend = {
        init: async () => {},
        write: async () => {},
        writeBatch: async (events: TelemetryEvent[]) => {
          expect(Array.isArray(events)).toBe(true);
        },
        query: async () => [],
        listRuns: async () => [],
        flush: async () => {},
        prune: async () => {},
        close: async () => {},
      };

      const result = backend.writeBatch([]);
      expect(result).toBeInstanceOf(Promise);
      await expect(result).resolves.toBeUndefined();
    });

    it('query accepts EventFilter and returns Promise<TelemetryEvent[]>', async () => {
      const mockEvents: TelemetryEvent[] = [
        {
          id: 'evt_1',
          runId: 'run_1',
          timestamp: Date.now(),
          category: 'command',
          event: 'command.start',
          minLevel: TelemetryLevel.minimal,
          data: {},
        },
      ];

      const backend: StorageBackend = {
        init: async () => {},
        write: async () => {},
        writeBatch: async () => {},
        query: async (filter: EventFilter) => {
          expect(typeof filter).toBe('object');
          return mockEvents;
        },
        listRuns: async () => [],
        flush: async () => {},
        prune: async () => {},
        close: async () => {},
      };

      const result = await backend.query({});
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);
    });

    it('listRuns returns Promise<RunSummary[]>', async () => {
      const mockRuns: RunSummary[] = [
        {
          runId: 'run_1',
          startTime: 1000,
          endTime: 2000,
          eventCount: 5,
        },
      ];

      const backend: StorageBackend = {
        init: async () => {},
        write: async () => {},
        writeBatch: async () => {},
        query: async () => [],
        listRuns: async () => mockRuns,
        flush: async () => {},
        prune: async () => {},
        close: async () => {},
      };

      const result = await backend.listRuns();
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);
      expect(result[0]).toHaveProperty('runId');
      expect(result[0]).toHaveProperty('startTime');
      expect(result[0]).toHaveProperty('endTime');
      expect(result[0]).toHaveProperty('eventCount');
    });

    it('flush returns Promise<void>', async () => {
      const backend: StorageBackend = {
        init: async () => {},
        write: async () => {},
        writeBatch: async () => {},
        query: async () => [],
        listRuns: async () => [],
        flush: async () => {},
        prune: async () => {},
        close: async () => {},
      };

      const result = backend.flush();
      expect(result).toBeInstanceOf(Promise);
      await expect(result).resolves.toBeUndefined();
    });

    it('prune accepts number and returns Promise<void>', async () => {
      const backend: StorageBackend = {
        init: async () => {},
        write: async () => {},
        writeBatch: async () => {},
        query: async () => [],
        listRuns: async () => [],
        flush: async () => {},
        prune: async (retentionDays: number) => {
          expect(typeof retentionDays).toBe('number');
        },
        close: async () => {},
      };

      const result = backend.prune(30);
      expect(result).toBeInstanceOf(Promise);
      await expect(result).resolves.toBeUndefined();
    });

    it('close returns Promise<void>', async () => {
      const backend: StorageBackend = {
        init: async () => {},
        write: async () => {},
        writeBatch: async () => {},
        query: async () => [],
        listRuns: async () => [],
        flush: async () => {},
        prune: async () => {},
        close: async () => {},
      };

      const result = backend.close();
      expect(result).toBeInstanceOf(Promise);
      await expect(result).resolves.toBeUndefined();
    });
  });
});

describe('EventFilter interface', () => {
  describe('type definitions', () => {
    it('accepts empty filter', () => {
      const filter: EventFilter = {};
      expect(filter).toEqual({});
    });

    it('accepts runId filter', () => {
      const filter: EventFilter = { runId: 'run_123' };
      expect(filter.runId).toBe('run_123');
    });

    it('accepts category filter', () => {
      const filter: EventFilter = { category: 'command' };
      expect(filter.category).toBe('command');
    });

    it('accepts event filter', () => {
      const filter: EventFilter = { event: 'command.start' };
      expect(filter.event).toBe('command.start');
    });

    it('accepts minLevel filter', () => {
      const filter: EventFilter = { minLevel: TelemetryLevel.standard };
      expect(filter.minLevel).toBe(TelemetryLevel.standard);
    });

    it('accepts startTime filter', () => {
      const now = Date.now();
      const filter: EventFilter = { startTime: now };
      expect(filter.startTime).toBe(now);
    });

    it('accepts endTime filter', () => {
      const now = Date.now();
      const filter: EventFilter = { endTime: now };
      expect(filter.endTime).toBe(now);
    });

    it('accepts combined filters', () => {
      const filter: EventFilter = {
        runId: 'run_123',
        category: 'command',
        event: 'command.start',
        minLevel: TelemetryLevel.minimal,
        startTime: 1000,
        endTime: 2000,
      };

      expect(filter.runId).toBe('run_123');
      expect(filter.category).toBe('command');
      expect(filter.event).toBe('command.start');
      expect(filter.minLevel).toBe(TelemetryLevel.minimal);
      expect(filter.startTime).toBe(1000);
      expect(filter.endTime).toBe(2000);
    });

    it('all fields are optional', () => {
      const filter1: EventFilter = {};
      const filter2: EventFilter = { runId: 'test' };
      const filter3: EventFilter = { category: 'agent' };

      expect(filter1).toBeDefined();
      expect(filter2).toBeDefined();
      expect(filter3).toBeDefined();
    });
  });

  describe('filter semantics', () => {
    it('runId filters events for specific run', () => {
      const filter: EventFilter = { runId: 'run_abc' };
      expect(filter.runId).toBe('run_abc');
    });

    it('category filters by event category', () => {
      const categories = ['command', 'agent', 'llm', 'git', 'spec', 'error', 'performance'];
      categories.forEach(cat => {
        const filter: EventFilter = { category: cat as any };
        expect(filter.category).toBe(cat);
      });
    });

    it('minLevel filters events at or above level', () => {
      const levels = [TelemetryLevel.minimal, TelemetryLevel.standard, TelemetryLevel.verbose];
      levels.forEach(level => {
        const filter: EventFilter = { minLevel: level };
        expect(filter.minLevel).toBe(level);
      });
    });

    it('timestamp filters define range', () => {
      const now = Date.now();
      const filter: EventFilter = {
        startTime: now - 10000,
        endTime: now,
      };

      expect(filter.startTime).toBeLessThan(filter.endTime!);
    });
  });
});

describe('RunSummary interface', () => {
  describe('type definitions', () => {
    it('defines required fields', () => {
      const summary: RunSummary = {
        runId: 'run_123',
        startTime: 1000,
        endTime: 2000,
        eventCount: 42,
      };

      expect(summary.runId).toBe('run_123');
      expect(summary.startTime).toBe(1000);
      expect(summary.endTime).toBe(2000);
      expect(summary.eventCount).toBe(42);
    });

    it('runId is string', () => {
      const summary: RunSummary = {
        runId: 'test-run-id',
        startTime: 0,
        endTime: 0,
        eventCount: 0,
      };

      expect(typeof summary.runId).toBe('string');
    });

    it('startTime is number (timestamp)', () => {
      const summary: RunSummary = {
        runId: 'run',
        startTime: Date.now(),
        endTime: Date.now(),
        eventCount: 0,
      };

      expect(typeof summary.startTime).toBe('number');
    });

    it('endTime is number (timestamp)', () => {
      const summary: RunSummary = {
        runId: 'run',
        startTime: 0,
        endTime: Date.now(),
        eventCount: 0,
      };

      expect(typeof summary.endTime).toBe('number');
    });

    it('eventCount is number', () => {
      const summary: RunSummary = {
        runId: 'run',
        startTime: 0,
        endTime: 0,
        eventCount: 100,
      };

      expect(typeof summary.eventCount).toBe('number');
    });
  });

  describe('semantic constraints', () => {
    it('startTime should be <= endTime', () => {
      const summary: RunSummary = {
        runId: 'run',
        startTime: 1000,
        endTime: 2000,
        eventCount: 5,
      };

      expect(summary.startTime).toBeLessThanOrEqual(summary.endTime);
    });

    it('eventCount should be non-negative', () => {
      const summary: RunSummary = {
        runId: 'run',
        startTime: 0,
        endTime: 0,
        eventCount: 0,
      };

      expect(summary.eventCount).toBeGreaterThanOrEqual(0);
    });

    it('handles single event run', () => {
      const summary: RunSummary = {
        runId: 'run',
        startTime: 1000,
        endTime: 1000,
        eventCount: 1,
      };

      expect(summary.startTime).toBe(summary.endTime);
      expect(summary.eventCount).toBe(1);
    });

    it('handles long-running session', () => {
      const now = Date.now();
      const summary: RunSummary = {
        runId: 'long-run',
        startTime: now - 3600000, // 1 hour ago
        endTime: now,
        eventCount: 1000,
      };

      expect(summary.endTime - summary.startTime).toBe(3600000);
      expect(summary.eventCount).toBe(1000);
    });
  });

  describe('array of summaries', () => {
    it('supports multiple runs', () => {
      const summaries: RunSummary[] = [
        {
          runId: 'run_1',
          startTime: 1000,
          endTime: 2000,
          eventCount: 10,
        },
        {
          runId: 'run_2',
          startTime: 3000,
          endTime: 4000,
          eventCount: 20,
        },
        {
          runId: 'run_3',
          startTime: 5000,
          endTime: 6000,
          eventCount: 30,
        },
      ];

      expect(summaries).toHaveLength(3);
      expect(summaries[0].runId).toBe('run_1');
      expect(summaries[1].runId).toBe('run_2');
      expect(summaries[2].runId).toBe('run_3');
    });

    it('can be sorted chronologically', () => {
      const summaries: RunSummary[] = [
        {
          runId: 'run_3',
          startTime: 5000,
          endTime: 6000,
          eventCount: 30,
        },
        {
          runId: 'run_1',
          startTime: 1000,
          endTime: 2000,
          eventCount: 10,
        },
        {
          runId: 'run_2',
          startTime: 3000,
          endTime: 4000,
          eventCount: 20,
        },
      ];

      const sorted = [...summaries].sort((a, b) => a.startTime - b.startTime);

      expect(sorted[0].runId).toBe('run_1');
      expect(sorted[1].runId).toBe('run_2');
      expect(sorted[2].runId).toBe('run_3');
    });

    it('can be sorted by event count', () => {
      const summaries: RunSummary[] = [
        {
          runId: 'run_1',
          startTime: 1000,
          endTime: 2000,
          eventCount: 50,
        },
        {
          runId: 'run_2',
          startTime: 3000,
          endTime: 4000,
          eventCount: 10,
        },
        {
          runId: 'run_3',
          startTime: 5000,
          endTime: 6000,
          eventCount: 30,
        },
      ];

      const sorted = [...summaries].sort((a, b) => b.eventCount - a.eventCount);

      expect(sorted[0].runId).toBe('run_1');
      expect(sorted[1].runId).toBe('run_3');
      expect(sorted[2].runId).toBe('run_2');
    });
  });
});

describe('interface integration', () => {
  it('StorageBackend query uses EventFilter', async () => {
    const filter: EventFilter = {
      runId: 'run_1',
      category: 'command',
    };

    const backend: StorageBackend = {
      init: async () => {},
      write: async () => {},
      writeBatch: async () => {},
      query: async (f: EventFilter) => {
        expect(f).toEqual(filter);
        return [];
      },
      listRuns: async () => [],
      flush: async () => {},
      prune: async () => {},
      close: async () => {},
    };

    await backend.query(filter);
  });

  it('StorageBackend listRuns returns RunSummary[]', async () => {
    const runs: RunSummary[] = [
      {
        runId: 'run_1',
        startTime: 1000,
        endTime: 2000,
        eventCount: 5,
      },
    ];

    const backend: StorageBackend = {
      init: async () => {},
      write: async () => {},
      writeBatch: async () => {},
      query: async () => [],
      listRuns: async () => runs,
      flush: async () => {},
      prune: async () => {},
      close: async () => {},
    };

    const result = await backend.listRuns();
    expect(result).toBe(runs);
  });

  it('StorageBackend write/query round-trip', async () => {
    let stored: TelemetryEvent | null = null;

    const backend: StorageBackend = {
      init: async () => {},
      write: async (event: TelemetryEvent) => {
        stored = event;
      },
      writeBatch: async () => {},
      query: async () => (stored ? [stored] : []),
      listRuns: async () => [],
      flush: async () => {},
      prune: async () => {},
      close: async () => {},
    };

    const event: TelemetryEvent = {
      id: 'evt_1',
      runId: 'run_1',
      timestamp: Date.now(),
      category: 'command',
      event: 'command.start',
      minLevel: TelemetryLevel.minimal,
      data: { test: true },
    };

    await backend.write(event);
    const results = await backend.query({});

    expect(results).toHaveLength(1);
    expect(results[0]).toBe(event);
  });
});
