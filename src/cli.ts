import { Command } from "commander";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import { setDebug } from "./debug.js";
import { setModelOverride, validateModel } from "./model.js";
import { agentCommand } from "./commands/agent.js";
import { generateSpecCommand } from "./commands/generate-spec.js";
import { specCommand } from "./commands/spec.js";
import { runCommand } from "./commands/run.js";
import { prCreateCommand } from "./commands/pr-create.js";
import { initCommand } from "./commands/init.js";
import { chatCommand } from "./commands/chat.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf-8"),
);

const program = new Command();

program
  .name("reygent")
  .description("Reygent CLI tool")
  .version(pkg.version)
  .option("--debug", "Show full stack traces on errors (or set REYGENT_DEBUG=1)")
  .option("--model <id>", "Anthropic model ID (e.g. claude-sonnet-4-5, claude-opus-4-6)")
  .addHelpText("after", `
${chalk.yellow("Disclaimer:")} This software is provided "as is" with no warranty. AI-generated output should be reviewed by a human. See LICENSE for full terms.`);

program
  .command("init")
  .description("Initialize .reygent folder with default agent and skill config")
  .option("--dry-run", "Preview what files would be created without writing anything", false)
  .action(initCommand);

program
  .command("generate-spec")
  .description("Generate a full markdown spec from a short description")
  .argument("[description]", "Short description of the feature to spec out")
  .option("--output <file>", "Output file path")
  .action(generateSpecCommand);

program
  .command("spec")
  .description("Load a spec from a markdown file, Jira issue, or Linear issue")
  .argument("<source>", "Path to a markdown file, issue key (e.g. PROJ-123), or Linear URL")
  .option("--clarify", "Run planner with clarification loop to evaluate spec", false)
  .action(specCommand);

program
  .command("agent")
  .description("Run a single agent independently")
  .argument("<name>", "Agent name (dev, qe, planner, security-reviewer, pr-reviewer, adhoc)")
  .argument("[prompt]", "Question or prompt for the agent")
  .option("--spec <source>", "Path to a markdown file, issue key, or Linear URL")
  .option("--auto-approve", "Auto-approve all file edits and actions without prompting", false)
  .action(agentCommand);

program
  .command("chat")
  .description("Start an interactive chat session with an agent")
  .argument("[name]", "Agent name (or pick interactively)")
  .action(chatCommand);

program
  .command("run")
  .description("Run the reygent workflow from spec to reviewed PR")
  .requiredOption("--spec <source>", "Path to a markdown file, issue key, or Linear URL")
  .option("--dry-run", "Preview workflow stages without executing", false)
  .option("--security-threshold <level>", "Minimum severity to fail security review (CRITICAL, HIGH, MEDIUM, LOW)", "HIGH")
  .option("--auto-approve", "Auto-approve all file edits and actions without prompting", false)
  .option("--insecure", "Skip SSL certificate verification for API calls", false)
  .option("--skip-clarification", "Skip planner clarification and make assumptions", false)
  .option("--max-retries <count>", "Max retry attempts when gate tests fail", "2")
  .option("--verbose", "Show detailed per-agent token and cost breakdown", false)
  .action(runCommand);

program
  .command("pr-create")
  .description("Create a pull request from current branch")
  .option("--title <title>", "PR title (defaults to spec title or last commit message)")
  .option("--body <body>", "PR body/description")
  .option("--spec <source>", "Optional: Path to a markdown file, issue key, or Linear URL")
  .option("--base <branch>", "Base branch for PR (defaults to origin/HEAD)")
  .option("--push", "Push current branch to origin before creating PR", true)
  .option("--no-push", "Don't push (assume branch already pushed)")
  .option("--insecure", "Skip SSL certificate verification for API calls", false)
  .action(prCreateCommand);

// Show header on commands that do actual work (not --help or --version)
const isHelpOrVersion = process.argv.includes("--help") ||
                         process.argv.includes("-h") ||
                         process.argv.includes("--version") ||
                         process.argv.includes("-V") ||
                         process.argv.length <= 2;

if (!isHelpOrVersion) {
  console.log(chalk.bold.cyan(`\nreygent`) + chalk.gray(` v${pkg.version}`) + "\n");
}

// Set debug flag and model override before any command action runs
program.hook("preAction", () => {
  if (program.opts().debug) {
    setDebug(true);
  }
  const modelFlag = program.opts().model;
  if (modelFlag) {
    try {
      const resolved = validateModel(modelFlag);
      setModelOverride(resolved);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      program.error(message);
    }
  }
});

program.parse();
