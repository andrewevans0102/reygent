import { execFile } from "node:child_process";
import { TaskError } from "./task.js";

/**
 * Execute a git command and return stdout.
 * Throws TaskError on failure.
 */
function exec(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { maxBuffer: 50 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new TaskError(
              `git-utils: command failed: ${cmd} ${args.join(" ")}\n${stderr || stdout || error.message}`,
            ),
          );
          return;
        }
        resolve(stdout);
      },
    );
  });
}

/**
 * Resolves the default branch for the origin remote.
 *
 * Tries multiple strategies in order:
 * 1. Read origin/HEAD symbolic ref (fast, no network)
 * 2. Query remote and set origin/HEAD (requires network)
 * 3. Probe common branch names locally (degraded fallback)
 *
 * @returns The default branch name (e.g., "main", "master")
 * @throws TaskError if no default branch can be determined
 */
export async function getDefaultBranch(): Promise<string> {
  // 1. Read the symbolic ref (no network)
  try {
    const ref = (
      await exec("git", ["symbolic-ref", "refs/remotes/origin/HEAD"])
    ).trim();
    return ref.replace("refs/remotes/origin/", "");
  } catch {
    // not set — try to set it from the remote
  }

  // 2. Ask the remote and set origin/HEAD, then re-read
  try {
    await exec("git", ["remote", "set-head", "origin", "-a"]);
    const ref = (
      await exec("git", ["symbolic-ref", "refs/remotes/origin/HEAD"])
    ).trim();
    return ref.replace("refs/remotes/origin/", "");
  } catch {
    // network/remote unavailable — fall through to local probe
  }

  // 3. Probe common default branch names — accept either a remote tracking
  //    ref or a local branch (some clones haven't fetched the default branch).
  //
  //    LIMITATION: This fallback could return an incorrect result if the local
  //    branch name differs from the remote default (e.g., local 'main' exists
  //    but remote default is 'master'). This is acceptable for a degraded state
  //    (no network + no origin/HEAD set) but won't match the actual remote default.
  for (const name of ["main", "master", "develop", "trunk"]) {
    try {
      await exec("git", ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${name}`]);
      return name;
    } catch {
      // try local
    }
    try {
      await exec("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${name}`]);
      return name;
    } catch {
      // try next candidate
    }
  }

  throw new TaskError(
    "git-utils: cannot determine default branch.\n" +
    "This usually means:\n" +
    "  1. No network connection to query the remote, OR\n" +
    "  2. origin/HEAD is not set and common branch names don't exist.\n" +
    "To fix: verify network connectivity, then run: git remote set-head origin -a",
  );
}
