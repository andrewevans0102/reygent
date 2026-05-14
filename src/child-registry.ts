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
      // Kill entire process group to catch spawned descendants (e.g., vitest)
      if (child.pid && process.platform !== "win32") {
        process.kill(-child.pid, "SIGTERM");
      } else {
        child.kill("SIGTERM");
      }
    } catch {
      // Already dead — ignore
    }
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
