import { z } from 'zod';

/**
 * Telemetry level enumeration
 * - minimal: Only critical events (errors, warnings)
 * - standard: Normal usage events
 * - verbose: Detailed diagnostic events
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
