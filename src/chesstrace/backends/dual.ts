import type { StorageBackend, EventFilter, RunSummary } from './types.js';
import type { TelemetryEvent } from '../events.js';
import { SqliteBackend } from './sqlite.js';

/**
 * Dual backend that writes to both local and global storage.
 * Used when running in a project - writes telemetry to both
 * project-specific db and global aggregate db.
 *
 * Set REYGENT_GLOBAL_TELEMETRY=false to disable global writes (security).
 */
export class DualBackend implements StorageBackend {
  private localBackend: SqliteBackend;
  private globalBackend: SqliteBackend | null;
  private globalEnabled: boolean;

  constructor(projectRoot: string) {
    // Local backend stores project-specific telemetry in chesstrace.db
    this.localBackend = new SqliteBackend('local', `${projectRoot}/.reygent/chesstrace.db`);

    // Global backend opt-out for security (prevent cross-project data leakage)
    this.globalEnabled = process.env.REYGENT_GLOBAL_TELEMETRY !== 'false';
    this.globalBackend = this.globalEnabled ? new SqliteBackend('global') : null;
  }

  async init(): Promise<void> {
    const tasks = [this.localBackend.init()];
    if (this.globalBackend) {
      tasks.push(this.globalBackend.init());
    }
    await Promise.all(tasks);
  }

  async write(event: TelemetryEvent): Promise<void> {
    // Write to both, but don't fail if one fails
    const tasks = [this.localBackend.write(event)];
    if (this.globalBackend) {
      tasks.push(this.globalBackend.write(event));
    }
    const results = await Promise.allSettled(tasks);

    // Log failures in debug mode
    if (process.env.REYGENT_DEBUG === '1' || process.env.REYGENT_DEBUG === 'telemetry') {
      results.forEach((result, idx) => {
        if (result.status === 'rejected') {
          const backend = idx === 0 ? 'local' : 'global';
          console.error(`[debug:telemetry] Dual backend ${backend} write failed:`, result.reason instanceof Error ? result.reason.message : String(result.reason));
        }
      });
    }
  }

  async writeBatch(events: TelemetryEvent[]): Promise<void> {
    const tasks = [this.localBackend.writeBatch(events)];
    if (this.globalBackend) {
      tasks.push(this.globalBackend.writeBatch(events));
    }
    const results = await Promise.allSettled(tasks);

    // Log failures in debug mode
    if (process.env.REYGENT_DEBUG === '1' || process.env.REYGENT_DEBUG === 'telemetry') {
      results.forEach((result, idx) => {
        if (result.status === 'rejected') {
          const backend = idx === 0 ? 'local' : 'global';
          console.error(`[debug:telemetry] Dual backend ${backend} writeBatch failed:`, result.reason instanceof Error ? result.reason.message : String(result.reason));
        }
      });
    }
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
    const tasks = [this.localBackend.flush()];
    if (this.globalBackend) {
      tasks.push(this.globalBackend.flush());
    }
    await Promise.all(tasks);
  }

  async close(): Promise<void> {
    const tasks = [this.localBackend.close()];
    if (this.globalBackend) {
      tasks.push(this.globalBackend.close());
    }
    await Promise.all(tasks);
  }
}
