import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { TaskContext } from "../task.js";

export interface RunSnapshotOptions {
  autoApprove: boolean;
  skipClarification: boolean;
  maxRetries: string;
  securityThreshold: string;
  insecure: boolean;
  verbose: boolean;
  type?: string;
}

export interface RunSnapshot {
  runId: string;
  startedAt: number;
  updatedAt: number;
  specSource: string;
  specTitle: string;
  runOptions: RunSnapshotOptions;
  completedStages: string[];
  failedStage?: string;
  lastError?: string;
  context: TaskContext;
}

const PR_REVIEW_STAGE = "pr-review";

export function getRunsDir(projectRoot: string): string {
  return join(projectRoot, ".reygent", "runs");
}

function snapshotPath(projectRoot: string, runId: string): string {
  return join(getRunsDir(projectRoot), `${runId}.json`);
}

export function saveSnapshot(projectRoot: string, snapshot: RunSnapshot): void {
  const dir = getRunsDir(projectRoot);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const finalPath = snapshotPath(projectRoot, snapshot.runId);
  const tmpPath = `${finalPath}.${randomUUID()}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(snapshot, null, 2), "utf-8");
  renameSync(tmpPath, finalPath);
}

export function loadSnapshot(projectRoot: string, runId: string): RunSnapshot | null {
  const path = snapshotPath(projectRoot, runId);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as RunSnapshot;
  } catch {
    return null;
  }
}

export function deleteSnapshot(projectRoot: string, runId: string): void {
  const path = snapshotPath(projectRoot, runId);
  if (!existsSync(path)) return;
  try {
    rmSync(path);
  } catch {
    // Best-effort cleanup
  }
}

function isUnfinished(snapshot: RunSnapshot): boolean {
  if (snapshot.failedStage) return true;
  const last = snapshot.completedStages[snapshot.completedStages.length - 1];
  return last !== PR_REVIEW_STAGE;
}

export function listUnfinishedSnapshots(projectRoot: string): RunSnapshot[] {
  const dir = getRunsDir(projectRoot);
  if (!existsSync(dir)) return [];

  const entries: RunSnapshot[] = [];
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return [];
  }

  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const runId = file.slice(0, -".json".length);
    const snapshot = loadSnapshot(projectRoot, runId);
    if (!snapshot) continue;
    if (!isUnfinished(snapshot)) continue;
    entries.push(snapshot);
  }

  entries.sort((a, b) => b.updatedAt - a.updatedAt);
  return entries;
}
