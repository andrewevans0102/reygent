import { existsSync, readFileSync, writeFileSync, mkdirSync, lstatSync, renameSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomBytes } from "node:crypto";
import chalk from "chalk";
import { select, confirm } from "@inquirer/prompts";
import { pasteableInput } from "../pasteable-input.js";
import { findLocalConfigDir, resolveGlobalConfigPath } from "../config.js";
import type { ReygentConfig } from "../config.js";
import type { AgentConfig } from "../agents.js";
import { builtinAgents } from "../agents.js";
import { PROVIDER_NAMES, getProvider } from "../providers/index.js";
import { isDebug } from "../debug.js";
import { resetTerminalForInput } from "../terminal-reset.js";

/** Agent categories for grouped display */
const AGENT_CATEGORIES: { label: string; color: (s: string) => string; roles: string[] }[] = [
  {
    label: "Development",
    color: chalk.blue,
    roles: ["developer", "general"],
  },
  {
    label: "Testing & Review",
    color: chalk.magenta,
    roles: ["quality-engineer", "security-reviewer", "reviewer"],
  },
  {
    label: "Planning",
    color: chalk.yellow,
    roles: ["planner"],
  },
];

interface AgentGroup {
  label: string;
  color: (s: string) => string;
  agentIndices: number[];
}

function categorizeAgents(agents: AgentConfig[]): AgentGroup[] {
  const groups: AgentGroup[] = [];
  const assigned = new Set<number>();

  for (const category of AGENT_CATEGORIES) {
    const indices: number[] = [];
    for (let i = 0; i < agents.length; i++) {
      if (assigned.has(i)) continue;
      if (category.roles.includes(agents[i]!.role)) {
        indices.push(i);
        assigned.add(i);
      }
    }
    if (indices.length > 0) {
      groups.push({
        label: category.label,
        color: category.color,
        agentIndices: indices,
      });
    }
  }

  // Uncategorized agents go into "Other"
  const remaining: number[] = [];
  for (let i = 0; i < agents.length; i++) {
    if (!assigned.has(i)) remaining.push(i);
  }
  if (remaining.length > 0) {
    groups.push({
      label: "Other",
      color: chalk.gray,
      agentIndices: remaining,
    });
  }

  return groups;
}

