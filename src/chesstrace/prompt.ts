import { existsSync, readFileSync, writeFileSync, mkdirSync, lstatSync, renameSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { confirm } from "@inquirer/prompts";
import chalk from "chalk";
import { findLocalConfigDir, resolveGlobalConfigPath } from "../config.js";
import type { ReygentConfig } from "../config.js";
import { isDebug } from "../debug.js";

/**
 * Check if telemetry opt-in prompt should be shown.
 *
 * CRITICAL: This function REQUIRES a TTY (interactive terminal). It will never
 * prompt in non-interactive environments (CI, piped input, automated scripts).
 *
 * Returns true when:
 * 1. stdin is a TTY (interactive terminal)
 * 2. telemetry.enabled is undefined in config
 *
 * Returns false in all other cases, including non-TTY environments.
 */
export function shouldPromptForTelemetry(): boolean {
  // CRITICAL: Never prompt in non-TTY environments (CI, piped input, etc.)
  if (!process.stdin.isTTY) {
    return false;
  }

  // Find config path (local takes precedence)
  const localConfigDir = findLocalConfigDir(process.cwd());
  let configPath: string | null = null;

  if (localConfigDir) {
    const localPath = join(localConfigDir, "config.json");
    if (existsSync(localPath)) {
      configPath = localPath;
    }
  }

  if (!configPath) {
    const globalPath = resolveGlobalConfigPath();
    if (existsSync(globalPath)) {
      configPath = globalPath;
    }
  }

  // No config file exists → enabled is undefined → should prompt
  if (!configPath) {
    return true;
  }

  // Read config to check telemetry.enabled
  try {
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw) as ReygentConfig;

    // Prompt if telemetry field missing or enabled is undefined
    if (!parsed.telemetry || parsed.telemetry.enabled === undefined) {
      return true;
    }

    return false;
  } catch (err) {
    // If config parse fails, prompt user to regenerate valid config
    if (isDebug()) {
      console.error(chalk.gray(`Failed to read config at ${configPath}:`), err);
    }
    return true;
  }
}

/**
 * Prompt user to opt into telemetry and save choice to config.
 * Saves to local config if .reygent/ dir exists, else global.
 */
export async function promptForTelemetryOptIn(): Promise<void> {
  console.log("");
  console.log(chalk.bold("First-run telemetry setup"));
  console.log(chalk.gray("Reygent can collect local usage data to help diagnose issues."));
  console.log(chalk.gray("Data is stored locally in SQLite and never sent to external servers."));
  console.log("");

  const enabled = await confirm({
    message: "Enable local telemetry?",
    default: false,
  });

  await saveTelemetryChoice(enabled);

  console.log("");
  if (enabled) {
    console.log(chalk.green("✓"), "Local telemetry enabled");
  } else {
    console.log(chalk.gray("✓"), "Local telemetry disabled");
  }
  console.log("");
}

/**
 * Save telemetry choice to config (local if exists, else global).
 */
async function saveTelemetryChoice(enabled: boolean): Promise<void> {
  const localConfigDir = findLocalConfigDir(process.cwd());
  let configPath: string;
  let configDir: string;

  if (localConfigDir) {
    configPath = join(localConfigDir, "config.json");
    configDir = localConfigDir;
  } else {
    configPath = resolveGlobalConfigPath();
    configDir = dirname(configPath);
    mkdirSync(configDir, { recursive: true });
  }

  // Load existing config or create new one
  let rawConfig: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      const content = readFileSync(configPath, "utf-8");
      rawConfig = JSON.parse(content);
    } catch (err) {
      if (isDebug()) {
        console.error(chalk.gray(`Failed to parse config at ${configPath}:`), err);
      }
      // Continue with empty config
    }
  }

  // Merge telemetry.enabled into config
  const telemetry = (rawConfig.telemetry as Record<string, unknown> | undefined) ?? {};
  telemetry.enabled = enabled;

  // Apply defaults if missing
  telemetry.level = telemetry.level ?? "standard";
  telemetry.backend = telemetry.backend ?? "sqlite";
  telemetry.retention = telemetry.retention ?? 30;

  rawConfig.telemetry = telemetry;

  // Atomic write
  try {
    const tempPath = `${configPath}.tmp.${randomBytes(8).toString("hex")}`;

    try {
      writeFileSync(tempPath, JSON.stringify(rawConfig, null, 2) + "\n", "utf-8");

      // Security: verify temp file is not symlink
      const tempStats = lstatSync(tempPath);
      if (tempStats.isSymbolicLink()) {
        unlinkSync(tempPath);
        throw new Error("Security: temp file became symlink");
      }

      renameSync(tempPath, configPath);
    } catch (err) {
      // Clean up temp file on error
      try {
        unlinkSync(tempPath);
      } catch {
        // Ignore cleanup errors
      }
      throw err;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(chalk.yellow("Warning:"), `Failed to save telemetry config: ${message}`);
    if (isDebug()) console.error(err instanceof Error ? err.stack : err);
    console.log(chalk.gray("Command will continue without saving telemetry preference."));
    // Don't throw - allow command execution to continue
  }
}
