/** Memory caps for spawned child processes and reygent itself. */

/** Max V8 old-space for each spawned CLI child (MB). */
export const CHILD_MAX_OLD_SPACE_MB = 512;

/** Max V8 old-space for reygent's own process (MB). */
export const REYGENT_MAX_OLD_SPACE_MB = 256;

/** Max stdout bytes to buffer from a child process (5 MB). */
export const MAX_STDOUT_BYTES = 5 * 1024 * 1024;

/** Max stderr bytes to buffer from a child process (2 MB). */
export const MAX_STDERR_BYTES = 2 * 1024 * 1024;

/**
 * Build env object that caps ONLY the direct child's heap.
 * Strips --max-old-space-size from NODE_OPTIONS so grandchildren
 * (tool subprocesses, LSP, etc.) inherit a clean env and use V8 defaults.
 */
export function buildMemoryEnv(extraEnv?: Record<string, string>): Record<string, string | undefined> {
  // Preserve any existing NODE_OPTIONS but strip old-space flags —
  // we'll apply the cap via the shell wrapper, not NODE_OPTIONS.
  const existing = process.env.NODE_OPTIONS ?? "";
  const cleaned = existing.replace(/--max-old-space-size=\d+/g, "").trim();

  return {
    ...process.env,
    ...(cleaned ? { NODE_OPTIONS: cleaned } : { NODE_OPTIONS: undefined }),
    ...extraEnv,
  };
}

/**
 * Build spawn args that cap only the direct child via shell wrapper.
 * Runs: `sh -c 'NODE_OPTIONS="--max-old-space-size=512 $NODE_OPTIONS" exec <cmd> "$@"'`
 * The exec'd process gets the cap; its children inherit the clean env from buildMemoryEnv.
 */
export function buildMemorySpawn(
  cmd: string,
  args: string[],
): { file: string; args: string[] } {
  const flag = `--max-old-space-size=${CHILD_MAX_OLD_SPACE_MB}`;
  // Shell inline: set NODE_OPTIONS for just the exec'd process, then exec replaces the shell
  // so only the direct child gets the flag. Children it spawns inherit the outer env (no flag).
  const escapedArgs = args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ");
  return {
    file: "sh",
    args: ["-c", `NODE_OPTIONS="${flag} $NODE_OPTIONS" exec ${cmd} ${escapedArgs}`],
  };
}
