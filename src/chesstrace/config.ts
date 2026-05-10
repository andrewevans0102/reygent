import { z } from 'zod';

/**
 * Telemetry level enumeration
 * - minimal: Only critical events (errors, warnings). Use in CI environments or production deployments where bandwidth/storage is limited.
 * - standard: Normal usage events including commands, success/failure outcomes. Use for interactive development and typical debugging workflows.
 * - verbose: Detailed diagnostic events including timing, internal state transitions, API calls. Use when troubleshooting specific issues or developing Reygent itself.
 */
export type TelemetryConfigLevel = 'minimal' | 'standard' | 'verbose';

/**
 * Storage backend type
 */
export type TelemetryBackend = 'sqlite';

/**
 * Telemetry user configuration (stored in .reygent/config.json)
 */
export interface TelemetryUserConfig {
  /**
   * Enable/disable telemetry (undefined = unset, prompts on first run)
   */
  enabled?: boolean;

  /**
   * Telemetry capture level
   */
  level: TelemetryConfigLevel;

  /**
   * Storage backend
   */
  backend: TelemetryBackend;

  /**
   * Retention period in days
   */
  retention: number;
}

/**
 * Zod schema for telemetry user configuration
 */
export const TelemetryUserConfigSchema = z.object({
  enabled: z.boolean().optional(),
  level: z.enum(['minimal', 'standard', 'verbose']),
  backend: z.enum(['sqlite']),
  retention: z.number().int().positive(),
});

/**
 * Default telemetry configuration
 */
export const DEFAULT_TELEMETRY_CONFIG: TelemetryUserConfig = {
  enabled: undefined,
  level: 'standard',
  backend: 'sqlite',
  retention: 30,
};
