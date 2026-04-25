import { createInterface } from "node:readline";
import chalk from "chalk";
import { getAgents } from "../config.js";
import { isDebug } from "../debug.js";
import { spawnAgent } from "../implement.js";
import { loadSpec, SpecError } from "../spec.js";
import { TaskError } from "../task.js";
import { formatDuration } from "../usage.js";

interface AgentOptions {
  spec?: string;
  autoApprove: boolean;
}

export async function agentCommand(
  name: string,
  userPrompt: string | undefined,
  options: AgentOptions,
): Promise<void> {
  const agents = getAgents();
  const agent = agents.find((a) => a.name === name);

  if (!agent) {
    const validNames = agents.map((a) => a.name).join(", ");
    console.log(chalk.red.bold("Error:"), `Unknown agent "${name}". Valid agents: ${validNames}`);
    process.exit(1);
  }

  if (agent.role === "skill") {
    console.log(chalk.magenta("skill") + chalk.gray(` → ${agent.name}`) + chalk.gray(` — ${agent.description}`));
  }

  try {
    // Prompt for permission mode if not specified
    let autoApprove = options.autoApprove;
    if (!autoApprove) {
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const answer = await new Promise<string>((resolve) => {
        rl.question(
          "\nAgent may write files and run commands. Auto-approve all actions? (y/n) ",
          resolve,
        );
      });
      rl.close();

      autoApprove = answer.toLowerCase() === "y" || answer.toLowerCase() === "yes";
      console.log("");
    }

    let prompt: string;

    if (options.spec) {
      // Spec mode: load spec and build prompt with spec context
      const spec = await loadSpec(options.spec);
      prompt = `${agent.systemPrompt}

---

## Spec

**Title:** ${spec.title}

${spec.content}`;
    } else if (userPrompt) {
      // Interactive mode: use user prompt directly
      prompt = `${agent.systemPrompt}

---

${userPrompt}`;
    } else {
      console.log(chalk.red.bold("Error:"), "either provide a prompt or use --spec\n");
      console.log(chalk.cyan("Examples:"));
      console.log(chalk.gray("  reygent agent security-reviewer \"review this auth code\""));
      console.log(chalk.gray("  reygent agent qe --spec spec.md"));
      process.exit(1);
    }

    const result = await spawnAgent(name, prompt, { autoApprove });

    if (result.usage) {
      console.log(
        chalk.gray("\nUsage: ") +
        chalk.cyan(`$${result.usage.costUsd.toFixed(2)}`) +
        chalk.gray(` (${formatDuration(result.usage.durationMs)})`),
      );
    }

    if (result.exitCode !== 0) {
      process.exit(1);
    }
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
