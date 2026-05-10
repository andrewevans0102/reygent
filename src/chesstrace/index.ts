import { randomUUID } from 'node:crypto';
import type { StorageBackend, EventFilter, RunSummary } from './backends/types.js';
import type { TelemetryEvent, TelemetryLevel } from './events.js';
import { EVENT_LEVELS, categoryFromEvent } from './events.js';

/**
 * Configuration for Chesstrace telemetry
 */
export interface TelemetryConfig {
  /**
   * Telemetry level to capture (0=minimal, 1=standard, 2=verbose)
   */
  level: TelemetryLevel;

  /**
   * Optional callback for swallowed errors (for debugging)
   */
  onError?: (err: unknown, operation: string) => void;
}

/**
 * Core Chesstrace class for telemetry event emission and lifecycle management
 */
export class Chesstrace {
  private config: TelemetryConfig;
  private backend: StorageBackend | null = null;
  private currentRunId: string | null = null;
  private initPromise: Promise<void> | null = null;
  private rawEventBuffer: Array<{ event: string; data: Record<string, unknown> }> = [];
  private eventBuffer: TelemetryEvent[] = [];
  private closed = false;
  private flushed = false;

  constructor(config: TelemetryConfig) {
    this.config = config;
  }

  /**
   * Initialize storage backend
   */
  async init(backend: StorageBackend): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      this.backend = backend;
      await backend.init();
    })();

    return this.initPromise;
  }

  /**
   * Generate and store new run ID
   */
  async startRun(): Promise<string> {
    this.currentRunId = randomUUID();

    // Process buffered raw events (emitted before startRun)
    const rawBuffered = this.rawEventBuffer.splice(0);
    if (rawBuffered.length > 0 && this.backend) {
      const events: TelemetryEvent[] = [];
      for (const { event, data } of rawBuffered) {
        const minLevel = EVENT_LEVELS[event];
        if (minLevel !== undefined && minLevel <= this.config.level) {
          events.push({
            id: randomUUID(),
            runId: this.currentRunId,
            timestamp: Date.now(),
            category: categoryFromEvent(event),
            event,
            minLevel,
            data,
          });
        }
      }
      if (events.length > 0) {
        this.eventBuffer.push(...events);
      }
    }

    return this.currentRunId;
  }

  /**
   * Emit telemetry event with level filtering
   */
  emit(event: string, data: Record<string, unknown> = {}): void {
    // Reset flushed flag when new events arrive
    this.flushed = false;

    // Buffer raw events before init or before startRun
    if (!this.backend || !this.currentRunId) {
      this.rawEventBuffer.push({ event, data });
      return;
    }

    // Filter by level
    const minLevel = EVENT_LEVELS[event];
    if (minLevel === undefined || minLevel > this.config.level) {
      return;
    }

    const telemetryEvent: TelemetryEvent = {
      id: randomUUID(),
      runId: this.currentRunId,
      timestamp: Date.now(),
      category: categoryFromEvent(event),
      event,
      minLevel,
      data,
    };

    this.eventBuffer.push(telemetryEvent);
  }

  /**
   * Flush buffered events to backend
   */
  async flush(): Promise<void> {
    if (!this.backend) {
      return;
    }

    const buffered = this.eventBuffer.splice(0);
    if (buffered.length > 0) {
      try {
        await this.backend.writeBatch(buffered);
      } catch (err) {
        this.config.onError?.(err, 'writeBatch');
      }
    }

    try {
      await this.backend.flush();
    } catch (err) {
      this.config.onError?.(err, 'flush');
    }

    this.flushed = true;
  }

  /**
   * Query events from backend
   */
  async query(filter: EventFilter): Promise<TelemetryEvent[]> {
    if (!this.backend) {
      return [];
    }

    try {
      return await this.backend.query(filter);
    } catch (err) {
      return [];
    }
  }

  /**
   * List all runs with summary metadata
   */
  async listRuns(): Promise<RunSummary[]> {
    if (!this.backend) {
      return [];
    }

    try {
      return await this.backend.listRuns();
    } catch (err) {
      return [];
    }
  }

  /**
   * Prune events older than specified days
   * @param days - Number of days to retain
   * @returns Number of events deleted
   */
  async prune(days: number): Promise<number> {
    if (!this.backend) {
      return 0;
    }

    const olderThan = Date.now() - days * 24 * 60 * 60 * 1000;

    try {
      return await this.backend.prune(olderThan);
    } catch (err) {
      return 0;
    }
  }

  /**
   * Close backend and flush remaining events
   */
  async close(): Promise<void> {
    if (this.backend) {
      // Only flush if not already flushed or if buffer has new events
      if (!this.flushed || this.eventBuffer.length > 0) {
        await this.flush();
      }

      try {
        await this.backend.close();
      } catch (err) {
        this.config.onError?.(err, 'close');
      }
    }

    this.closed = true;
  }

  /**
   * Check if telemetry is enabled (backend initialized and not closed)
   */
  isEnabled(): boolean {
    return this.backend !== null && !this.closed;
  }
}

// Singleton instance
let instance: Chesstrace | null = null;

/**
 * Get global Chesstrace singleton (creates with default config if not set)
 */
export function getChesstrace(): Chesstrace {
  if (!instance) {
    instance = new Chesstrace({ level: 0 });
  }
  return instance;
}

/**
 * Reset global Chesstrace singleton (for testing)
 */
export function resetChesstrace(): void {
  instance = null;
}
