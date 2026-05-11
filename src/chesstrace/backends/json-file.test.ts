import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonFileBackend } from './json-file.js';
import { TelemetryLevel, TelemetryEvent } from '../events.js';

describe('JsonFileBackend', () => {
  let backend: JsonFileBackend;
  let testStorageDir: string;

  beforeEach(async () => {
    // Use temp directory for test storage
    testStorageDir = join(tmpdir(), `test-chesstrace-${Date.now()}`);

    // Create backend with explicit path for testing
    backend = new JsonFileBackend('global', testStorageDir);

    await backend.init();
  });

  afterEach(async () => {
    await backend.close();

    // Clean up test directory
    try {
      if (existsSync(testStorageDir)) {
        rmSync(testStorageDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('init', () => {
    it('creates storage directory', () => {
      expect(existsSync(testStorageDir)).toBe(true);
    });
  });

  describe('write and flush', () => {
    it('writes single event to JSONL file', async () => {
      const event: TelemetryEvent = {
        id: 'evt_write_1',
        runId: 'run_write_1',
        timestamp: new Date('2025-01-15').getTime(),
        category: 'agent',
        event: 'agent.start',
        minLevel: TelemetryLevel.standard,
        data: { agent: 'dev' },
      };

      await backend.write(event);
      await backend.flush();

      const files = readdirSync(testStorageDir);
      expect(files).toContain('2025-01-15.jsonl');

      const content = readFileSync(join(testStorageDir, '2025-01-15.jsonl'), 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines).toHaveLength(1);

      const parsed = JSON.parse(lines[0]) as TelemetryEvent;
      expect(parsed.id).toBe('evt_write_1');
      expect(parsed.data).toEqual({ agent: 'dev' });
    });

    it('appends multiple events to same day file', async () => {
      const timestamp = new Date('2025-01-20').getTime();
      const events: TelemetryEvent[] = [
        {
          id: 'evt_1',
          runId: 'run_1',
          timestamp,
          category: 'command',
          event: 'command.start',
          minLevel: TelemetryLevel.minimal,
          data: {},
        },
        {
          id: 'evt_2',
          runId: 'run_1',
          timestamp: timestamp + 1000,
          category: 'agent',
          event: 'agent.start',
          minLevel: TelemetryLevel.standard,
          data: {},
        },
      ];

      await backend.write(events[0]);
      await backend.flush();
      await backend.write(events[1]);
      await backend.flush();

      const content = readFileSync(join(testStorageDir, '2025-01-20.jsonl'), 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines).toHaveLength(2);
    });

    it('creates separate files for different dates', async () => {
      const events: TelemetryEvent[] = [
        {
          id: 'evt_jan',
          runId: 'run_1',
          timestamp: new Date('2025-01-10').getTime(),
          category: 'command',
          event: 'command.start',
          minLevel: TelemetryLevel.minimal,
          data: {},
        },
        {
          id: 'evt_feb',
          runId: 'run_1',
          timestamp: new Date('2025-02-15').getTime(),
          category: 'command',
          event: 'command.end',
          minLevel: TelemetryLevel.minimal,
          data: {},
        },
      ];

      await backend.writeBatch(events);
      await backend.flush();

      const files = readdirSync(testStorageDir);
      expect(files).toContain('2025-01-10.jsonl');
      expect(files).toContain('2025-02-15.jsonl');
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
        timestamp: new Date('2025-03-01').getTime(),
        category: 'llm',
        event: 'llm.request',
        minLevel: TelemetryLevel.verbose,
        data: complexData,
      };

      await backend.write(event);
      await backend.flush();

      const content = readFileSync(join(testStorageDir, '2025-03-01.jsonl'), 'utf-8');
      const parsed = JSON.parse(content.trim()) as TelemetryEvent;
      expect(parsed.data).toEqual(complexData);
    });

    it('handles empty pending writes', async () => {
      await backend.flush();
      const files = readdirSync(testStorageDir);
      expect(files).toHaveLength(0);
    });
  });

  describe('writeBatch', () => {
    it('writes multiple events in batch', async () => {
      const timestamp = new Date('2025-04-01').getTime();
      const events: TelemetryEvent[] = [
        {
          id: 'evt_batch_1',
          runId: 'run_batch',
          timestamp,
          category: 'command',
          event: 'command.start',
          minLevel: TelemetryLevel.minimal,
          data: {},
        },
        {
          id: 'evt_batch_2',
          runId: 'run_batch',
          timestamp: timestamp + 1000,
          category: 'agent',
          event: 'agent.start',
          minLevel: TelemetryLevel.standard,
          data: {},
        },
        {
          id: 'evt_batch_3',
          runId: 'run_batch',
          timestamp: timestamp + 2000,
          category: 'command',
          event: 'command.end',
          minLevel: TelemetryLevel.minimal,
          data: {},
        },
      ];

      await backend.writeBatch(events);
      await backend.flush();

      const content = readFileSync(join(testStorageDir, '2025-04-01.jsonl'), 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines).toHaveLength(3);
    });

    it('handles empty batch', async () => {
      await backend.writeBatch([]);
      await backend.flush();
      const files = readdirSync(testStorageDir);
      expect(files).toHaveLength(0);
    });
  });

  describe('query', () => {
    beforeEach(async () => {
      const events: TelemetryEvent[] = [
        {
          id: 'evt_q1',
          runId: 'run_a',
          timestamp: new Date('2025-05-01').getTime(),
          category: 'command',
          event: 'command.start',
          minLevel: TelemetryLevel.minimal,
          data: {},
        },
        {
          id: 'evt_q2',
          runId: 'run_a',
          timestamp: new Date('2025-05-01').getTime() + 1000,
          category: 'agent',
          event: 'agent.start',
          minLevel: TelemetryLevel.standard,
          data: {},
        },
        {
          id: 'evt_q3',
          runId: 'run_b',
          timestamp: new Date('2025-05-02').getTime(),
          category: 'command',
          event: 'command.end',
          minLevel: TelemetryLevel.minimal,
          data: {},
        },
        {
          id: 'evt_q4',
          runId: 'run_b',
          timestamp: new Date('2025-05-02').getTime() + 1000,
          category: 'llm',
          event: 'llm.request',
          minLevel: TelemetryLevel.verbose,
          data: {},
        },
      ];
      await backend.writeBatch(events);
      await backend.flush();
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
      const startTime = new Date('2025-05-01').getTime() + 500;
      const endTime = new Date('2025-05-02').getTime() + 500;

      const results = await backend.query({
        startTime,
        endTime,
      });
      expect(results).toHaveLength(2);
      expect(results.every((e) => e.timestamp >= startTime && e.timestamp <= endTime)).toBe(true);
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
      expect(results[0].id).toBe('evt_q1');
      expect(results[1].id).toBe('evt_q2');
      expect(results[2].id).toBe('evt_q3');
      expect(results[3].id).toBe('evt_q4');
    });

    it('reads across multiple date files', async () => {
      const results = await backend.query({});
      const files = new Set(results.map((e) => new Date(e.timestamp).toISOString().split('T')[0]));
      expect(files.size).toBeGreaterThanOrEqual(2);
    });
  });

  describe('listRuns', () => {
    it('returns empty array when no events', async () => {
      const runs = await backend.listRuns();
      expect(runs).toHaveLength(0);
    });

    it('aggregates run metadata', async () => {
      const startTime = new Date('2025-06-01').getTime();
      const endTime = startTime + 5000;

      const events: TelemetryEvent[] = [
        {
          id: 'evt_r1',
          runId: 'run_x',
          timestamp: startTime,
          category: 'command',
          event: 'command.start',
          minLevel: TelemetryLevel.minimal,
          data: {},
        },
        {
          id: 'evt_r2',
          runId: 'run_x',
          timestamp: endTime,
          category: 'agent',
          event: 'agent.end',
          minLevel: TelemetryLevel.standard,
          data: {},
        },
      ];
      await backend.writeBatch(events);
      await backend.flush();

      const runs = await backend.listRuns();
      expect(runs).toHaveLength(1);
      expect(runs[0].runId).toBe('run_x');
      expect(runs[0].startTime).toBe(startTime);
      expect(runs[0].endTime).toBe(endTime);
      expect(runs[0].eventCount).toBe(2);
      expect(runs[0].categories).toContain('command');
      expect(runs[0].categories).toContain('agent');
    });

    it('lists multiple runs', async () => {
      const events: TelemetryEvent[] = [
        {
          id: 'evt_1',
          runId: 'run_1',
          timestamp: new Date('2025-07-01').getTime(),
          category: 'command',
          event: 'command.start',
          minLevel: TelemetryLevel.minimal,
          data: {},
        },
        {
          id: 'evt_2',
          runId: 'run_2',
          timestamp: new Date('2025-07-02').getTime(),
          category: 'git',
          event: 'git.commit',
          minLevel: TelemetryLevel.standard,
          data: {},
        },
      ];
      await backend.writeBatch(events);
      await backend.flush();

      const runs = await backend.listRuns();
      expect(runs).toHaveLength(2);

      // Sorted by start_time DESC (most recent first)
      expect(runs[0].runId).toBe('run_2');
      expect(runs[1].runId).toBe('run_1');
    });

    it('counts distinct categories', async () => {
      const timestamp = new Date('2025-08-01').getTime();
      const events: TelemetryEvent[] = [
        {
          id: 'evt_1',
          runId: 'run_cat',
          timestamp,
          category: 'command',
          event: 'command.start',
          minLevel: TelemetryLevel.minimal,
          data: {},
        },
        {
          id: 'evt_2',
          runId: 'run_cat',
          timestamp: timestamp + 1000,
          category: 'command',
          event: 'command.end',
          minLevel: TelemetryLevel.minimal,
          data: {},
        },
        {
          id: 'evt_3',
          runId: 'run_cat',
          timestamp: timestamp + 2000,
          category: 'agent',
          event: 'agent.start',
          minLevel: TelemetryLevel.standard,
          data: {},
        },
      ];
      await backend.writeBatch(events);
      await backend.flush();

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
          timestamp: new Date('2025-01-01').getTime(),
          category: 'command',
          event: 'command.start',
          minLevel: TelemetryLevel.minimal,
          data: {},
        },
        {
          id: 'evt_old_2',
          runId: 'run_old',
          timestamp: new Date('2025-01-02').getTime(),
          category: 'command',
          event: 'command.end',
          minLevel: TelemetryLevel.minimal,
          data: {},
        },
        {
          id: 'evt_new',
          runId: 'run_new',
          timestamp: new Date('2025-12-31').getTime(),
          category: 'agent',
          event: 'agent.start',
          minLevel: TelemetryLevel.standard,
          data: {},
        },
      ];
      await backend.writeBatch(events);
      await backend.flush();
    });

    it('deletes entire files older than timestamp', async () => {
      const cutoff = new Date('2025-06-01').getTime();
      const deleted = await backend.prune(cutoff);

      expect(deleted).toBeGreaterThanOrEqual(2);

      const remaining = await backend.query({});
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe('evt_new');
    });

    it('returns 0 when no events match', async () => {
      const cutoff = new Date('2024-01-01').getTime();
      const deleted = await backend.prune(cutoff);
      expect(deleted).toBe(0);

      const remaining = await backend.query({});
      expect(remaining).toHaveLength(3);
    });

    it('deletes all events if timestamp is in future', async () => {
      const cutoff = new Date('2026-01-01').getTime();
      const deleted = await backend.prune(cutoff);
      expect(deleted).toBe(3);

      const remaining = await backend.query({});
      expect(remaining).toHaveLength(0);
    });

    it('handles partial file pruning', async () => {
      // Add more events to same day
      const sameDay = new Date('2025-01-01').getTime();
      await backend.write({
        id: 'evt_old_3',
        runId: 'run_old',
        timestamp: sameDay + 3600000, // 1 hour later
        category: 'agent',
        event: 'agent.end',
        minLevel: TelemetryLevel.standard,
        data: {},
      });
      await backend.flush();

      // Prune between the two events on same day
      const cutoff = sameDay + 1800000; // 30 minutes after first event
      await backend.prune(cutoff);

      const remaining = await backend.query({});
      // Should have evt_old_3 and evt_new (evt_old_1 and evt_old_2 pruned)
      expect(remaining.length).toBeGreaterThanOrEqual(2);
      expect(remaining.some((e) => e.id === 'evt_old_3')).toBe(true);
      expect(remaining.some((e) => e.id === 'evt_new')).toBe(true);
    });
  });

  describe('close', () => {
    it('flushes pending writes on close', async () => {
      const event: TelemetryEvent = {
        id: 'evt_pending',
        runId: 'run_pending',
        timestamp: new Date('2025-09-01').getTime(),
        category: 'command',
        event: 'command.start',
        minLevel: TelemetryLevel.minimal,
        data: {},
      };

      await backend.write(event);
      await backend.close();

      const files = readdirSync(testStorageDir);
      expect(files).toContain('2025-09-01.jsonl');
    });

    it('can be called multiple times', async () => {
      await backend.close();
      await expect(backend.close()).resolves.toBeUndefined();
    });
  });

  describe('getStorageDir', () => {
    it('returns storage directory path', () => {
      expect(backend.getStorageDir()).toBe(testStorageDir);
    });
  });
});