/** Map role to a colored badge string */
function roleBadge(role: string): string {
  const badges: Record<string, (s: string) => string> = {
    "developer": chalk.bgBlue.white,
    "general": chalk.bgBlue.white,
    "quality-engineer": chalk.bgMagenta.white,
    "security-reviewer": chalk.bgRed.white,
    "reviewer": chalk.bgMagenta.white,
    "planner": chalk.bgYellow.black,
  };
  const colorFn = badges[role] ?? chalk.bgGray.white;
  return colorFn(` ${role} `);
}

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
  // Check for interactive environment before prompting
  if (!process.stdin.isTTY) {
    console.log(chalk.red.bold("Error:"), "config command requires interactive mode.");
    console.log(chalk.gray("  Edit"), chalk.cyan(".reygent/config.json"), chalk.gray("or"), chalk.cyan("~/.reygent/config.json"), chalk.gray("directly."));
    process.exit(1);
  }

  // 1. Scope selection
  const scope = await select({
    message: "Configuration scope:",
    choices: [
      { name: `Local  ${chalk.gray("— .reygent/config.json (this project)")}`, value: "local" as const },
      { name: `Global ${chalk.gray("— ~/.reygent/config.json (all projects)")}`, value: "global" as const },
    ],
  });

  let configPath: string;

  if (scope === "local") {
    const configDir = findLocalConfigDir(process.cwd());
    if (!configDir) {
      console.log(chalk.red.bold("Error:"), "No .reygent/ directory found.");
      console.log(chalk.gray("  Run"), chalk.cyan("reygent init"), chalk.gray("first."));
      console.log("");
      process.exit(1);
    }
    configPath = join(configDir, "config.json");
  } else {
    configPath = resolveGlobalConfigPath();
    const globalDir = dirname(configPath);
    mkdirSync(globalDir, { recursive: true });
  }

  // 2. Load raw JSON (preserve unknown fields)
  let rawConfig: Record<string, unknown> = {};
  const fileExists = existsSync(configPath);

  if (fileExists) {
    try {
      const content = readFileSync(configPath, "utf-8");
      rawConfig = JSON.parse(content);
    } catch (err) {
      if (err instanceof SyntaxError) {
        console.log(chalk.red.bold("Error:"), `Invalid JSON in ${configPath}`);
        console.log(chalk.gray("  Parse error:"), err.message);
        process.exit(2);
      }
      if (err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "EACCES") {
        console.log(chalk.red.bold("Error:"), `Permission denied: ${configPath}`);
        process.exit(2);
      }
      console.log(chalk.red.bold("Error:"), `Failed to read ${configPath}`);
      if (isDebug()) console.error(err);
      process.exit(2);
    }
  } else {
    // Initialize empty config with sensible defaults
    rawConfig = {
      provider: "claude",
      model: "claude-sonnet-4-5",
    };
  }

  // Initialize agents array before loop to ensure it always exists in output
  rawConfig.agents = (rawConfig.agents as AgentConfig[] | undefined) ?? builtinAgents;
  const agents: AgentConfig[] = rawConfig.agents as AgentConfig[];

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
  console.log(chalk.gray("  Scope:   "), chalk.cyan(scope));
  console.log(chalk.gray("  Provider:"), chalk.cyan(currentProvider));
  console.log(chalk.gray("  Model:   "), chalk.cyan(currentModel));
  console.log("");

  // 5. Select default provider
  const providerChoices = PROVIDER_NAMES.map((name) => {
    const status = availability[name];
    const badge = status?.available ? chalk.green("✓") : chalk.red("✗");
    const hint = !status?.available && status?.reason ? chalk.gray(` — ${status.reason}`) : "";
    return {
      name: `${badge} ${name}${hint}`,
      value: name,
    };
  });

  resetTerminalForInput();
  let selectedProvider = await select({
    message: "Default provider:",
    choices: providerChoices,
    default: rawConfig.provider as string | undefined,
  });

  // Warn if selected provider unavailable
  if (!availability[selectedProvider]?.available) {
    const reason = availability[selectedProvider]?.reason ?? "unknown reason";
    console.log(chalk.yellow("⚠"), chalk.yellow(`Provider ${selectedProvider} is unavailable (${reason})`));
    resetTerminalForInput();
    const proceed = await confirm({
      message: "Continue with this provider anyway?",
      default: false,
    });
    if (!proceed) {
      console.log(chalk.yellow("\nConfiguration cancelled."));
      process.exit(0);
    }
  }

  // 6. Select default model
  const provider = getProvider(selectedProvider);
  let selectedModel: string;

  // Track platform choice per provider (vertex vs direct) so we don't re-ask within a single config run
  const vertexProviders = new Set<string>();
  const platformAskedProviders = new Set<string>();

  // Check if provider supports Vertex AI and ask platform preference
  let useVertexAi = false;
  if (provider.vertexModels && provider.vertexModels.length > 0) {
    resetTerminalForInput();
    const platform = await select({
      message: "API platform:",
      choices: [
        { name: "Direct API", value: "direct" as const },
        { name: `Google Vertex AI ${chalk.gray("— see https://platform.claude.com/docs/en/build-with-claude/claude-on-vertex-ai")}`, value: "vertex" as const },
      ],
    });
    useVertexAi = platform === "vertex";
    if (useVertexAi) vertexProviders.add(selectedProvider);
    platformAskedProviders.add(selectedProvider);
  }

  const modelList = useVertexAi ? (provider.vertexModels ?? []) : provider.supportedModels;

  if (modelList.length === 0) {
    // OpenRouter or similar — free-text input only
    resetTerminalForInput();
    selectedModel = await pasteableInput({
      message: "Model ID:",
      default: (rawConfig.model as string | undefined) ?? provider.defaultModel,
    });
  } else {
    // Providers with predefined models — offer list + custom option
    resetTerminalForInput();
    const modelChoices = modelList.map((m) => ({
      name: `${m.id} — ${m.label}`,
      value: m.id,
    }));
    // Add "Custom model" option at end
    modelChoices.push({
      name: chalk.gray("Custom model (enter manually)"),
      value: "__custom__",
    });

    const modelSelection = await select({
      message: "Default model:",
      choices: modelChoices,
      default: (rawConfig.model as string | undefined) ?? provider.defaultModel,
    });

    if (modelSelection === "__custom__") {
      resetTerminalForInput();
      selectedModel = await pasteableInput({
        message: "Enter model ID:",
        default: (rawConfig.model as string | undefined) ?? provider.defaultModel,
      });

      // Brief pattern hint for unexpected formats
      if (selectedProvider === "claude" && !selectedModel.includes("projects/")) {
        const hasDirectFormat = selectedModel.startsWith("claude-") && !selectedModel.includes("@");
        if (!useVertexAi && !hasDirectFormat) {
          console.log(chalk.yellow("⚠"), chalk.gray("Expected format: claude-{name}-{date}"));
        }
      } else if (selectedProvider === "gemini" && !selectedModel.includes("projects/")) {
        const hasVertexFormat = selectedModel.includes("@");
        const hasDirectFormat = selectedModel.startsWith("gemini-") && !selectedModel.includes("@");
        if ((useVertexAi && !hasVertexFormat) || (!useVertexAi && !hasDirectFormat)) {
          const expectedFormat = useVertexAi ? "gemini-{version}@{version}" : "gemini-{version}-{variant}";
          console.log(chalk.yellow("⚠"), chalk.gray(`Expected format: ${expectedFormat}`));
        }
      } else if (selectedProvider === "codex" && !selectedModel.startsWith("gpt-")) {
        console.log(chalk.yellow("⚠"), chalk.gray("Expected format: gpt-{version}"));
      }
    } else {
      selectedModel = modelSelection;
    }
  }

  // 7. Per-agent overrides — grouped by category
  const updatedAgents = [...agents];
  const categorized = categorizeAgents(agents);

  for (const group of categorized) {
    console.log("");
    console.log(group.color(chalk.bold(`── ${group.label} ──`)));

    for (const agentIndex of group.agentIndices) {
      const agent = updatedAgents[agentIndex]!;
      const agentProvider = agent.provider ?? selectedProvider;
      const agentModel = agent.model ?? selectedModel;

      console.log("");
      console.log(chalk.bold(agent.name), roleBadge(agent.role));
      console.log(chalk.gray(`  ${agent.description}`));
      console.log(
        chalk.gray("  Tools:"),
        agent.tools.map((t) => chalk.cyan(t)).join(chalk.gray(", ")),
      );
      console.log(chalk.gray("  Provider:"), chalk.cyan(agentProvider));
      console.log(chalk.gray("  Model:   "), chalk.cyan(agentModel));

      const hasOverride = agent.provider !== undefined || agent.model !== undefined;
      resetTerminalForInput();
      const action = await select({
        message: `Configure ${agent.name}:`,
        choices: [
          { name: "Keep current", value: "keep" },
          { name: "Customize", value: "customize" },
          ...(hasOverride ? [{ name: "Clear overrides", value: "clear" }] : []),
        ],
        default: "keep",
      });

      if (action === "keep") {
        continue;
      } else if (action === "clear") {
        // Remove provider/model overrides from this agent
        const { provider: _p, model: _m, ...rest } = agent;
        updatedAgents[agentIndex] = rest as AgentConfig;
        continue;
      }

      // action === "customize"
      resetTerminalForInput();
      const agentProviderChoice = await select({
        message: `Provider for ${agent.name}:`,
        choices: providerChoices,
        default: agent.provider ?? selectedProvider,
      });

      // Warn if selected provider unavailable
      if (!availability[agentProviderChoice]?.available) {
        const reason = availability[agentProviderChoice]?.reason ?? "unknown reason";
        console.log(chalk.yellow("⚠"), chalk.yellow(`Provider ${agentProviderChoice} is unavailable (${reason})`));
        resetTerminalForInput();
        const proceed = await confirm({
          message: "Continue with this provider anyway?",
          default: false,
        });
        if (!proceed) {
          continue; // Skip customization for this agent
        }
      }

      const agentProviderAdapter = getProvider(agentProviderChoice);
      let agentModelChoice: string;

      // Determine Vertex AI preference for this agent's provider
      let agentUseVertexAi = false;
      if (!platformAskedProviders.has(agentProviderChoice) && agentProviderAdapter.vertexModels && agentProviderAdapter.vertexModels.length > 0) {
        resetTerminalForInput();
        const agentPlatform = await select({
          message: `API platform for ${agentProviderChoice}:`,
          choices: [
            { name: "Direct API", value: "direct" as const },
            { name: `Google Vertex AI ${chalk.gray("— see https://platform.claude.com/docs/en/build-with-claude/claude-on-vertex-ai")}`, value: "vertex" as const },
          ],
        });
        agentUseVertexAi = agentPlatform === "vertex";
        if (agentUseVertexAi) vertexProviders.add(agentProviderChoice);
        platformAskedProviders.add(agentProviderChoice);
      }

      const agentModelList = agentUseVertexAi
        ? (agentProviderAdapter.vertexModels ?? [])
        : agentProviderAdapter.supportedModels;

      if (agentModelList.length === 0) {
        // Provider has no predefined models — free-text input only
        resetTerminalForInput();
        agentModelChoice = await pasteableInput({
          message: `Model ID for ${agent.name}:`,
          default: agent.model ?? agentProviderAdapter.defaultModel,
        });
      } else {
        // Providers with predefined models — offer list + custom option
        resetTerminalForInput();
        const agentModelChoices = agentModelList.map((m) => ({
          name: `${m.id} — ${m.label}`,
          value: m.id,
        }));
        // Add "Custom model" option at end
        agentModelChoices.push({
          name: chalk.gray("Custom model (enter manually)"),
          value: "__custom__",
        });

        const agentModelSelection = await select({
          message: `Model for ${agent.name}:`,
          choices: agentModelChoices,
          default: agent.model ?? agentProviderAdapter.defaultModel,
        });

        if (agentModelSelection === "__custom__") {
          resetTerminalForInput();
          agentModelChoice = await pasteableInput({
            message: `Enter model ID for ${agent.name}:`,
            default: agent.model ?? agentProviderAdapter.defaultModel,
          });

          // Brief pattern hint for unexpected formats
          if (agentProviderChoice === "claude" && !agentModelChoice.includes("projects/")) {
            const hasDirectFormat = agentModelChoice.startsWith("claude-") && !agentModelChoice.includes("@");
            if (!agentUseVertexAi && !hasDirectFormat) {
              console.log(chalk.yellow("⚠"), chalk.gray("Expected format: claude-{name}-{date}"));
            }
          } else if (agentProviderChoice === "gemini" && !agentModelChoice.includes("projects/")) {
            const hasVertexFormat = agentModelChoice.includes("@");
            const hasDirectFormat = agentModelChoice.startsWith("gemini-") && !agentModelChoice.includes("@");
            if ((agentUseVertexAi && !hasVertexFormat) || (!agentUseVertexAi && !hasDirectFormat)) {
              const expectedFormat = agentUseVertexAi ? "gemini-{version}@{version}" : "gemini-{version}-{variant}";
              console.log(chalk.yellow("⚠"), chalk.gray(`Expected format: ${expectedFormat}`));
            }
          } else if (agentProviderChoice === "codex" && !agentModelChoice.startsWith("gpt-")) {
            console.log(chalk.yellow("⚠"), chalk.gray("Expected format: gpt-{version}"));
          }
        } else {
          agentModelChoice = agentModelSelection;
        }
      }

      updatedAgents[agentIndex] = { ...agent, provider: agentProviderChoice, model: agentModelChoice };
    }
  }

  // 8. Merge into raw config (only touch provider, model, and agent provider/model)
  rawConfig.provider = selectedProvider;
  rawConfig.model = selectedModel;

  // Match agents by name instead of index to handle length mismatches
  const rawAgents = rawConfig.agents as Record<string, unknown>[];
  for (const updatedAgent of updatedAgents) {
    const rawAgent = rawAgents.find((r) => r.name === updatedAgent.name);
    if (rawAgent) {
      // Update or remove provider/model fields
      if (updatedAgent.provider !== undefined) {
        rawAgent.provider = updatedAgent.provider;
      } else {
        delete rawAgent.provider;
      }
      if (updatedAgent.model !== undefined) {
        rawAgent.model = updatedAgent.model;
      } else {
        delete rawAgent.model;
      }
    }
  }

  // 9. Write config (atomic write to prevent TOCTOU race)
  try {
    const tempPath = `${configPath}.tmp.${randomBytes(8).toString("hex")}`;

    try {
      // Write to temp file
      writeFileSync(tempPath, JSON.stringify(rawConfig, null, 2) + "\n", "utf-8");

      // Security: verify temp file is not symlink
      const tempStats = lstatSync(tempPath);
      if (tempStats.isSymbolicLink()) {
        unlinkSync(tempPath);
        throw new Error(`Security: temp file became symlink`);
      }

      // Atomic rename
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
    console.log(chalk.red.bold("Error:"), `Failed to write config: ${message}`);
    if (isDebug()) console.error(err instanceof Error ? err.stack : err);
    process.exit(2);
  }

  // 10. Summary
  console.log("");
  console.log(chalk.green.bold("✓"), chalk.bold("Config updated"));
  console.log(chalk.gray("  Scope:   "), chalk.cyan(scope));
  console.log(chalk.gray("  File:    "), chalk.gray(configPath));
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
