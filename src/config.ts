import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import chalk from "chalk";
import type { AgentConfig } from "./agents.js";
import { builtinAgents } from "./agents.js";
import { discoverSkills, skillToAgentConfig } from "./skills.js";

export interface SkillsConfig {
  path?: string;
  disabled?: string[];
}

export interface ReygentConfig {
  agents?: AgentConfig[];
  skills?: SkillsConfig;
  model?: string;
}

/**
 * Resolve config from local .reygent/config.json or fall back to built-in agents.
 * Searches upward from cwd to find .reygent folder.
 */
export function loadConfig(): ReygentConfig {
  const localConfigPath = findLocalConfig(process.cwd());

  if (localConfigPath) {
    try {
      const raw = readFileSync(localConfigPath, "utf-8");
      const config: ReygentConfig = JSON.parse(raw);
      return {
        agents: config.agents ?? builtinAgents,
        skills: config.skills ?? {},
        model: config.model,
      };
    } catch (err) {
      throw new Error(
        `Failed to parse local config at ${localConfigPath}: ${(err as Error).message}`,
      );
    }
  }

  // No local config — use builtins
  return {
    agents: builtinAgents,
    skills: {},
  };
}

/**
 * Search upward from startDir to find .reygent/config.json
 */
function findLocalConfig(startDir: string): string | null {
  const configDir = findLocalConfigDir(startDir);
  if (!configDir) return null;
  const configPath = join(configDir, "config.json");
  return existsSync(configPath) ? configPath : null;
}

/**
 * Search upward from startDir to find .reygent/ directory.
 */
export function findLocalConfigDir(startDir: string): string | null {
  let currentDir = startDir;
  const root = "/";

  while (currentDir !== root) {
    const reygentDir = join(currentDir, ".reygent");
    if (existsSync(reygentDir)) {
      return reygentDir;
    }

    const parentDir = join(currentDir, "..");
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }

  return null;
}

/**
 * Resolve the global ~/.reygent directory path.
 */
export function resolveGlobalConfigDir(): string {
  return join(homedir(), ".reygent");
}

/**
 * Resolve skills directory for given scope.
 * Global always returns a path (~/.reygent/skills/).
 * Local returns null if no .reygent/ dir found.
 */
export function resolveSkillsDir(scope: "local" | "global"): string | null {
  if (scope === "global") {
    return join(resolveGlobalConfigDir(), "skills");
  }
  const configDir = findLocalConfigDir(process.cwd());
  if (!configDir) return null;
  const config = loadConfig();
  return resolveSkillsPath(config, configDir);
}

/**
 * Resolve skills directory path from config.
 */
export function resolveSkillsPath(config: ReygentConfig, configDir: string): string {
  const skillsRelPath = config.skills?.path ?? "skills";
  return join(configDir, skillsRelPath);
}

/**
 * Discover skills and convert to AgentConfig[].
 * Scans local skills first, then global ~/.reygent/skills/.
 * Local takes precedence over global on name conflict.
 */
export function getSkillsAsAgents(): AgentConfig[] {
  const config = loadConfig();
  const disabled = config.skills?.disabled ?? [];
  const seenNames = new Set<string>();
  const agents: AgentConfig[] = [];

  // Local skills
  const localConfigDir = findLocalConfigDir(process.cwd());
  if (localConfigDir) {
    const localSkillsPath = resolveSkillsPath(config, localConfigDir);
    const localManifests = discoverSkills(localSkillsPath);
    for (const m of localManifests) {
      if (disabled.includes(m.name)) continue;
      seenNames.add(m.name);
      agents.push(skillToAgentConfig(m));
    }
  }

  // Global skills
  const globalSkillsPath = join(resolveGlobalConfigDir(), "skills");
  const globalManifests = discoverSkills(globalSkillsPath);
  for (const m of globalManifests) {
    if (disabled.includes(m.name)) continue;
    if (seenNames.has(m.name)) continue; // local takes precedence
    agents.push(skillToAgentConfig(m));
  }

  return agents;
}

/**
 * Get resolved agents (local or builtin), merged with skills.
 */
export function getAgents(): AgentConfig[] {
  const config = loadConfig();
  const configAgents = config.agents ?? [];
  const skillAgents = getSkillsAsAgents();

  const configNames = new Set(configAgents.map((a) => a.name));
  const merged = [...configAgents];

  for (const skill of skillAgents) {
    if (configNames.has(skill.name)) {
      console.log(
        chalk.yellow(`Warning: skill "${skill.name}" shadowed by config agent with same name`),
      );
      continue;
    }
    merged.push(skill);
  }

  return merged;
}
