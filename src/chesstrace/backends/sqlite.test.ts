import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SqliteBackend } from './sqlite.js';
import { TelemetryLevel, TelemetryEvent } from '../events.js';

describe('SqliteBackend', () => {
  let backend: SqliteBackend;
  let testDbPath: string;

  beforeEach(async () => {
    // Use temp directory for test database
    testDbPath = join(tmpdir(), `test-chesstrace-${Date.now()}.db`);

    // Create backend with custom path (we'll override resolveDbPath via instance property)
    backend = new SqliteBackend('global');
    (backend as any).dbPath = testDbPath;

    await backend.init();
  });

  afterEach(async () => {
    await backend.close();

    // Clean up test database files
    try {
      if (existsSync(testDbPath)) unlinkSync(testDbPath);
      if (existsSync(`${testDbPath}-wal`)) unlinkSync(`${testDbPath}-wal`);
      if (existsSync(`${testDbPath}-shm`)) unlinkSync(`${testDbPath}-shm`);
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('init', () => {
    it('creates database file', () => {
      expect(existsSync(testDbPath)).toBe(true);
    });

    it('creates events table', async () => {
      const event: TelemetryEvent = {
        id: 'evt_1',
        runId: 'run_1',
        timestamp: Date.now(),
        category: 'command',
        event: 'command.start',
        minLevel: TelemetryLevel.minimal,
        data: {},
      };

      await backend.write(event);
      const results = await backend.query({ runId: 'run_1' });
      expect(results).toHaveLength(1);
    });
  });

  describe('write', () => {
    it('writes single event', async () => {
      const event: TelemetryEvent = {
        id: 'evt_write_1',
        runId: 'run_write_1',
        timestamp: 1000,
        category: 'agent',
        event: 'agent.start',
        minLevel: TelemetryLevel.standard,
        data: { agent: 'dev' },
      };

      await backend.write(event);
      const results = await backend.query({ runId: 'run_write_1' });

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('evt_write_1');
      expect(results[0].category).toBe('agent');
      expect(results[0].data).toEqual({ agent: 'dev' });
    });

    it('preserves complex data objects', async () => {
      const complexData = {
        nested: { value: 42 },
        array: [1, 2, 3],
        string: 'test',
        bool: true,
        null: null,
      };

      const event: TelemetryEvent = {
        id: 'evt_complex',
        runId: 'run_complex',
        timestamp: 2000,
        category: 'llm',
        event: 'llm.request',
        minLevel: TelemetryLevel.verbose,
        data: complexData,
      };

      await backend.write(event);
      const results = await backend.query({ runId: 'run_complex' });

      expect(results[0].data).toEqual(complexData);
    });

    it('throws if database not initialized', async () => {
      const uninitBackend = new SqliteBackend('global');
      (uninitBackend as any).dbPath = join(tmpdir(), 'uninit.db');

      const event: TelemetryEvent = {
        id: 'evt_1',
        runId: 'run_1',
        timestamp: Date.now(),
        category: 'command',
        event: 'command.start',
        minLevel: TelemetryLevel.minimal,
        data: {},
      };

      await expect(uninitBackend.write(event)).rejects.toThrow('Database not initialized');
    });
  });

  describe('writeBatch', () => {
    it('writes multiple events in transaction', async () => {
      const events: TelemetryEvent[] = [
        {
          id: 'evt_batch_1',
          runId: 'run_batch',
          timestamp: 1000,
          category: 'command',
          event: 'command.start',
          minLevel: TelemetryLevel.minimal,
          data: {},
        },
        {
          id: 'evt_batch_2',
          runId: 'run_batch',
          timestamp: 2000,
          category: 'agent',
          event: 'agent.start',
          minLevel: TelemetryLevel.standard,
          data: {},
        },
        {
          id: 'evt_batch_3',
          runId: 'run_batch',
          timestamp: 3000,
          category: 'command',
          event: 'command.end',
          minLevel: TelemetryLevel.minimal,
          data: {},
        },
      ];

      await backend.writeBatch(events);
      const results = await backend.query({ runId: 'run_batch' });

      expect(results).toHaveLength(3);
      expect(results[0].id).toBe('evt_batch_1');
      expect(results[1].id).toBe('evt_batch_2');
      expect(results[2].id).toBe('evt_batch_3');
    });

    it('handles empty batch', async () => {
      await backend.writeBatch([]);
      const results = await backend.query({});
      expect(results).toHaveLength(0);
    });
  });

  describe('query', () => {
    beforeEach(async () => {
      const events: TelemetryEvent[] = [
        {
          id: 'evt_q1',
          runId: 'run_a',
          timestamp: 1000,
          category: 'command',
          event: 'command.start',
          minLevel: TelemetryLevel.minimal,
          data: {},
        },
        {
          id: 'evt_q2',
          runId: 'run_a',
          timestamp: 2000,
          category: 'agent',
          event: 'agent.start',
          minLevel: TelemetryLevel.standard,
          data: {},
        },
        {
          id: 'evt_q3',
          runId: 'run_b',
          timestamp: 3000,
          category: 'command',
          event: 'command.end',
          minLevel: TelemetryLevel.minimal,
          data: {},
        },
        {
          id: 'evt_q4',
          runId: 'run_b',
          timestamp: 4000,
          category: 'llm',
          event: 'llm.request',
          minLevel: TelemetryLevel.verbose,
          data: {},
        },
      ];
      await backend.writeBatch(events);
    });

    it('filters by runId', async () => {
      const results = await backend.query({ runId: 'run_a' });
      expect(results).toHaveLength(2);
      expect(results.every((e) => e.runId === 'run_a')).toBe(true);
    });

    it('filters by category', async () => {
      const results = await backend.query({ category: 'command' });
      expect(results).toHaveLength(2);
      expect(results.every((e) => e.category === 'command')).toBe(true);
    });

    it('filters by event name', async () => {
      const results = await backend.query({ event: 'command.start' });
      expect(results).toHaveLength(1);
      expect(results[0].event).toBe('command.start');
    });

    it('filters by minLevel', async () => {
      const results = await backend.query({ minLevel: TelemetryLevel.standard });
      expect(results).toHaveLength(2);
      expect(results.every((e) => e.minLevel >= TelemetryLevel.standard)).toBe(true);
    });

    it('filters by time range', async () => {
      const results = await backend.query({
        startTime: 2000,
        endTime: 3000,
      });
      expect(results).toHaveLength(2);
      expect(results.every((e) => e.timestamp >= 2000 && e.timestamp <= 3000)).toBe(true);
    });

    it('combines multiple filters', async () => {
      const results = await backend.query({
        runId: 'run_b',
        category: 'llm',
      });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('evt_q4');
    });

    it('returns empty array when no matches', async () => {
      const results = await backend.query({ runId: 'nonexistent' });
      expect(results).toHaveLength(0);
    });

    it('returns all events when filter is empty', async () => {
      const results = await backend.query({});
      expect(results).toHaveLength(4);
    });

    it('orders results by timestamp ascending', async () => {
      const results = await backend.query({});
      expect(results[0].timestamp).toBe(1000);
      expect(results[1].timestamp).toBe(2000);
      expect(results[2].timestamp).toBe(3000);
      expect(results[3].timestamp).toBe(4000);
    });
  });

  describe('listRuns', () => {
    it('returns empty array when no events', async () => {
      const runs = await backend.listRuns();
      expect(runs).toHaveLength(0);
    });

    it('aggregates run metadata', async () => {
      const events: TelemetryEvent[] = [
        {
          id: 'evt_r1',
          runId: 'run_x',
          timestamp: 1000,
          category: 'command',
          event: 'command.start',
          minLevel: TelemetryLevel.minimal,
          data: {},
        },
        {
          id: 'evt_r2',
          runId: 'run_x',
          timestamp: 5000,
          category: 'agent',
          event: 'agent.end',
          minLevel: TelemetryLevel.standard,
          data: {},
        },
      ];
      await backend.writeBatch(events);

      const runs = await backend.listRuns();
      expect(runs).toHaveLength(1);
      expect(runs[0].runId).toBe('run_x');
      expect(runs[0].startTime).toBe(1000);
      expect(runs[0].endTime).toBe(5000);
      expect(runs[0].eventCount).toBe(2);
      expect(runs[0].categories).toContain('command');
      expect(runs[0].categories).toContain('agent');
    });

    it('lists multiple runs', async () => {
      const events: TelemetryEvent[] = [
        {
          id: 'evt_1',
          runId: 'run_1',
          timestamp: 1000,
          category: 'command',
          event: 'command.start',
          minLevel: TelemetryLevel.minimal,
          data: {},
        },
        {
          id: 'evt_2',
          runId: 'run_2',
          timestamp: 2000,
          category: 'git',
          event: 'git.commit',
          minLevel: TelemetryLevel.standard,
          data: {},
        },
      ];
      await backend.writeBatch(events);

      const runs = await backend.listRuns();
      expect(runs).toHaveLength(2);

      // Sorted by start_time DESC (most recent first)
      expect(runs[0].runId).toBe('run_2');
      expect(runs[1].runId).toBe('run_1');
    });

    it('counts distinct categories', async () => {
      const events: TelemetryEvent[] = [
        {
          id: 'evt_1',
          runId: 'run_cat',
          timestamp: 1000,
          category: 'command',
          event: 'command.start',
          minLevel: TelemetryLevel.minimal,
          data: {},
        },
        {
          id: 'evt_2',
          runId: 'run_cat',
          timestamp: 2000,
          category: 'command',
          event: 'command.end',
          minLevel: TelemetryLevel.minimal,
          data: {},
        },
        {
          id: 'evt_3',
          runId: 'run_cat',
          timestamp: 3000,
          category: 'agent',
          event: 'agent.start',
          minLevel: TelemetryLevel.standard,
          data: {},
        },
      ];
      await backend.writeBatch(events);

      const runs = await backend.listRuns();
      expect(runs[0].categories).toHaveLength(2);
      expect(runs[0].categories).toContain('command');
      expect(runs[0].categories).toContain('agent');
    });
  });

  describe('prune', () => {
    beforeEach(async () => {
      const events: TelemetryEvent[] = [
        {
          id: 'evt_old_1',
          runId: 'run_old',
          timestamp: 1000,
          category: 'command',
          event: 'command.start',
          minLevel: TelemetryLevel.minimal,
          data: {},
        },
        {
          id: 'evt_old_2',
          runId: 'run_old',
          timestamp: 2000,
          category: 'command',
          event: 'command.end',
          minLevel: TelemetryLevel.minimal,
          data: {},
        },
        {
          id: 'evt_new',
          runId: 'run_new',
          timestamp: 5000,
          category: 'agent',
          event: 'agent.start',
          minLevel: TelemetryLevel.standard,
          data: {},
        },
      ];
      await backend.writeBatch(events);
    });

    it('deletes events older than timestamp', async () => {
      const deleted = await backend.prune(3000);
      expect(deleted).toBe(2);

      const remaining = await backend.query({});
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe('evt_new');
    });

    it('returns 0 when no events match', async () => {
      const deleted = await backend.prune(500);
      expect(deleted).toBe(0);
    });

    it('deletes all events if timestamp is in future', async () => {
      const deleted = await backend.prune(10000);
      expect(deleted).toBe(3);

      const remaining = await backend.query({});
      expect(remaining).toHaveLength(0);
    });
  });

  describe('flush', () => {
    it('completes without error', async () => {
      await expect(backend.flush()).resolves.toBeUndefined();
    });
  });

  describe('close', () => {
    it('closes database connection', async () => {
      await backend.close();

      const event: TelemetryEvent = {
        id: 'evt_after_close',
        runId: 'run_after',
        timestamp: Date.now(),
        category: 'command',
        event: 'command.start',
        minLevel: TelemetryLevel.minimal,
        data: {},
      };

      await expect(backend.write(event)).rejects.toThrow();
    });

    it('can be called multiple times', async () => {
      await backend.close();
      await expect(backend.close()).resolves.toBeUndefined();
    });
  });

  describe('getDbPath', () => {
    it('returns database path', () => {
      expect(backend.getDbPath()).toBe(testDbPath);
    });
  });
});
