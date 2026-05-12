import { findProjectRoot } from "./project-detection.js";

/**
 * Get telemetry database path for current context.
 * Returns project-local path if in project, undefined for global fallback.
 *
 * @param cwd - Current working directory to search from
 * @returns Absolute path to .reygent/telemetry.db if in project, undefined otherwise
 */
export function getLocalTelemetryPath(cwd: string): string | undefined {
  const projectRoot = findProjectRoot(cwd);
  return projectRoot ? `${projectRoot}/.reygent/telemetry.db` : undefined;
}
