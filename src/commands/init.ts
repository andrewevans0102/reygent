import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { builtinAgents } from "../agents.js";

function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${question} (y/N) `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

export async function initCommand(): Promise<void> {
  const agentsDir = join(process.cwd(), ".claude", "agents");

  if (existsSync(agentsDir)) {
    const overwrite = await confirm(
      `.claude/agents/ already exists. Overwrite?`,
    );
    if (!overwrite) {
      console.log("Aborted.");
      return;
    }
  }

  const created: string[] = [];

  for (const agent of builtinAgents) {
    const dir = join(agentsDir, agent.name);
    mkdirSync(dir, { recursive: true });

    const configPath = join(dir, "agent.json");
    writeFileSync(configPath, JSON.stringify(agent, null, 2) + "\n");
    created.push(`.claude/agents/${agent.name}/agent.json`);
  }

  console.log(`\nCreated ${created.length} agent configs:\n`);
  for (const file of created) {
    console.log(`  ${file}`);
  }
  console.log();
}
