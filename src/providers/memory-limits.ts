/** Memory caps for spawned child processes and reygent itself. */

/** Max V8 old-space for each spawned CLI child (MB). */
export const CHILD_MAX_OLD_SPACE_MB = 1024;

/** Max V8 old-space for reygent's own process (MB). */
export const REYGENT_MAX_OLD_SPACE_MB = 256;

/** Max stdout bytes to buffer from a child process (10 MB). */
export const MAX_STDOUT_BYTES = 5 * 1024 * 1024;

/** Max stderr bytes to buffer from a child process (2 MB). */
export const MAX_STDERR_BYTES = 2 * 1024 * 1024;

/**
 * Build an env object with NODE_OPTIONS capped to CHILD_MAX_OLD_SPACE_MB.
 * Merges with process.env and any extra env vars provided.
 */
export function buildMemoryEnv(extraEnv?: Record<string, string>): Record<string, string | undefined> {
  const flag = `--max-old-space-size=${CHILD_MAX_OLD_SPACE_MB}`;
  const existing = process.env.NODE_OPTIONS ?? "";

  // Replace existing --max-old-space-size or append
  let nodeOptions: string;
  if (/--max-old-space-size=\d+/.test(existing)) {
    nodeOptions = existing.replace(/--max-old-space-size=\d+/, flag);
  } else {
    nodeOptions = existing ? `${existing} ${flag}` : flag;
  }

  return {
    ...process.env,
    NODE_OPTIONS: nodeOptions,
    ...extraEnv,
  };
}
