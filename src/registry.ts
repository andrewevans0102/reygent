import { execFileSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { parseSkillMd } from "./skills.js";
import type { SkillManifest } from "./skills.js";
import { resolveGlobalConfigDir } from "./config.js";

const REGISTRY_REPO_URL = "https://github.com/andrewevans0102/reygent-skills.git";

export interface RegistrySkillEntry {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  version?: string;
}

export interface SkillFile {
  path: string;
  content: string;
}

/**
 * Path to the local registry cache directory.
 */
function getCacheDir(): string {
  return join(resolveGlobalConfigDir(), "cache", "registry");
}

/**
 * Run a git command, throwing a clear error if git is not installed.
 */
function runGit(args: string[], cwd?: string): string {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err: unknown) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === "ENOENT") {
      throw new Error(
        "Git is not installed or not found in PATH. Install git to use the skills registry.",
      );
    }
    throw err;
  }
}

/**
 * Ensure registry cache exists and is up to date.
 * Always attempts a fresh pull when called — this should only be
 * triggered by explicit user interaction (skills list/add/remove).
 * Falls back to stale cache if pull fails (offline, etc.).
 */
function ensureCache(): string {
  const cacheDir = getCacheDir();
  const gitDir = join(cacheDir, ".git");

  if (!existsSync(gitDir)) {
    // First time — clone
    const parentDir = join(cacheDir, "..");
    mkdirSync(parentDir, { recursive: true });
    runGit(["clone", "--depth", "1", REGISTRY_REPO_URL, cacheDir]);
    return cacheDir;
  }

  // Pull latest on every explicit skills command
  try {
    runGit(["pull", "--ff-only"], cacheDir);
  } catch {
    // Offline or conflict — use existing cache silently
  }

  return cacheDir;
}

/**
 * List all skills available in the remote registry.
 */
export async function listRemoteSkills(): Promise<RegistrySkillEntry[]> {
  const cacheDir = ensureCache();
  const entries = readdirSync(cacheDir);
  const skills: RegistrySkillEntry[] = [];

  for (const entry of entries) {
    if (entry.startsWith(".")) continue;

    const entryPath = join(cacheDir, entry);
    if (!statSync(entryPath).isDirectory()) continue;

    const skillMdPath = join(entryPath, "SKILL.md");
    if (!existsSync(skillMdPath)) continue;

    try {
      const content = readFileSync(skillMdPath, "utf-8");
      const manifest = parseSkillMd(content, entry);
      skills.push({
        name: manifest.name,
        description: manifest.description,
        license: manifest.license,
        compatibility: manifest.compatibility,
        version: manifest.metadata?.version,
      });
    } catch {
      // Skip skills with invalid SKILL.md
    }
  }

  return skills;
}

/**
 * Fetch SKILL.md manifest for a single skill.
 */
export async function fetchSkillManifest(skillName: string): Promise<SkillManifest> {
  const cacheDir = ensureCache();
  const skillMdPath = join(cacheDir, skillName, "SKILL.md");

  if (!existsSync(skillMdPath)) {
    throw new Error(`Skill not found in registry: ${skillName}`);
  }

  const content = readFileSync(skillMdPath, "utf-8");
  return parseSkillMd(content, skillName);
}

/**
 * Fetch all files for a skill, recursing into subdirectories.
 */
export async function fetchSkillFiles(skillName: string): Promise<SkillFile[]> {
  const cacheDir = ensureCache();
  const skillDir = join(cacheDir, skillName);

  if (!existsSync(skillDir) || !statSync(skillDir).isDirectory()) {
    throw new Error(`Skill not found in registry: ${skillName}`);
  }

  const files: SkillFile[] = [];

  function walkDir(dir: string, prefix: string): void {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      if (entry.startsWith(".")) continue;
      const fullPath = join(dir, entry);
      const relativePath = prefix ? `${prefix}/${entry}` : entry;

      if (statSync(fullPath).isDirectory()) {
        walkDir(fullPath, relativePath);
      } else {
        files.push({
          path: relativePath,
          content: readFileSync(fullPath, "utf-8"),
        });
      }
    }
  }

  walkDir(skillDir, "");
  return files;
}

/**
 * Check if a compatibility string (e.g. ">=0.1.0") is satisfied by reygentVersion.
 * Only supports >=X.Y.Z format. Undefined compatibility = always compatible.
 */
export function checkCompatibility(
  compatibility: string | undefined,
  reygentVersion: string,
): boolean {
  if (!compatibility) return true;

  const match = compatibility.match(/^>=\s*(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return true; // Unknown format — assume compatible

  const [, reqMajor, reqMinor, reqPatch] = match.map(Number);
  const verMatch = reygentVersion.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!verMatch) return true;

  const [, curMajor, curMinor, curPatch] = verMatch.map(Number);

  if (curMajor !== reqMajor) return curMajor > reqMajor;
  if (curMinor !== reqMinor) return curMinor > reqMinor;
  return curPatch >= reqPatch;
}
