import { spawn } from "node:child_process";
import { constants } from "node:os";
import { select } from "@inquirer/prompts";
import chalk from "chalk";
import { getAgents } from "../config.js";
import type { AgentConfig } from "../agents.js";
import { isDebug } from "../debug.js";
import { resolveModel } from "../model.js";
import { loadSpec, SpecError } from "../spec.js";
import { TaskError } from "../task.js";

interface AgentOptions {
  spec?: string;
}

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

    child.on("close", (code, signal) => {
      if (signal) {
        const sigNum = constants.signals[signal];
        resolve(sigNum ? 128 + sigNum : 1);
      } else {
        resolve(code ?? 0);
      }
    });
  });
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

    const modelId = await resolveModel();

    console.log(
      chalk.bold.cyan(`\nStarting session with ${agent.name} agent`) +
        chalk.gray(` (${modelId})`) +
        "\n",
    );

    const exitCode = await spawnInteractiveChat(systemPrompt, modelId);
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
