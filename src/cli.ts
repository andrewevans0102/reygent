import { Command } from "commander";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { agentCommand } from "./commands/agent.js";
import { initCommand } from "./commands/init.js";
import { generateSpecCommand } from "./commands/generate-spec.js";
import { specCommand } from "./commands/spec.js";
import { runCommand } from "./commands/run.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf-8"),
);

const program = new Command();

program
  .name("reygent")
  .description("Reygent CLI tool")
  .version(pkg.version);

program
  .command("init")
  .description("Scaffold .claude/agents/ with built-in agent configs")
  .action(initCommand);

program
  .command("generate-spec")
  .description("Generate a full markdown spec from a short description")
  .argument("<description>", "Short description of the feature to spec out")
  .option("--output <file>", "Output file path", "spec.md")
  .action(generateSpecCommand);

program
  .command("spec")
  .description("Load a spec from a markdown file, Jira issue, or Linear issue")
  .argument("<source>", "Path to a markdown file, issue key (e.g. PROJ-123), or Linear URL")
  .action(specCommand);

program
  .command("agent")
  .description("Run a single agent independently")
  .argument("<name>", "Agent name (dev, qe, planner, security-reviewer, pr-reviewer, adhoc)")
  .requiredOption("--spec <source>", "Path to a markdown file, issue key, or Linear URL")
  .action(agentCommand);

program
  .command("run")
  .description("Run the agent pipeline from spec to reviewed PR")
  .requiredOption("--spec <source>", "Path to a markdown file, issue key, or Linear URL")
  .option("--dry-run", "Print pipeline stages as JSON without executing", false)
  .option("--security-threshold <level>", "Minimum severity to fail security review (CRITICAL, HIGH, MEDIUM, LOW)", "HIGH")
  .action(runCommand);

program.parse();
