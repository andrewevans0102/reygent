import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { select, confirm, input } from "@inquirer/prompts";
import { findLocalConfigDir } from "../config.js";
import type { ReygentConfig } from "../config.js";
import type { AgentConfig } from "../agents.js";
import { builtinAgents } from "../agents.js";
import { PROVIDER_NAMES, getProvider } from "../providers/index.js";
import { isDebug } from "../debug.js";

export async function configCommand(): Promise<void> {
  try {
    await runConfig();
  } catch (err) {
    // Ctrl+C from inquirer
    if (err && typeof err === "object" && "name" in err && (err as { name: string }).name === "ExitPromptError") {
      console.log(chalk.yellow("\nConfiguration cancelled."));
      process.exit(0);
    }
    throw err;
  }
}

async function runConfig(): Promise<void> {
  // 1. Find .reygent/ dir
  const configDir = findLocalConfigDir(process.cwd());
  if (!configDir) {
    console.log(chalk.red.bold("Error:"), "No .reygent/ directory found.");
    console.log(chalk.gray("  Run"), chalk.cyan("reygent init"), chalk.gray("first."));
    console.log("");
    process.exit(1);
  }

  const configPath = join(configDir, "config.json");

  // 2. Load raw JSON (preserve unknown fields)
  let rawConfig: Record<string, unknown>;
  try {
    rawConfig = JSON.parse(readFileSync(configPath, "utf-8"));
  } catch {
    console.log(chalk.red.bold("Error:"), `Failed to read ${configPath}`);
    process.exit(2);
  }

  const agents: AgentConfig[] = (rawConfig.agents as AgentConfig[] | undefined) ?? builtinAgents;

  // 3. Check provider availability
  const availability: Record<string, { available: boolean; reason?: string }> = {};
  for (const name of PROVIDER_NAMES) {
    const provider = getProvider(name);
    availability[name] = await provider.isAvailable();
  }

  // 4. Show current config
  const currentProvider = (rawConfig.provider as string | undefined) ?? "(not set)";
  const currentModel = (rawConfig.model as string | undefined) ?? "(not set)";
  console.log(chalk.bold("Current config:"));
  console.log(chalk.gray("  Provider:"), chalk.cyan(currentProvider));
  console.log(chalk.gray("  Model:   "), chalk.cyan(currentModel));
  console.log("");

  // 5. Select global provider
  const providerChoices = PROVIDER_NAMES.map((name) => {
    const status = availability[name];
    const badge = status?.available ? chalk.green("✓") : chalk.red("✗");
    const hint = !status?.available && status?.reason ? chalk.gray(` — ${status.reason}`) : "";
    return {
      name: `${badge} ${name}${hint}`,
      value: name,
    };
  });

  const selectedProvider = await select({
    message: "Global provider:",
    choices: providerChoices,
    default: rawConfig.provider as string | undefined,
  });

  // 6. Select global model
  const provider = getProvider(selectedProvider);
  let selectedModel: string;

  if (provider.supportedModels.length === 0) {
    // OpenRouter or similar — free-text input
    selectedModel = await input({
      message: "Model ID:",
      default: (rawConfig.model as string | undefined) ?? provider.defaultModel,
    });
  } else {
    const modelChoices = provider.supportedModels.map((m) => ({
      name: `${m.id} — ${m.label}`,
      value: m.id,
    }));
    selectedModel = await select({
      message: "Global model:",
      choices: modelChoices,
      default: (rawConfig.model as string | undefined) ?? provider.defaultModel,
    });
  }

  // 7. Per-agent overrides
  const updatedAgents = [...agents];
  for (let i = 0; i < updatedAgents.length; i++) {
    const agent = updatedAgents[i]!;
    const agentProvider = agent.provider ?? selectedProvider;
    const agentModel = agent.model ?? selectedModel;

    console.log("");
    console.log(chalk.bold(`Agent: ${agent.name}`), chalk.gray(`— ${agent.description}`));
    console.log(chalk.gray("  Provider:"), chalk.cyan(agentProvider));
    console.log(chalk.gray("  Model:   "), chalk.cyan(agentModel));

    const customize = await confirm({
      message: `Customize ${agent.name}?`,
      default: false,
    });

    if (!customize) continue;

    const agentProviderChoice = await select({
      message: `Provider for ${agent.name}:`,
      choices: providerChoices,
      default: agent.provider ?? selectedProvider,
    });

    const agentProviderAdapter = getProvider(agentProviderChoice);
    let agentModelChoice: string;

    if (agentProviderAdapter.supportedModels.length === 0) {
      agentModelChoice = await input({
        message: `Model ID for ${agent.name}:`,
        default: agent.model ?? agentProviderAdapter.defaultModel,
      });
    } else {
      const agentModelChoices = agentProviderAdapter.supportedModels.map((m) => ({
        name: `${m.id} — ${m.label}`,
        value: m.id,
      }));
      agentModelChoice = await select({
        message: `Model for ${agent.name}:`,
        choices: agentModelChoices,
        default: agent.model ?? agentProviderAdapter.defaultModel,
      });
    }

    updatedAgents[i] = { ...agent, provider: agentProviderChoice, model: agentModelChoice };
  }

  // 8. Merge into raw config (only touch provider, model, and agent provider/model)
  rawConfig.provider = selectedProvider;
  rawConfig.model = selectedModel;

  // If rawConfig had no agents array but we built one, set it
  if (!rawConfig.agents) {
    rawConfig.agents = updatedAgents;
  } else {
    // Update only provider/model on each agent, preserve everything else
    const rawAgents = rawConfig.agents as Record<string, unknown>[];
    for (let i = 0; i < rawAgents.length && i < updatedAgents.length; i++) {
      rawAgents[i]!.provider = updatedAgents[i]!.provider;
      rawAgents[i]!.model = updatedAgents[i]!.model;
    }
  }

  // 9. Write config
  try {
    writeFileSync(configPath, JSON.stringify(rawConfig, null, 2) + "\n", "utf-8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(chalk.red.bold("Error:"), `Failed to write config: ${message}`);
    if (isDebug()) console.error(err instanceof Error ? err.stack : err);
    process.exit(2);
  }

  // 10. Summary
  console.log("");
  console.log(chalk.green.bold("✓"), chalk.bold("Config updated"));
  console.log(chalk.gray("  Provider:"), chalk.cyan(selectedProvider));
  console.log(chalk.gray("  Model:   "), chalk.cyan(selectedModel));

  const overriddenAgents = updatedAgents.filter((a) => a.provider || a.model);
  if (overriddenAgents.length > 0) {
    console.log(chalk.gray("  Agent overrides:"));
    for (const a of overriddenAgents) {
      const parts: string[] = [];
      if (a.provider) parts.push(`provider=${a.provider}`);
      if (a.model) parts.push(`model=${a.model}`);
      console.log(chalk.gray(`    ${a.name}:`), chalk.cyan(parts.join(", ")));
    }
  }
  console.log("");
}
