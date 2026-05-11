import type { TelemetryConfigLevel } from "./chesstrace/config.js";
import { DEFAULT_TELEMETRY_CONFIG } from "./chesstrace/config.js";

/**
 * Runtime telemetry overrides from CLI flags
 */
export interface TelemetryOverride {
  /** --no-telemetry flag: completely disable telemetry */
  disabled?: boolean;
  /** --telemetry-level flag: override configured level */
  level?: TelemetryConfigLevel;
}

/**
 * Telemetry user configuration (subset)
 */
export interface TelemetryConfig {
  telemetry?: {
    enabled?: boolean;
    level?: TelemetryConfigLevel;
  };
}

/**
 * Resolved telemetry settings
 */
export interface ResolvedTelemetry {
  enabled: boolean;
  level: TelemetryConfigLevel;
}

/**
 * Module-level telemetry override state.
 *
 * **Design rationale:** CLI flags parsed in src/cli.ts must propagate to src/commands/run.ts.
 * Module-level state provides simplest mechanism without threading parameters through commander.js.
 *
 * **Thread safety:** Safe for CLI single-instance use. Tests must call resetTelemetryOverride()
 * between test cases to avoid state pollution.
 */
let telemetryOverride: TelemetryOverride = {};

/**
 * Set telemetry runtime override (from CLI flags)
 */
export function setTelemetryOverride(override: TelemetryOverride): void {
  telemetryOverride = override;
}

/**
 * Get current telemetry runtime override
 */
export function getTelemetryOverride(): TelemetryOverride {
  return telemetryOverride;
}

/**
 * Reset telemetry override (for testing)
 *
 * **Important:** Call this in test teardown to prevent state leakage between tests.
 */
export function resetTelemetryOverride(): void {
  telemetryOverride = {};
}

/**
 * Validate telemetry level string
 */
export function isValidTelemetryLevel(level: string): level is TelemetryConfigLevel {
  return level === "minimal" || level === "standard" || level === "verbose";
}

/**
 * Resolve telemetry enabled status and level from config and overrides.
 * Applies CLI flag precedence: --no-telemetry disables, otherwise config enabled state used.
 * Level precedence: override.level > config.level > default.
 *
 * @param override - CLI flag overrides
 * @param config - User configuration
 * @returns Resolved telemetry settings
 */
export function resolveTelemetryEnabled(
  override: TelemetryOverride,
  config: TelemetryConfig
): ResolvedTelemetry {
  const enabled = override.disabled === true ? false : config.telemetry?.enabled === true;
  const level = override.level ?? config.telemetry?.level ?? DEFAULT_TELEMETRY_CONFIG.level;

  return { enabled, level };
}
