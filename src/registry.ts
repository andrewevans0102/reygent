import { parseSkillMd } from "./skills.js";
import type { SkillManifest } from "./skills.js";

const REPO_OWNER = "andrewevans0102";
const REPO_NAME = "reygent-skills";
const API_BASE = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}`;
const RAW_BASE = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/main`;

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

interface GitHubContentEntry {
  name: string;
  path: string;
  type: "file" | "dir";
  download_url?: string;
}

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "reygent-cli",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function githubApiFetch(path: string): Promise<Response> {
  const url = `${API_BASE}/contents/${path}`;
  const res = await fetch(url, { headers: getHeaders() });

  if (res.status === 403) {
    const body = await res.text();
    if (body.includes("rate limit")) {
      throw new Error(
        "GitHub API rate limit exceeded. Set GITHUB_TOKEN env var for higher limits.",
      );
    }
    throw new Error(`GitHub API forbidden (403): ${body}`);
  }

  if (res.status === 404) {
    throw new Error(`Not found: ${path}`);
  }

  if (!res.ok) {
    throw new Error(`GitHub API error ${res.status}: ${await res.text()}`);
  }

  return res;
}

async function fetchRaw(path: string): Promise<string> {
  const url = `${RAW_BASE}/${path}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "reygent-cli" },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch ${path}: ${res.status}`);
  }

  return res.text();
}

/**
 * List all skills available in the remote registry.
 */
export async function listRemoteSkills(): Promise<RegistrySkillEntry[]> {
  const res = await githubApiFetch("");
  const entries: GitHubContentEntry[] = await res.json();
  const dirs = entries.filter((e) => e.type === "dir");

  const skills: RegistrySkillEntry[] = [];

  for (const dir of dirs) {
    try {
      const content = await fetchRaw(`${dir.name}/SKILL.md`);
      const manifest = parseSkillMd(content, dir.name);
      skills.push({
        name: manifest.name,
        description: manifest.description,
        license: manifest.license,
        compatibility: manifest.compatibility,
        version: manifest.metadata?.version,
      });
    } catch (err) {
      // Skip individual skill errors (missing SKILL.md, invalid manifest)
      // but rethrow network/rate-limit errors so they surface to user
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("rate limit") || msg.includes("GitHub API error")) {
        throw err;
      }
    }
  }

  return skills;
}

/**
 * Fetch SKILL.md manifest for a single skill.
 */
export async function fetchSkillManifest(skillName: string): Promise<SkillManifest> {
  const content = await fetchRaw(`${skillName}/SKILL.md`);
  return parseSkillMd(content, skillName);
}

/**
 * Fetch all files for a skill, recursing into subdirectories.
 */
export async function fetchSkillFiles(skillName: string): Promise<SkillFile[]> {
  const files: SkillFile[] = [];

  async function walkDir(dirPath: string): Promise<void> {
    const res = await githubApiFetch(dirPath);
    const entries: GitHubContentEntry[] = await res.json();

    for (const entry of entries) {
      if (entry.type === "file") {
        const content = await fetchRaw(entry.path);
        // Store path relative to skill root
        const relativePath = entry.path.slice(skillName.length + 1);
        files.push({ path: relativePath, content });
      } else if (entry.type === "dir") {
        await walkDir(entry.path);
      }
    }
  }

  await walkDir(skillName);
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
