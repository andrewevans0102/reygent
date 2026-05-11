import { select } from "@inquirer/prompts";
import chalk from "chalk";
import { getAgents } from "../config.js";
import type { AgentConfig } from "../agents.js";
import { isDebug } from "../debug.js";
import { resolveModel, resolveProvider, validateModel } from "../model.js";
import { getProvider } from "../providers/index.js";
import { loadSpec, SpecError } from "../spec.js";
import { TaskError } from "../task.js";
import { resetTerminalForInput } from "../terminal-reset.js";

interface AgentOptions {
  spec?: string;
}

export async function agentCommand(
  name: string | undefined,
  options: AgentOptions,
): Promise<void> {
  try {
    const agents = getAgents();
    let agent: AgentConfig;

    if (name) {
      const found = agents.find((a) => a.name === name);
      if (!found) {
        const validNames = agents.map((a) => a.name).join(", ");
        console.log(chalk.red.bold("Error:"), `Unknown agent "${name}". Valid agents: ${validNames}`);
        process.exit(1);
      }
      agent = found;
    } else {
      if (agents.length === 0) {
        throw new TaskError("No agents configured. Add agents to .reygent/config.json or check built-in agents.");
      }
      resetTerminalForInput();
      agent = await select({
        message: "Select agent:",
        choices: agents.map((a) => ({
          name: `${a.name} — ${a.description}`,
          value: a,
        })),
      });
    }

    let systemPrompt = agent.systemPrompt;

    if (options.spec) {
      const spec = await loadSpec(options.spec);
      systemPrompt += `

---

## Spec

**Title:** ${spec.title}

${spec.content}`;
    }

    const providerName = resolveProvider(agent.provider);
    const provider = getProvider(providerName);
    const modelId = agent.model
      ? validateModel(agent.model, providerName)
      : await resolveModel(providerName);

    console.log(
      chalk.bold.cyan(`\nStarting session with ${agent.name} agent`) +
        chalk.gray(` (${providerName}/${modelId})`) +
        "\n",
    );

    const exitCode = await provider.spawnInteractive(systemPrompt, modelId);
    process.exit(exitCode);
  } catch (err) {
    if (err instanceof SpecError || err instanceof TaskError) {
      console.log(chalk.red.bold("Error:"), err.message);
      if (isDebug()) console.error(err.stack);
      process.exit(1);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.log(chalk.red.bold("Internal error:"), message);
    if (isDebug()) console.error(err instanceof Error ? err.stack : err);
    process.exit(2);
  }
}
