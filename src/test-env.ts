/**
 * Test environment detection utility.
 * Provides a single source of truth for checking if code is running in a test environment.
 */

/**
 * Check if code is running in a test environment (vitest, jest, etc).
 *
 * Uses multiple signals:
 * - NODE_ENV === 'test' (common convention)
 * - VITEST === 'true' (vitest-specific)
 *
 * Note: We use process.env string checks instead of import.meta.env because:
 * 1. NODE_ENV is a runtime environment variable, not a build-time constant
 * 2. Test runners (vitest) set these at runtime, not during bundling
 * 3. import.meta.env is for Vite/bundler build-time constants
 */
export function isTestEnvironment(): boolean {
  return process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
}
