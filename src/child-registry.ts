import type { ChildProcess } from "node:child_process";

const activeChildren = new Set<ChildProcess>();

export function registerChild(child: ChildProcess): void {
  activeChildren.add(child);
  child.on("close", () => {
    activeChildren.delete(child);
  });
  child.on("error", () => {
    activeChildren.delete(child);
  });
}

export function killAllChildren(): void {
  for (const child of activeChildren) {
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
  activeChildren.clear();
}

// Kill orphaned children on any exit path
process.on("exit", () => {
  killAllChildren();
});

// Handle SIGINT (Ctrl+C) and SIGTERM
process.on("SIGINT", () => {
  killAllChildren();
  process.exit(130); // Standard exit code for SIGINT
});

process.on("SIGTERM", () => {
  killAllChildren();
  process.exit(143); // Standard exit code for SIGTERM
});
