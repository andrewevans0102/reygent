import { join, dirname } from 'node:path';
import { existsSync, mkdirSync, appendFileSync, readdirSync, readFileSync, unlinkSync, statSync } from 'node:fs';
import type { StorageBackend, EventFilter, RunSummary } from './types.js';
import type { TelemetryEvent, TelemetryCategory } from '../events.js';
import { findLocalConfigDir, resolveGlobalConfigDir } from '../../config.js';

/**
 * JSON file storage backend for telemetry events (fallback when SQLite unavailable)
 * Uses append-only JSONL files with daily rotation (YYYY-MM-DD.jsonl)
 */
export class JsonFileBackend implements StorageBackend {
  private storageDir: string;
  private pendingWrites: TelemetryEvent[] = [];

  constructor(scope: 'local' | 'global' = 'local', explicitPath?: string) {
    this.storageDir = explicitPath ?? this.resolveStorageDir(scope);
  }

  /**
   * Resolve storage directory based on scope
   * Local: .reygent/chesstrace/ (search upward from cwd)
   * Global: ~/.reygent/chesstrace/
   */
  private resolveStorageDir(scope: 'local' | 'global'): string {
    if (scope === 'local') {
      const configDir = findLocalConfigDir(process.cwd());
      if (configDir) {
        return join(configDir, 'chesstrace');
      }
      // Fallback to global if no local .reygent found
      scope = 'global';
    }

    const globalDir = resolveGlobalConfigDir();
    return join(globalDir, 'chesstrace');
  }

