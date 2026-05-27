/** Memory caps for spawned child processes and reygent itself. */

/** Max V8 old-space for each spawned CLI child (MB). */
export const CHILD_MAX_OLD_SPACE_MB = 256;

/** Max V8 old-space for reygent's own process (MB). */
export const REYGENT_MAX_OLD_SPACE_MB = 256;

/** Max stdout bytes to buffer from a child process (5 MB). */
export const MAX_STDOUT_BYTES = 5 * 1024 * 1024;

/** Max stderr bytes to buffer from a child process (2 MB). */
export const MAX_STDERR_BYTES = 2 * 1024 * 1024;

/**
 * Build env object that caps heap for the child AND its grandchildren.
 * Sets NODE_OPTIONS with --max-old-space-size so every node process in
 * the tree (CLI tool, tsc, vitest, jest, etc.) gets the same heap cap.
 * The direct child also gets the cap reinforced via buildMemorySpawn shell wrapper.
 */
export function buildMemoryEnv(extraEnv?: Record<string, string>): Record<string, string | undefined> {
  // Strip any existing old-space flags, then re-add our cap.
  const existing = process.env.NODE_OPTIONS ?? "";
  const cleaned = existing.replace(/--max-old-space-size=\d+/g, "").trim();
  const heapFlag = `--max-old-space-size=${CHILD_MAX_OLD_SPACE_MB}`;
  const nodeOptions = cleaned ? `${heapFlag} ${cleaned}` : heapFlag;

  return {
    ...process.env,
    NODE_OPTIONS: nodeOptions,
    // Cap worker/thread counts for common test runners, bundlers, and Node tools
    // to prevent process explosion when multiple agents run in parallel.
    VITEST_MAX_THREADS: "1",
    VITEST_MIN_THREADS: "1",
    JEST_WORKERS: "1",
    NODE_TEST_WORKERS: "1",
    UV_THREADPOOL_SIZE: "2",
    PARCEL_WORKERS: "1",
    MAKEFLAGS: "-j1",
    CONCURRENT: "1",
    ...extraEnv,
  };
}

/**
 * Build spawn args that cap the direct child via shell wrapper.
 * Runs: `sh -c 'NODE_OPTIONS="--max-old-space-size=256 $NODE_OPTIONS" exec <cmd> "$@"'`
 * The exec'd process gets the cap; its children also inherit the cap from buildMemoryEnv.
 */
export function buildMemorySpawn(
  cmd: string,
  args: string[],
): { file: string; args: string[] } {
  const flag = `--max-old-space-size=${CHILD_MAX_OLD_SPACE_MB}`;
  // Shell inline: set NODE_OPTIONS for just the exec'd process, then exec replaces the shell
  // so only the direct child gets the flag. Children it spawns inherit the outer env (no flag).
  const escapedArgs = args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ");

  // On linux, apply OS-level ulimits before exec.
  // Note: ulimit -v (virtual address space) is intentionally omitted — V8's pointer-compression
  // cage reserves ~4GB VA on aarch64/linux regardless of actual heap usage, so any reasonable
  // -v cap kills the process before it starts. Actual memory is bounded by --max-old-space-size.
  // -t: CPU time 900s (matches AGENT_TIMEOUT_MS ~15min)
  // -f: max file size 100MB (prevent runaway writes)
  const ulimits =
    process.platform !== "win32"
      ? "ulimit -t 900 2>/dev/null; ulimit -f $((100 * 1024)) 2>/dev/null; "
      : "";

  return {
    file: "sh",
    args: ["-c", `${ulimits}NODE_OPTIONS="${flag} $NODE_OPTIONS" exec ${cmd} ${escapedArgs}`],
  };
}
