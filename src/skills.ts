import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type { AgentConfig } from "./agents.js";

export interface SkillManifest {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  allowedTools?: string[];
  body: string;
  skillPath: string;
}

const SKILL_NAME_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const MAX_SKILL_NAME_LENGTH = 64;

/**
 * Validate skill name: lowercase, hyphens, 1-64 chars,
 * no consecutive/leading/trailing hyphens.
 */
export function validateSkillName(name: string): boolean {
  if (!name || name.length > MAX_SKILL_NAME_LENGTH) return false;
  if (name.includes("--")) return false;
  return SKILL_NAME_RE.test(name);
}

/**
 * Parse SKILL.md content into a SkillManifest.
 * Expects YAML frontmatter delimited by --- lines.
 */
export function parseSkillMd(content: string, skillPath: string): SkillManifest {
  const trimmed = content.trim();
  if (!trimmed.startsWith("---")) {
    throw new Error("SKILL.md must start with YAML frontmatter (---)");
  }

  const endIndex = trimmed.indexOf("---", 3);
  if (endIndex === -1) {
    throw new Error("SKILL.md frontmatter missing closing ---");
  }

  const yamlStr = trimmed.slice(3, endIndex).trim();
  const body = trimmed.slice(endIndex + 3).trim();

  let frontmatter: Record<string, unknown>;
  try {
    frontmatter = parseYaml(yamlStr);
  } catch (err) {
    throw new Error(`Invalid YAML in SKILL.md frontmatter: ${(err as Error).message}`);
  }

  if (!frontmatter || typeof frontmatter !== "object") {
    throw new Error("SKILL.md frontmatter must be a YAML object");
  }

  const name = frontmatter.name;
  const description = frontmatter.description;

  if (typeof name !== "string" || !name) {
    throw new Error("SKILL.md frontmatter requires 'name' (string)");
  }
  if (typeof description !== "string" || !description) {
    throw new Error("SKILL.md frontmatter requires 'description' (string)");
  }

  if (!validateSkillName(name)) {
    throw new Error(
      `Invalid skill name "${name}": must be 1-64 lowercase chars, hyphens allowed (no consecutive/leading/trailing)`,
    );
  }

  // allowed-tools: spec uses space-separated string, but we also accept arrays
  const rawTools = frontmatter["allowed-tools"];
  let allowedTools: string[] | undefined;
  if (rawTools !== undefined) {
    if (typeof rawTools === "string") {
      allowedTools = rawTools.split(/\s+/).filter(Boolean);
    } else if (Array.isArray(rawTools)) {
      allowedTools = rawTools.map(String);
    } else {
      throw new Error("SKILL.md 'allowed-tools' must be a space-separated string or array");
    }
  }

  const metadata = frontmatter.metadata;
  if (metadata !== undefined && (typeof metadata !== "object" || metadata === null)) {
    throw new Error("SKILL.md 'metadata' must be an object");
  }

  return {
    name,
    description,
    license: typeof frontmatter.license === "string" ? frontmatter.license : undefined,
    compatibility: typeof frontmatter.compatibility === "string" ? frontmatter.compatibility : undefined,
    metadata: metadata as Record<string, string> | undefined,
    allowedTools: allowedTools as string[] | undefined,
    body,
    skillPath,
  };
}

/**
 * Strip tool qualifiers: "Bash(git:*)" → "bash", lowercase, dedup.
 */
export function mapToolNames(allowedTools: string[]): string[] {
  const mapped = allowedTools.map((tool) => {
    const parenIndex = tool.indexOf("(");
    const base = parenIndex !== -1 ? tool.slice(0, parenIndex) : tool;
    return base.toLowerCase().trim();
  });
  return [...new Set(mapped)];
}

/**
 * Load a single skill from a directory containing SKILL.md.
 */
export function loadSkillFromDirectory(dirPath: string): SkillManifest {
  const absPath = resolve(dirPath);
  const skillMdPath = join(absPath, "SKILL.md");

  if (!existsSync(skillMdPath)) {
    throw new Error(`No SKILL.md found in ${absPath}`);
  }

  const content = readFileSync(skillMdPath, "utf-8");
  const manifest = parseSkillMd(content, absPath);

  const dirName = basename(absPath);
  if (manifest.name !== dirName) {
    throw new Error(
      `Skill name "${manifest.name}" does not match directory name "${dirName}"`,
    );
  }

  return manifest;
}

/**
 * Scan a directory for subdirectories containing SKILL.md.
 * Returns all valid manifests, logs warnings for invalid ones.
 */
export function discoverSkills(skillsPath: string): SkillManifest[] {
  const absPath = resolve(skillsPath);

  if (!existsSync(absPath)) {
    return [];
  }

  const entries = readdirSync(absPath);
  const manifests: SkillManifest[] = [];

  for (const entry of entries) {
    const entryPath = join(absPath, entry);

    try {
      const stat = statSync(entryPath);
      if (!stat.isDirectory()) continue;
    } catch {
      continue;
    }

    const skillMdPath = join(entryPath, "SKILL.md");
    if (!existsSync(skillMdPath)) continue;

    try {
      const manifest = loadSkillFromDirectory(entryPath);
      manifests.push(manifest);
    } catch {
      // Skip invalid skills silently — config.ts handles warnings
    }
  }

  return manifests;
}

/**
 * Convert a SkillManifest to an AgentConfig.
 */
export function skillToAgentConfig(skill: SkillManifest): AgentConfig {
  const tools = skill.allowedTools ? mapToolNames(skill.allowedTools) : ["read"];
  const role = skill.metadata?.role ?? "skill";

  return {
    name: skill.name,
    description: skill.description,
    systemPrompt: skill.body,
    tools,
    role,
  };
}
