import { randomUUID } from 'node:crypto';
import chalk from 'chalk';
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
   * Retention period in days (default: 30)
   */
  retentionDays?: number;

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

      // Auto-prune old events based on retention config
      const retentionDays = this.config.retentionDays ?? 30;
      const olderThan = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
      try {
        const deleted = await backend.prune(olderThan);
        if (deleted > 0) {
          console.log(chalk.gray(`Pruned ${deleted} event(s) older than ${retentionDays} days`));
        }
      } catch (err) {
        this.config.onError?.(err, 'auto-prune');
      }
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

// Singleton instance and config tracking
let instance: Chesstrace | null = null;
let instanceConfig: TelemetryConfig | undefined = undefined;

/**
 * Get global Chesstrace singleton.
 *
 * **Singleton behavior:** First call creates instance with provided config (or default `{ level: 0 }`).
 * Subsequent calls return same instance and ignore config parameter.
 *
 * **Config mismatch warning:** If called with different config after initialization, logs warning
 * to stderr. Caller must call `resetChesstrace()` first to reinitialize with new config.
 *
 * @param config - Config to use when creating new instance (only used on first call)
 * @returns Chesstrace singleton instance
 *
 * @example
 * ```ts
 * // First call creates instance
 * const trace1 = getChesstrace({ level: TelemetryLevel.standard });
 *
 * // Subsequent calls return same instance, config ignored
 * const trace2 = getChesstrace({ level: TelemetryLevel.verbose }); // Warns!
 *
 * // Reset to reinitialize with different config
 * resetChesstrace();
 * const trace3 = getChesstrace({ level: TelemetryLevel.verbose }); // OK
 * ```
 */
export function getChesstrace(config?: TelemetryConfig): Chesstrace {
  if (!instance) {
    const finalConfig = config ?? { level: 0 };
    instance = new Chesstrace(finalConfig);
    instanceConfig = finalConfig;
  } else if (config && JSON.stringify(config) !== JSON.stringify(instanceConfig)) {
    // Config mismatch detected
    console.warn(
      '[Chesstrace] Warning: getChesstrace() called with different config after initialization. ' +
      'Existing instance returned; new config ignored. Call resetChesstrace() first to reinitialize.'
    );
  }
  return instance;
}

/**
 * Reset global Chesstrace singleton (for testing)
 */
export function resetChesstrace(): void {
  instance = null;
  instanceConfig = undefined;
}
