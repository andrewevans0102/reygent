import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import ora from "ora";
import { builtinAgents } from "../agents.js";
import type { ReygentConfig } from "../config.js";

export async function initCommand(): Promise<void> {
  const targetDir = join(process.cwd(), ".reygent");
  const configPath = join(targetDir, "config.json");

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

    // Write default config with all builtin agents
    const defaultConfig: ReygentConfig = {
      agents: builtinAgents,
      skills: {},
    };

    writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2) + "\n", "utf-8");

    spinner.succeed(chalk.green("Initialized .reygent folder"));

    console.log("");
    console.log(chalk.bold("Next steps:"));
    console.log(chalk.gray("  • Edit"), chalk.cyan(".reygent/config.json"), chalk.gray("to customize agents"));
    console.log(chalk.gray("  • Add custom agents to the"), chalk.cyan("agents"), chalk.gray("array"));
    console.log(chalk.gray("  • Run"), chalk.cyan("reygent agent <name>"), chalk.gray("to use your local config"));
    console.log("");
  } catch (err) {
    spinner.fail(chalk.red(`Failed: ${(err as Error).message}`));
    process.exit(1);
  }
}
