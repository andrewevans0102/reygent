import type { StorageBackend, EventFilter, RunSummary } from './types.js';
import type { TelemetryEvent } from '../events.js';
import { SqliteBackend } from './sqlite.js';

/**
 * Dual backend that writes to both local and global storage.
 * Used when running in a project - writes telemetry to both
 * project-specific db and global aggregate db.
 */
export class DualBackend implements StorageBackend {
  private localBackend: SqliteBackend;
  private globalBackend: SqliteBackend;

  constructor(projectRoot: string) {
    // Local backend in project
    this.localBackend = new SqliteBackend('local', `${projectRoot}/.reygent/telemetry.db`);

    // Global backend in home directory
    this.globalBackend = new SqliteBackend('global');
  }

  async init(): Promise<void> {
    await Promise.all([
      this.localBackend.init(),
      this.globalBackend.init(),
    ]);
  }

  async write(event: TelemetryEvent): Promise<void> {
    // Write to both, but don't fail if one fails
    await Promise.allSettled([
      this.localBackend.write(event),
      this.globalBackend.write(event),
    ]);
  }

  async writeBatch(events: TelemetryEvent[]): Promise<void> {
    await Promise.allSettled([
      this.localBackend.writeBatch(events),
      this.globalBackend.writeBatch(events),
    ]);
  }

  async query(filter?: EventFilter): Promise<TelemetryEvent[]> {
    // Query from local only (project-specific data)
    return this.localBackend.query(filter);
  }

  async getRunSummaries(limit?: number): Promise<RunSummary[]> {
    // Get summaries from local only
    return this.localBackend.getRunSummaries(limit);
  }

  getEvents(): TelemetryEvent[] {
    // Get events from local only
    return this.localBackend.getEvents();
  }

  async flush(): Promise<void> {
    await Promise.all([
      this.localBackend.flush(),
      this.globalBackend.flush(),
    ]);
  }

  async close(): Promise<void> {
    await Promise.all([
      this.localBackend.close(),
      this.globalBackend.close(),
    ]);
  }
}
