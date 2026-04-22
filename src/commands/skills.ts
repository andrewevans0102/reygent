import { Command } from "commander";
import { existsSync, mkdirSync, writeFileSync, rmSync, readdirSync, statSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import ora from "ora";
import { validateSkillName } from "../skills.js";
import { findLocalConfigDir, resolveGlobalConfigDir, resolveSkillsDir } from "../config.js";
import {
  listRemoteSkills,
  fetchSkillManifest,
  fetchSkillFiles,
  checkCompatibility,
} from "../registry.js";
import { isDebug } from "../debug.js";

function getVersion(): string {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(join(__dirname, "..", "..", "package.json"), "utf-8"));
  return pkg.version;
}

function scanInstalledDir(dir: string, names: Set<string>): void {
  if (!existsSync(dir)) return;
  try {
    for (const entry of readdirSync(dir)) {
      const entryPath = join(dir, entry);
      try {
        if (statSync(entryPath).isDirectory() && existsSync(join(entryPath, "SKILL.md"))) {
          names.add(entry);
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
}

function getInstalledSkillNames(): Set<string> {
  const names = new Set<string>();
  const localDir = resolveSkillsDir("local");
  if (localDir) scanInstalledDir(localDir, names);
  const globalDir = resolveSkillsDir("global");
  if (globalDir) scanInstalledDir(globalDir, names);
  return names;
}

async function listAction(): Promise<void> {
  const spinner = ora("Fetching skills from registry...").start();

  try {
    const skills = await listRemoteSkills();
    const installed = getInstalledSkillNames();

    spinner.succeed(chalk.green(`Found ${skills.length} skill${skills.length !== 1 ? "s" : ""}`));
    console.log("");

    if (skills.length === 0) {
      console.log(chalk.gray("  No skills available in registry."));
      console.log("");
      return;
    }

    for (const skill of skills) {
      const badge = installed.has(skill.name) ? chalk.green(" [installed]") : "";
      const version = skill.version ? chalk.gray(` v${skill.version}`) : "";
      console.log(`  ${chalk.bold.cyan(skill.name)}${version}${badge}`);
      console.log(`  ${skill.description}`);
      if (skill.license) {
        console.log(`  ${chalk.gray(`License: ${skill.license}`)}`);
      }
      console.log("");
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    spinner.fail(chalk.red(`Failed to fetch skills: ${message}`));
    if (isDebug()) console.error(err instanceof Error ? err.stack : err);
    process.exit(2);
  }
}

async function addAction(name: string, options: { global: boolean }): Promise<void> {
  if (!validateSkillName(name)) {
    console.log(chalk.red.bold("Error:"), `Invalid skill name "${name}"`);
    process.exit(1);
  }

  // Resolve target directory
  let targetBase: string;
  if (options.global) {
    targetBase = join(resolveGlobalConfigDir(), "skills");
  } else {
    const localConfigDir = findLocalConfigDir(process.cwd());
    if (!localConfigDir) {
      console.log(chalk.red.bold("Error:"), "No .reygent/ directory found.");
      console.log(chalk.gray("  Run"), chalk.cyan("reygent init"), chalk.gray("first, or use"), chalk.cyan("--global"));
      process.exit(1);
    }
    targetBase = join(localConfigDir, "skills");
  }

  const targetDir = join(targetBase, name);

  if (existsSync(targetDir)) {
    console.log(chalk.red.bold("Error:"), `Skill "${name}" already installed at ${targetDir}`);
    process.exit(1);
  }

  const spinner = ora(`Installing ${name}...`).start();

  try {
    // Fetch manifest for compatibility check
    spinner.text = `Checking compatibility for ${name}...`;
    const manifest = await fetchSkillManifest(name);
    const version = getVersion();
    const compatible = checkCompatibility(manifest.compatibility, version);

    if (!compatible) {
      spinner.warn(
        chalk.yellow(`Skill "${name}" requires ${manifest.compatibility}, you have v${version}`),
      );
      console.log(chalk.yellow("  Installing anyway — some features may not work.\n"));
      spinner.start(`Downloading ${name}...`);
    }

    // Fetch all files
    spinner.text = `Downloading ${name}...`;
    const files = await fetchSkillFiles(name);

    // Write files
    spinner.text = `Writing files...`;
    for (const file of files) {
      const filePath = join(targetDir, file.path);
      const fileDir = dirname(filePath);
      mkdirSync(fileDir, { recursive: true });
      writeFileSync(filePath, file.content, "utf-8");
    }

    spinner.succeed(chalk.green(`Installed "${name}" (${files.length} files)`));
    console.log("");
    console.log(chalk.gray("  Location:"), chalk.cyan(targetDir));
    console.log(chalk.gray("  Usage:   "), chalk.cyan(`reygent agent ${name}`));
    console.log("");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    spinner.fail(chalk.red(`Failed to install "${name}": ${message}`));
    if (isDebug()) console.error(err instanceof Error ? err.stack : err);
    process.exit(2);
  }
}

async function removeAction(name: string, options: { global: boolean }): Promise<void> {
  if (!validateSkillName(name)) {
    console.log(chalk.red.bold("Error:"), `Invalid skill name "${name}"`);
    process.exit(1);
  }

  let targetBase: string;
  if (options.global) {
    targetBase = join(resolveGlobalConfigDir(), "skills");
  } else {
    const localConfigDir = findLocalConfigDir(process.cwd());
    if (!localConfigDir) {
      console.log(chalk.red.bold("Error:"), "No .reygent/ directory found.");
      process.exit(1);
    }
    targetBase = join(localConfigDir, "skills");
  }

  const targetDir = join(targetBase, name);

  if (!existsSync(targetDir)) {
    console.log(chalk.red.bold("Error:"), `Skill "${name}" not found at ${targetDir}`);
    process.exit(1);
  }

  rmSync(targetDir, { recursive: true, force: true });
  console.log(chalk.green(`Removed "${name}" from ${targetDir}`));
}

export function registerSkillsCommand(program: Command): void {
  const skills = program
    .command("skills")
    .description("Manage skills from the reygent-skills registry");

  skills
    .command("list")
    .description("List available skills in the registry")
    .action(listAction);

  skills
    .command("add")
    .description("Install a skill from the registry")
    .argument("<name>", "Skill name to install")
    .option("--global", "Install to ~/.reygent/skills/ instead of local", false)
    .action(addAction);

  skills
    .command("remove")
    .description("Remove an installed skill")
    .argument("<name>", "Skill name to remove")
    .option("--global", "Remove from ~/.reygent/skills/ instead of local", false)
    .action(removeAction);
}
