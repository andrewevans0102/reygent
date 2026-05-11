import { Command } from "commander";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import { killAllChildren } from "./child-registry.js";
import { setDebug } from "./debug.js";
import { setModelOverride, setProviderOverride, validateModel } from "./model.js";
import { getProvider, PROVIDER_NAMES } from "./providers/index.js";
import { setTelemetryOverride, isValidTelemetryLevel } from "./telemetry-override.js";
import { agentCommand } from "./commands/agent.js";
import { generateSpecCommand } from "./commands/generate-spec.js";
import { specCommand } from "./commands/spec.js";
import { runCommand } from "./commands/run.js";
import { initCommand } from "./commands/init.js";
import { registerSkillsCommand } from "./commands/skills.js";
import { reviewWorkCommand } from "./commands/review-work.js";
import { reviewCommentsCommand } from "./commands/review-comments.js";
import { configCommand } from "./commands/config.js";
import { registerTelemetryCommand } from "./commands/telemetry.js";
import { isValidType, VALID_BRANCH_TYPES } from "./branch-type.js";
import { shouldPromptForTelemetry, promptForTelemetryOptIn } from "./chesstrace/prompt.js";

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
  .option("--model <id>", "Model ID (e.g. claude-sonnet-4-5, gemini-2.5-pro, gpt-5.4)")
  .option("--provider <name>", `AI provider (${PROVIDER_NAMES.join(", ")})`)
  .option("--no-telemetry", "Disable telemetry for this run")
  .option("--telemetry-level <level>", "Override telemetry level (minimal, standard, verbose)")
  .option("--telemetry-verbose", "Shorthand for --telemetry-level verbose")
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
  .option("--skip-clarification", "Skip clarifying questions and generate spec directly", false)
  .action(generateSpecCommand);

program
  .command("spec")
  .description("Load a spec from a markdown file, Jira issue, or Linear issue")
  .argument("<source>", "Path to a markdown file, issue key (e.g. PROJ-123), or Linear URL")
  .option("--clarify", "Run planner with clarification loop to evaluate spec", false)
  .option("--source <name>", "Issue source provider (jira, linear, local) — skips interactive prompt")
  .action(specCommand);

program
  .command("agent")
  .description("Start an interactive agent session")
  .argument("[name]", "Agent name (dev, qe, planner, security-reviewer, pr-reviewer, adhoc)")
  .option("--spec <source>", "Path to a markdown file, issue key, or Linear URL")
  .action(agentCommand);

program
  .command("run")
  .description("Run the reygent workflow from spec to reviewed PR")
  .option("--spec <source>", "Path to a markdown file, issue key, or Linear URL (prompts if omitted in interactive mode)")
  .option("--type <type>", "Branch type (feat, fix, chore, refactor, docs, test, style, perf) — skips interactive prompt")
  .option("--dry-run", "Preview workflow stages without executing", false)
  .option("--security-threshold <level>", "Minimum severity to fail security review (CRITICAL, HIGH, MEDIUM, LOW)", "HIGH")
  .option("--auto-approve", "Auto-approve all file edits and actions without prompting", false)
  .option("--insecure", "Skip SSL certificate verification for API calls", false)
  .option("--skip-clarification", "Skip planner clarification and make assumptions", false)
  .option("--max-retries <count>", "Max retry attempts when gate tests fail", "2")
  .option("--verbose", "Show detailed per-agent token and cost breakdown", false)
  .hook("preAction", (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.type && !isValidType(opts.type)) {
      console.error(chalk.red(`Error: Invalid --type "${opts.type}". Must be one of: ${VALID_BRANCH_TYPES.join(", ")} (or feature/bugfix aliases)`));
      process.exit(1);
    }
  })
  .action(runCommand);

program
  .command("review-work")
  .description("Review current branch and post summary to PR/MR")
  .option("--spec <source>", "Spec source with provider prefix (jira:KEY, linear:ID, markdown:FILE) — file paths auto-infer markdown:")
  .option("--insecure", "Skip SSL certificate verification for API calls", false)
  .action(reviewWorkCommand);

program
  .command("review-comments")
  .description("Fetch PR/MR review comments and address them with an agent")
  .option("--insecure", "Skip SSL certificate verification for API calls", false)
  .option("--auto-approve", "Auto-approve plan and execute without prompting", false)
  .action(reviewCommentsCommand);

program
  .command("config")
  .description("Configure default provider, model, and per-agent overrides")
  .action(configCommand);

registerTelemetryCommand(program);
registerSkillsCommand(program);

// Show header on commands that do actual work (not --help or --version)
const isHelpOrVersion = process.argv.includes("--help") ||
                         process.argv.includes("-h") ||
                         process.argv.includes("--version") ||
                         process.argv.includes("-V") ||
                         process.argv.length <= 2;

if (!isHelpOrVersion) {
  console.log(chalk.bold.cyan(`\nreygent`) + chalk.gray(` v${pkg.version}`) + "\n");
}

// Set debug flag, provider, model, and telemetry overrides before any command action runs
program.hook("preAction", async () => {
  if (program.opts().debug) {
    setDebug(true);
  }

  try {
    const providerFlag = program.opts().provider;
    if (providerFlag) {
      try {
        // Validate provider name
        getProvider(providerFlag);
        setProviderOverride(providerFlag);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        program.error(message);
      }
    }

    const modelFlag = program.opts().model;
    if (modelFlag) {
      try {
        const resolved = validateModel(modelFlag, providerFlag);
        setModelOverride(resolved);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        program.error(message);
      }
    }

    // Apply telemetry flag overrides
    const noTelemetry = program.opts().telemetry === false;
    const telemetryLevelFlag = program.opts().telemetryLevel;
    const telemetryVerbose = program.opts().telemetryVerbose === true;

    if (noTelemetry) {
      setTelemetryOverride({ disabled: true });
    } else if (telemetryVerbose) {
      setTelemetryOverride({ level: "verbose" });
    } else if (telemetryLevelFlag) {
      if (!isValidTelemetryLevel(telemetryLevelFlag)) {
        program.error(
          `Invalid --telemetry-level "${telemetryLevelFlag}". Must be one of: minimal, standard, verbose`
        );
      }
      setTelemetryOverride({ level: telemetryLevelFlag });
    }
  } catch (err) {
    // Unexpected error in validation - log but continue to telemetry prompt
    if (program.opts().debug) {
      console.error(chalk.gray("Validation error:"), err);
    }
  }

  // Show telemetry opt-in prompt on first run (unless --no-telemetry flag set)
  const noTelemetry = program.opts().telemetry === false;
  if (!noTelemetry && shouldPromptForTelemetry()) {
    try {
      await promptForTelemetryOptIn();
    } catch (err) {
      // Ctrl+C from inquirer
      if (err && typeof err === "object" && "name" in err && (err as { name: string }).name === "ExitPromptError") {
        console.log(chalk.yellow("\nTelemetry setup cancelled."));
        process.exit(0);
      }
      // Other errors shouldn't block command execution
      if (program.opts().debug) {
        console.error(chalk.gray("Telemetry prompt failed:"), err);
      }
    }
  }
});

// Fallback SIGINT handler: kill child processes when no live-status handler is active
process.on("SIGINT", () => {
  killAllChildren();
  process.exit(130);
});

program.parse();
