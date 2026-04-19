import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import ora from "ora";
import { builtinAgents } from "../agents.js";
import type { ReygentConfig } from "../config.js";
import { isDebug } from "../debug.js";

export async function initCommand(options: { dryRun: boolean } = { dryRun: false }): Promise<void> {
  const targetDir = join(process.cwd(), ".reygent");
  const configPath = join(targetDir, "config.json");

  const defaultConfig: ReygentConfig = {
    agents: builtinAgents,
    skills: {},
  };

  if (options.dryRun) {
    console.log(chalk.yellow.bold("[dry-run]"), "No changes will be made.\n");
    console.log(chalk.bold("Would create:"));
    console.log(chalk.gray("  dir:  "), chalk.cyan(targetDir));
    console.log(chalk.gray("  file: "), chalk.cyan(configPath));
    console.log("");
    console.log(chalk.bold("Config preview:"));
    console.log(chalk.gray(JSON.stringify(defaultConfig, null, 2)));
    console.log("");
    return;
  }

  if (existsSync(targetDir)) {
    console.log(chalk.yellow.bold("Warning:"), `.reygent folder already exists`);
    console.log(chalk.gray(`  Path: ${targetDir}\n`));

    if (existsSync(configPath)) {
      console.log(chalk.cyan("Existing config found. Skipping initialization.\n"));
      return;
    }

    console.log(chalk.cyan("No config.json found. Creating default config...\n"));
  }

  const spinner = ora("Creating .reygent folder").start();

  try {
    // Create folder
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }

    writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2) + "\n", "utf-8");

    spinner.succeed(chalk.green("Initialized .reygent folder"));

    console.log("");
    console.log(chalk.bold("Next steps:"));
    console.log(chalk.gray("  • Edit"), chalk.cyan(".reygent/config.json"), chalk.gray("to customize agents"));
    console.log(chalk.gray("  • Add custom agents to the"), chalk.cyan("agents"), chalk.gray("array"));
    console.log(chalk.gray("  • Run"), chalk.cyan("reygent agent <name>"), chalk.gray("to use your local config"));
    console.log("");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    spinner.fail(chalk.red(`Failed: ${message}`));
    if (isDebug()) console.error(err instanceof Error ? err.stack : err);
    process.exit(2);
  }
}
