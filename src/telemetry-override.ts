import type { TelemetryConfigLevel } from "./chesstrace/config.js";

/**
 * Runtime telemetry overrides from CLI flags
 */
interface TelemetryOverride {
  /** --no-telemetry flag: completely disable telemetry */
  disabled?: boolean;
  /** --telemetry-level flag: override configured level */
  level?: TelemetryConfigLevel;
}

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
