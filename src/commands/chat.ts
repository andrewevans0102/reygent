import { spawn } from "node:child_process";
import { select } from "@inquirer/prompts";
import chalk from "chalk";
import { getAgents } from "../config.js";
import { isDebug } from "../debug.js";
import { resolveModel } from "../model.js";
import { TaskError } from "../task.js";
import { SpecError } from "../spec.js";
import type { AgentConfig } from "../agents.js";

/**
 * Interactive arrow-key picker for agent selection.
 */
async function promptAgentSelection(): Promise<AgentConfig> {
  const agents = getAgents();
  const selected = await select({
    message: "Select agent to chat with:",
    choices: agents.map((a) => ({
      name: `${a.name} — ${a.description}`,
      value: a,
    })),
  });
  return selected;
}

/**
 * Spawn claude CLI in interactive mode with agent system prompt injected.
 */
function spawnInteractiveChat(
  systemPrompt: string,
  modelId: string,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "claude",
      ["--append-system-prompt", systemPrompt, "--model", modelId],
      { stdio: "inherit" },
    );

    child.on("error", (err) => {
      reject(
        new TaskError(
          `Failed to start claude CLI: ${err.message}. Is claude installed?`,
        ),
      );
    });

    child.on("close", (code) => {
      resolve(code ?? 0);
    });
  });
}

export async function chatCommand(
  name: string | undefined,
): Promise<void> {
  try {
    let agent: AgentConfig;

    if (name) {
      const agents = getAgents();
      const found = agents.find((a) => a.name === name);
      if (!found) {
        const validNames = agents.map((a) => a.name).join(", ");
        console.log(
          chalk.red.bold("Error:"),
          `Unknown agent "${name}". Valid agents: ${validNames}`,
        );
        process.exit(1);
      }
      agent = found;
    } else {
      agent = await promptAgentSelection();
    }

    const modelId = await resolveModel();

    console.log(
      chalk.bold.cyan(`\nStarting chat with ${agent.name} agent`) +
        chalk.gray(` (${modelId})`) +
        "\n",
    );

    const exitCode = await spawnInteractiveChat(agent.systemPrompt, modelId);
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
