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
      child.kill("SIGTERM");
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
