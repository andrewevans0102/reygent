import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
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
 * Resolve skills directory path from config.
 */
export function resolveSkillsPath(config: ReygentConfig, configDir: string): string {
  const skillsRelPath = config.skills?.path ?? "skills";
  return join(configDir, skillsRelPath);
}

/**
 * Discover skills and convert to AgentConfig[].
 */
export function getSkillsAsAgents(): AgentConfig[] {
  const configDir = findLocalConfigDir(process.cwd());
  if (!configDir) return [];

  const config = loadConfig();
  const skillsPath = resolveSkillsPath(config, configDir);
  const manifests = discoverSkills(skillsPath);
  const disabled = config.skills?.disabled ?? [];

  return manifests
    .filter((m) => !disabled.includes(m.name))
    .map(skillToAgentConfig);
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
