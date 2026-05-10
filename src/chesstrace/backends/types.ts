import type { TelemetryEvent, TelemetryCategory, TelemetryLevel } from '../events.js';

/**
 * Filter criteria for querying events
 */
export interface EventFilter {
  runId?: string;
  category?: TelemetryCategory;
  event?: string;
  minLevel?: TelemetryLevel;
  startTime?: number;
  endTime?: number;
}

/**
 * Summary metadata for a telemetry run
 */
export interface RunSummary {
  runId: string;
  startTime: number;
  endTime?: number;
  eventCount: number;
  categories: TelemetryCategory[];
}

/**
 * Pluggable storage backend interface for telemetry events
 */
export interface StorageBackend {
  /**
   * Initialize storage (create tables, indexes, etc.)
   */
  init(): Promise<void>;

  /**
   * Write single event to storage
   */
  write(event: TelemetryEvent): Promise<void>;

  /**
   * Write multiple events in batch
   */
  writeBatch(events: TelemetryEvent[]): Promise<void>;

  /**
   * Query events matching filter criteria
   */
  query(filter: EventFilter): Promise<TelemetryEvent[]>;

  /**
   * List all runs with summary metadata
   */
  listRuns(): Promise<RunSummary[]>;

  /**
   * Flush pending writes to storage
   */
  flush(): Promise<void>;

  /**
   * Prune old events (e.g., by age or count)
   */
  prune(olderThan: number): Promise<number>;

  /**
   * Close storage connection
   */
  close(): Promise<void>;
}
