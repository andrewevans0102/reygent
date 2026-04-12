import { Command } from "commander";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { initCommand } from "./commands/init.js";
import { specCommand } from "./commands/spec.js";

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
  .command("spec")
  .description("Load a spec from a markdown file or Jira issue (e.g. PROJ-123)")
  .argument("<source>", "Path to a markdown file or a Jira issue key")
  .action(specCommand);

program.parse();
