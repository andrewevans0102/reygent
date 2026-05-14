import { getChesstrace, resetChesstrace } from './chesstrace/index.js';
import type { Chesstrace } from './chesstrace/index.js';
import { Events, TelemetryLevel } from './chesstrace/events.js';
import { DualBackend } from './chesstrace/backends/dual.js';
import { SqliteBackend } from './chesstrace/backends/sqlite.js';
import { loadConfig } from './config.js';
import { getTelemetryOverride, resolveTelemetryEnabled } from './telemetry-override.js';
import { findProjectRoot } from './project-detection.js';
import { isDebug } from './debug.js';

/**
 * Context passed to command body within withTelemetry wrapper.
 */
export interface TelemetryContext {
  chesstrace: Chesstrace | null;
}

/**
 * Wrap a command body with telemetry lifecycle management.
 *
 * - Resolves config + overrides, creates backend, calls init() + startRun()
 * - Emits COMMAND_START before body, COMMAND_END on success, COMMAND_ERROR on throw
 * - Guarantees flush() + close() in finally
 * - If telemetry disabled or init fails, runs body with chesstrace: null
 *
 * Note: run.ts keeps its own inline init (has .reygent/ auto-creation + knowledge update logic).
 */
export async function withTelemetry<T>(
  commandName: string,
  body: (ctx: TelemetryContext) => Promise<T>,
): Promise<T> {
  let chesstrace: Chesstrace | null = null;
  const startTime = Date.now();

  try {
    const config = loadConfig();
    const telemetryOverride = getTelemetryOverride();
    const { enabled, level: levelStr } = resolveTelemetryEnabled(telemetryOverride, config);
    const telemetryLevel = TelemetryLevel[levelStr];

    if (enabled) {
      // Reset singleton to avoid config mismatch warnings from prior commands
      resetChesstrace();
      chesstrace = getChesstrace({ level: telemetryLevel, retentionDays: config.telemetry?.retention ?? 30 });

      const projectRoot = findProjectRoot(process.cwd());
      const backend = projectRoot
        ? new DualBackend(projectRoot)
        : new SqliteBackend('global');

      await chesstrace.init(backend);
      await chesstrace.startRun();
    }
  } catch (err) {
    if (isDebug()) {
      console.error('[telemetry] init failed:', err);
    }
    chesstrace = null;
  }

  // Emit COMMAND_START
  if (chesstrace) {
    try {
      chesstrace.emit(Events.COMMAND_START, { command: commandName });
    } catch {
      // Swallow emit errors
    }
  }

  try {
    const result = await body({ chesstrace });

    // Emit COMMAND_END on success
    if (chesstrace) {
      try {
        chesstrace.emit(Events.COMMAND_END, {
          command: commandName,
          success: true,
          durationMs: Date.now() - startTime,
        });
      } catch {
        // Swallow emit errors
      }
    }

    return result;
  } catch (err) {
    // Emit COMMAND_ERROR on throw
    if (chesstrace) {
      try {
        chesstrace.emit(Events.COMMAND_ERROR, {
          command: commandName,
          error: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - startTime,
        });
      } catch {
        // Swallow emit errors
      }
    }

    throw err;
  } finally {
    if (chesstrace) {
      try {
        await chesstrace.flush();
      } catch {
        // Swallow flush errors
      }
      try {
        await chesstrace.close();
      } catch {
        // Swallow close errors
      }
    }
  }
}
