import Database from 'better-sqlite3';
import { join, dirname } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import type { StorageBackend, EventFilter, RunSummary } from './types.js';
import type { TelemetryEvent, TelemetryCategory } from '../events.js';
import { findLocalConfigDir, resolveGlobalConfigDir } from '../../config.js';

/**
 * SQLite storage backend for telemetry events
 */
export class SqliteBackend implements StorageBackend {
  private db: Database.Database | null = null;
  private dbPath: string;

  constructor(scope: 'local' | 'global' = 'local', explicitPath?: string) {
    this.dbPath = explicitPath ?? this.resolveDbPath(scope);
  }

  /**
   * Resolve database file path based on scope
   * Local: .reygent/chesstrace.db (search upward from cwd)
   * Global: ~/.reygent/chesstrace.db
   */
  private resolveDbPath(scope: 'local' | 'global'): string {
    if (scope === 'local') {
      const configDir = findLocalConfigDir(process.cwd());
      if (configDir) {
        return join(configDir, 'chesstrace.db');
      }
      // Fallback to global if no local .reygent found
      scope = 'global';
    }

    const globalDir = resolveGlobalConfigDir();
    // Ensure global .reygent directory exists
    if (!existsSync(globalDir)) {
      mkdirSync(globalDir, { recursive: true });
    }
    return join(globalDir, 'chesstrace.db');
  }

  /**
   * Initialize database schema and indexes
   */
  async init(): Promise<void> {
    // Ensure parent directory exists
    const dbDir = dirname(this.dbPath);
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }

    this.db = new Database(this.dbPath);

    // Enable WAL mode for better concurrency
    this.db.pragma('journal_mode = WAL');

    // Create events table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        category TEXT NOT NULL,
        event TEXT NOT NULL,
        min_level INTEGER NOT NULL,
        data TEXT NOT NULL
      )
    `);

    // Create indexes for efficient querying
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_events_run_id ON events(run_id);
      CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_events_category ON events(category);
      CREATE INDEX IF NOT EXISTS idx_events_event ON events(event);
    `);
  }

  /**
   * Write single event to database
   */
  async write(event: TelemetryEvent): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }

    const stmt = this.db.prepare(`
      INSERT INTO events (id, run_id, timestamp, category, event, min_level, data)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      event.id,
      event.runId,
      event.timestamp,
      event.category,
      event.event,
      event.minLevel,
      JSON.stringify(event.data),
    );
  }

  /**
   * Write multiple events in a transaction
   */
  async writeBatch(events: TelemetryEvent[]): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }

    const stmt = this.db.prepare(`
      INSERT INTO events (id, run_id, timestamp, category, event, min_level, data)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = this.db.transaction((events: TelemetryEvent[]) => {
      for (const event of events) {
        stmt.run(
          event.id,
          event.runId,
          event.timestamp,
          event.category,
          event.event,
          event.minLevel,
          JSON.stringify(event.data),
        );
      }
    });

    transaction(events);
  }

  /**
   * Query events matching filter criteria
   */
  async query(filter: EventFilter): Promise<TelemetryEvent[]> {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.runId !== undefined) {
      conditions.push('run_id = ?');
      params.push(filter.runId);
    }

    if (filter.category !== undefined) {
      conditions.push('category = ?');
      params.push(filter.category);
    }

    if (filter.event !== undefined) {
      conditions.push('event = ?');
      params.push(filter.event);
    }

    if (filter.minLevel !== undefined) {
      conditions.push('min_level >= ?');
      params.push(filter.minLevel);
    }

    if (filter.startTime !== undefined) {
      conditions.push('timestamp >= ?');
      params.push(filter.startTime);
    }

    if (filter.endTime !== undefined) {
      conditions.push('timestamp <= ?');
      params.push(filter.endTime);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT * FROM events ${whereClause} ORDER BY timestamp ASC`;

    const rows = this.db.prepare(sql).all(...params) as Array<{
      id: string;
      run_id: string;
      timestamp: number;
      category: TelemetryCategory;
      event: string;
      min_level: number;
      data: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      runId: row.run_id,
      timestamp: row.timestamp,
      category: row.category,
      event: row.event,
      minLevel: row.min_level,
      data: JSON.parse(row.data) as Record<string, unknown>,
    }));
  }

  /**
   * List all runs with summary metadata
   */
  async listRuns(): Promise<RunSummary[]> {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }

    const sql = `
      SELECT
        run_id,
        MIN(timestamp) as start_time,
        MAX(timestamp) as end_time,
        COUNT(*) as event_count,
        GROUP_CONCAT(DISTINCT category) as categories
      FROM events
      GROUP BY run_id
      ORDER BY start_time DESC
    `;

    const rows = this.db.prepare(sql).all() as Array<{
      run_id: string;
      start_time: number;
      end_time: number;
      event_count: number;
      categories: string;
    }>;

    return rows.map((row) => ({
      runId: row.run_id,
      startTime: row.start_time,
      endTime: row.end_time,
      eventCount: row.event_count,
      categories: row.categories.split(',') as TelemetryCategory[],
    }));
  }

  /**
   * Flush pending writes (SQLite auto-commits, so this is a no-op)
   */
  async flush(): Promise<void> {
    // SQLite auto-commits after each transaction, so nothing to flush
  }

  /**
   * Prune events older than timestamp
   * @param olderThan - Unix timestamp in milliseconds
   * @returns Number of events deleted
   */
  async prune(olderThan: number): Promise<number> {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }

    const stmt = this.db.prepare('DELETE FROM events WHERE timestamp < ?');
    const result = stmt.run(olderThan);
    return result.changes;
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  /**
   * Get database file path (useful for debugging/testing)
   */
  getDbPath(): string {
    return this.dbPath;
  }
}
