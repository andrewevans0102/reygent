import { builtinAgents } from "../agents.js";
import { spawnAgent } from "../implement.js";
import { loadSpec, SpecError } from "../spec.js";
import { TaskError } from "../task.js";

interface AgentOptions {
  spec: string;
}

export async function agentCommand(
  name: string,
  options: AgentOptions,
): Promise<void> {
  const agent = builtinAgents.find((a) => a.name === name);

  if (!agent) {
    const validNames = builtinAgents.map((a) => a.name).join(", ");
    console.error(`Unknown agent "${name}". Valid agents: ${validNames}`);
    process.exit(1);
  }

  try {
    const spec = await loadSpec(options.spec);

    const prompt = `${agent.systemPrompt}

---

## Spec

**Title:** ${spec.title}

${spec.content}`;

    const result = await spawnAgent(name, prompt);

    if (result.exitCode !== 0) {
      process.exit(1);
    }
  } catch (err) {
    if (err instanceof SpecError || err instanceof TaskError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}