  /**
   * Get filename for date (YYYY-MM-DD.jsonl)
   * Uses UTC to ensure consistent date extraction across timezones
   */
  private getFilenameForTimestamp(timestamp: number): string {
    const date = new Date(timestamp);
    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(date.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}.jsonl`;
  }

  /**
   * Get full path for date file
   */
  private getPathForTimestamp(timestamp: number): string {
    return join(this.storageDir, this.getFilenameForTimestamp(timestamp));
  }

  /**
   * Initialize storage directory
   */
  async init(): Promise<void> {
    if (!existsSync(this.storageDir)) {
      mkdirSync(this.storageDir, { recursive: true });
    }
  }

  /**
   * Write single event to storage
   */
  async write(event: TelemetryEvent): Promise<void> {
    this.pendingWrites.push(event);
  }

  /**
   * Write multiple events in batch
   */
  async writeBatch(events: TelemetryEvent[]): Promise<void> {
    this.pendingWrites.push(...events);
  }

  /**
   * Flush pending writes to JSONL files
   */
  async flush(): Promise<void> {
    if (this.pendingWrites.length === 0) {
      return;
    }

    // Ensure storage directory exists
    if (!existsSync(this.storageDir)) {
      mkdirSync(this.storageDir, { recursive: true });
    }

    // Group events by date
    const eventsByFile = new Map<string, TelemetryEvent[]>();
    for (const event of this.pendingWrites) {
      const filePath = this.getPathForTimestamp(event.timestamp);
      if (!eventsByFile.has(filePath)) {
        eventsByFile.set(filePath, []);
      }
      eventsByFile.get(filePath)!.push(event);
    }

    // Append to each file
    for (const [filePath, events] of eventsByFile) {
      const lines = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
      try {
        appendFileSync(filePath, lines, 'utf-8');
      } catch (error) {
        throw new Error(`Failed to write to ${filePath}: ${(error as Error).message}`);
      }
    }

    this.pendingWrites = [];
  }

  /**
   * Read all events from a JSONL file
   */
  private readEventsFromFile(filePath: string): TelemetryEvent[] {
    if (!existsSync(filePath)) {
      return [];
    }

    try {
      const content = readFileSync(filePath, 'utf-8');
      const lines = content.split('\n').filter((line) => line.trim());
      return lines.map((line) => JSON.parse(line) as TelemetryEvent);
    } catch (error) {
      throw new Error(`Failed to read ${filePath}: ${(error as Error).message}`);
    }
  }

  /**
   * Get all JSONL files in storage directory
   */
  private getAllFiles(): string[] {
    if (!existsSync(this.storageDir)) {
      return [];
    }

    try {
      return readdirSync(this.storageDir)
        .filter((name) => name.endsWith('.jsonl'))
        .map((name) => join(this.storageDir, name));
    } catch (error) {
      throw new Error(`Failed to list files in ${this.storageDir}: ${(error as Error).message}`);
    }
  }

  /**
   * Query events matching filter criteria
   */
  async query(filter: EventFilter): Promise<TelemetryEvent[]> {
    // Flush pending writes first
    await this.flush();

    // Read all events from all files
    const files = this.getAllFiles();
    let allEvents: TelemetryEvent[] = [];

    for (const file of files) {
      const events = this.readEventsFromFile(file);
      allEvents = allEvents.concat(events);
    }

    // Apply filters
    let filtered = allEvents;

    if (filter.runId !== undefined) {
      filtered = filtered.filter((e) => e.runId === filter.runId);
    }

    if (filter.category !== undefined) {
      filtered = filtered.filter((e) => e.category === filter.category);
    }

    if (filter.event !== undefined) {
      filtered = filtered.filter((e) => e.event === filter.event);
    }

    if (filter.minLevel !== undefined) {
      filtered = filtered.filter((e) => e.minLevel >= filter.minLevel);
    }

    if (filter.startTime !== undefined) {
      filtered = filtered.filter((e) => e.timestamp >= filter.startTime);
    }

    if (filter.endTime !== undefined) {
      filtered = filtered.filter((e) => e.timestamp <= filter.endTime);
    }

    // Sort by timestamp ascending
    return filtered.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * List all runs with summary metadata
   */
  async listRuns(): Promise<RunSummary[]> {
    // Flush pending writes first
    await this.flush();

    // Read all events from all files
    const files = this.getAllFiles();
    let allEvents: TelemetryEvent[] = [];

    for (const file of files) {
      const events = this.readEventsFromFile(file);
      allEvents = allEvents.concat(events);
    }

    // Group by runId
    const runMap = new Map<
      string,
      {
        minTime: number;
        maxTime: number;
        count: number;
        categories: Set<TelemetryCategory>;
      }
    >();

    for (const event of allEvents) {
      if (!runMap.has(event.runId)) {
        runMap.set(event.runId, {
          minTime: event.timestamp,
          maxTime: event.timestamp,
          count: 0,
          categories: new Set(),
        });
      }

      const run = runMap.get(event.runId)!;
      run.minTime = Math.min(run.minTime, event.timestamp);
      run.maxTime = Math.max(run.maxTime, event.timestamp);
      run.count++;
      run.categories.add(event.category);
    }

    // Convert to RunSummary array and sort by start time descending
    return Array.from(runMap.entries())
      .map(([runId, run]) => ({
        runId,
        startTime: run.minTime,
        endTime: run.maxTime,
        eventCount: run.count,
        categories: Array.from(run.categories),
      }))
      .sort((a, b) => b.startTime - a.startTime);
  }

  /**
   * Prune events older than timestamp
   * Deletes entire files if all events are older than cutoff
   * @param olderThan - Unix timestamp in milliseconds
   * @returns Number of events deleted
   */
  async prune(olderThan: number): Promise<number> {
    // Flush pending writes first
    await this.flush();

    const files = this.getAllFiles();
    let deletedCount = 0;

    for (const file of files) {
      // Check file modification time first for optimization
      try {
        const stats = statSync(file);
        // If file was last modified before cutoff, all events inside are old
        if (stats.mtime.getTime() < olderThan) {
          const events = this.readEventsFromFile(file);
          deletedCount += events.length;
          unlinkSync(file);
          continue;
        }
      } catch (error) {
        // Skip files we can't stat/delete
        continue;
      }

      // Read events and check if any are newer than cutoff
      const events = this.readEventsFromFile(file);
      const newer = events.filter((e) => e.timestamp >= olderThan);
      const older = events.filter((e) => e.timestamp < olderThan);

      if (older.length > 0) {
        deletedCount += older.length;

        if (newer.length === 0) {
          // Delete entire file if all events are old
          try {
            unlinkSync(file);
          } catch (error) {
            // Skip files we can't delete
          }
        } else {
          // Rewrite file with only newer events
          try {
            const lines = newer.map((e) => JSON.stringify(e)).join('\n') + '\n';
            const tempFile = file + '.tmp';
            appendFileSync(tempFile, lines, 'utf-8');
            unlinkSync(file);
            // Rename temp file to original
            require('fs').renameSync(tempFile, file);
          } catch (error) {
            // Skip files we can't rewrite
          }
        }
      }
    }

    return deletedCount;
  }

  /**
   * Close storage (no-op for file backend)
   */
  async close(): Promise<void> {
    // Flush any pending writes
    await this.flush();
  }

  /**
   * Get storage directory path (useful for debugging/testing)
   */
  getStorageDir(): string {
    return this.storageDir;
  }
}
