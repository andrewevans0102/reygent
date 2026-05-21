import type { ChildProcess } from "node:child_process";

const activeChildProcesses = new Set<ChildProcess>();

export function registerChildProcess(child: ChildProcess): void {
  activeChildProcesses.add(child);
  child.on("close", () => {
    activeChildProcesses.delete(child);
  });
  child.on("error", () => {
    activeChildProcesses.delete(child);
  });
}

export function killAllChildrenProcesses(): void {
  for (const child of activeChildProcesses) {
    try {
      child.kill("SIGTERM");
    } catch {
      // Already dead — ignore
    }
  }

  // Escalate to SIGKILL after 500ms for any survivors
  if (activeChildProcesses.size > 0) {
    const remaining = new Set(activeChildProcesses);
    setTimeout(() => {
      for (const child of remaining) {
        if (!child.killed) {
          try {
            child.kill("SIGKILL");
          } catch {
            // Already dead — ignore
          }
        }
      }
    }, 500).unref();
  }

  activeChildProcesses.clear();
}

// Kill orphaned child processes on any exit path
process.on("exit", () => {
  killAllChildrenProcesses();
});

// Handle SIGINT (Ctrl+C) and SIGTERM
process.on("SIGINT", () => {
  killAllChildrenProcesses();
  process.exit(130); // Standard exit code for SIGINT
});

process.on("SIGTERM", () => {
  killAllChildrenProcesses();
  process.exit(143); // Standard exit code for SIGTERM
});
