import { Command } from "commander";
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import chalk from "chalk";
import ora from "ora";
import Table from "cli-table3";
import { input, select, confirm } from '@inquirer/prompts';
import {
  findKnowledgeDir,
  listKnowledgeFiles,
  readMarkdown,
  searchKnowledge,
  parseMarkdownEntries,
} from "../knowledge/loader.js";
import { getChesstrace } from "../chesstrace/index.js";
import { measureKnowledgeEffectiveness } from "../knowledge/analyzer.js";
import { addFailureEntry, addPatternEntry } from "../knowledge/manager.js";
import { AgentName, builtinAgents } from "../agents.js";

/**
 * Register knowledge subcommands under main CLI program
 */
export function registerKnowledgeCommand(program: Command) {
  const knowledge = program
    .command("knowledge")
    .description("Manage living documentation in .reygent/knowledge/");

  knowledge
    .command("list")
    .description("List all knowledge files")
    .action(listCommand);

  knowledge
    .command("show")
    .description("Show specific knowledge file")
    .argument("<file>", "Knowledge file to show (e.g., common-failures, agents/dev)")
    .action(showCommand);

  knowledge
    .command("search")
    .description("Search knowledge files for a query")
    .argument("<query>", "Search query")
    .action(searchCommand);

  knowledge
    .command("edit")
    .description("Edit knowledge file in $EDITOR")
    .argument("<file>", "Knowledge file to edit (e.g., common-failures, agents/dev)")
    .action(editCommand);

  knowledge
    .command("add-failure")
    .description("Document a failure pattern (interactive)")
    .option("--run-id <id>", "Run ID to extract failure from")
    .option("--issue <text>", "Issue description")
    .option("--solution <text>", "Solution description")
    .option("--agent <name>", "Affected agent")
    .action(addFailureCommand);

  knowledge
    .command("add-pattern")
    .description("Document a success pattern (interactive)")
    .option("--run-id <id>", "Run ID to extract pattern from")
    .option("--description <text>", "Pattern description")
    .action(addPatternCommand);

  knowledge
    .command("stats")
    .description("Show knowledge base statistics and effectiveness")
    .option("--since <days>", "Time window in days (e.g., 30d)", "30d")
    .action(statsCommand);
}

/**
 * List all knowledge files
 */
async function listCommand() {
  const knowledgeDir = findKnowledgeDir();

  if (!knowledgeDir) {
    console.log(chalk.yellow("No .reygent/knowledge/ directory found."));
    console.log(
      chalk.gray("Run from a project with .reygent/ or create one with:"),
    );
    console.log(chalk.cyan("  reygent init"));
    return;
  }

  const files = listKnowledgeFiles();

  if (files.length === 0) {
    console.log(chalk.yellow("No knowledge files found."));
    return;
  }

  console.log(chalk.bold("\nKnowledge Files:"));
  console.log();

  const table = new Table({
    head: [chalk.cyan("File"), chalk.cyan("Type")],
    colWidths: [40, 30],
  });

  for (const file of files) {
    const type = file.startsWith("agents/")
      ? "Agent-specific"
      : file.replace(".md", "").replace(/-/g, " ");
    table.push([file, type]);
  }

  console.log(table.toString());
  console.log();
  console.log(chalk.gray(`View file: ${chalk.white("reygent knowledge show <file>")}`));
  console.log(chalk.gray(`Search: ${chalk.white("reygent knowledge search <query>")}`));
}

/**
 * Show specific knowledge file
 */
async function showCommand(file: string) {
  const knowledgeDir = findKnowledgeDir();

  if (!knowledgeDir) {
    console.log(chalk.red("No .reygent/knowledge/ directory found."));
    process.exit(1);
  }

  // Normalize file path (add .md if missing)
  const normalizedFile = file.endsWith(".md") ? file : `${file}.md`;
  const filePath = join(knowledgeDir, normalizedFile);

  try {
    const content = readMarkdown(filePath);
    if (!content) {
      console.log(chalk.yellow(`Knowledge file not found: ${normalizedFile}`));
      console.log(chalk.gray("Available files:"));
      const files = listKnowledgeFiles();
      files.forEach((f) => console.log(chalk.gray(`  - ${f}`)));
      process.exit(1);
    }

    console.log(chalk.bold(`\n${normalizedFile}\n`));
    console.log(content);
    console.log();
  } catch (err) {
    console.log(chalk.red(`Failed to read ${normalizedFile}: ${(err as Error).message}`));
    process.exit(1);
  }
}

/**
 * Search knowledge files
 */
async function searchCommand(query: string) {
  const spinner = ora(`Searching for "${query}"...`).start();

  try {
    const results = searchKnowledge(query);

    if (results.length === 0) {
      spinner.fail(chalk.yellow("No matches found."));
      return;
    }

    spinner.succeed(chalk.green(`Found ${results.length} match(es)`));
    console.log();

    for (const result of results) {
      console.log(chalk.bold.cyan(`${result.file}`));
      console.log(chalk.bold(`  ${result.entry.title}`));
      console.log(chalk.gray(`  ${result.excerpt}`));
      console.log();
    }
  } catch (err) {
    spinner.fail(chalk.red(`Search failed: ${(err as Error).message}`));
    process.exit(1);
  }
}

/**
 * Edit knowledge file in $EDITOR
 */
async function editCommand(file: string) {
  const knowledgeDir = findKnowledgeDir();

  if (!knowledgeDir) {
    console.log(chalk.red("No .reygent/knowledge/ directory found."));
    process.exit(1);
  }

  const normalizedFile = file.endsWith(".md") ? file : `${file}.md`;
  const filePath = join(knowledgeDir, normalizedFile);

  const editor = process.env.EDITOR || "vi";

  console.log(chalk.cyan(`Opening ${normalizedFile} in ${editor}...`));

  try {
    execSync(`${editor} "${filePath}"`, { stdio: "inherit" });
    console.log(chalk.green("File saved."));
  } catch (err) {
    console.log(chalk.red(`Failed to open editor: ${(err as Error).message}`));
    process.exit(1);
  }
}

/**
 * Add failure documentation (interactive/manual)
 */
async function addFailureCommand(options: {
  runId?: string;
  issue?: string;
  solution?: string;
  agent?: string;
  example?: string;
}) {
  const knowledgeDir = findKnowledgeDir();

  if (!knowledgeDir) {
    console.log(chalk.red("No .reygent/knowledge/ directory found."));
    console.log(chalk.gray("Run 'reygent init' to create knowledge directory."));
    process.exit(1);
  }

  // Interactive prompts if options not provided
  let issue = options.issue;
  let solution = options.solution;
  let agent = options.agent as AgentName | undefined;
  let example = options.example;

  if (!issue) {
    issue = await input({
      message: 'What is the issue/error?',
      validate: (value) => value.trim() !== '' || 'Issue description required',
    });
  }

  if (!solution) {
    solution = await input({
      message: 'What is the solution/fix?',
      validate: (value) => value.trim() !== '' || 'Solution description required',
    });
  }

  if (!agent) {
    const agentChoices = builtinAgents.map((a) => ({ value: a.name, name: a.name }));
    agent = await select({
      message: 'Which agent does this apply to?',
      choices: agentChoices,
    }) as AgentName;
  }

  if (!example) {
    const addExample = await confirm({
      message: 'Add a code example?',
      default: false,
    });

    if (addExample) {
      example = await input({
        message: 'Enter code example:',
      });
    }
  }

  // Use manager to add entry
  const baseDir = knowledgeDir.replace('/.reygent/knowledge', '');
  await addFailureEntry(baseDir, {
    issue,
    solution,
    agent,
    example,
  });

  console.log(chalk.green("✓ Failure documented"));
  console.log(chalk.gray(`  File: common-failures.md`));
  console.log(chalk.gray(`  Agent: ${agent}`));
}

/**
 * Add success pattern (interactive/manual)
 */
async function addPatternCommand(options: {
  runId?: string;
  description?: string;
  approach?: string;
  successRate?: number;
}) {
  const knowledgeDir = findKnowledgeDir();

  if (!knowledgeDir) {
    console.log(chalk.red("No .reygent/knowledge/ directory found."));
    console.log(chalk.gray("Run 'reygent init' to create knowledge directory."));
    process.exit(1);
  }

  // Interactive prompts if options not provided
  let description = options.description;
  let approach = options.approach;
  let successRate = options.successRate;

  if (!description) {
    description = await input({
      message: 'Describe the success pattern:',
      validate: (value) => value.trim() !== '' || 'Description required',
    });
  }

  if (!approach) {
    const addApproach = await confirm({
      message: 'Add detailed approach?',
      default: false,
    });

    if (addApproach) {
      approach = await input({
        message: 'Describe the approach:',
      });
    }
  }

  if (successRate === undefined) {
    const addRate = await confirm({
      message: 'Add success rate?',
      default: false,
    });

    if (addRate) {
      const rateStr = await input({
        message: 'Enter success rate (0-100):',
        validate: (value) => {
          const num = parseFloat(value);
          return (!isNaN(num) && num >= 0 && num <= 100) || 'Must be a number between 0 and 100';
        },
      });
      successRate = parseFloat(rateStr);
    }
  }

  // Use manager to add entry
  const baseDir = knowledgeDir.replace('/.reygent/knowledge', '');
  await addPatternEntry(baseDir, {
    description,
    approach,
    successRate,
  });

  console.log(chalk.green("✓ Pattern documented"));
  console.log(chalk.gray(`  File: success-patterns.md`));
}

/**
 * Show knowledge base statistics
 */
async function statsCommand(options: { since?: string }) {
  const knowledgeDir = findKnowledgeDir();

  if (!knowledgeDir) {
    console.log(chalk.red("No .reygent/knowledge/ directory found."));
    process.exit(1);
  }

  const spinner = ora("Calculating knowledge base stats...").start();

  try {
    // Parse since parameter
    const since = options.since || "30d";
    const match = since.match(/^(\d+)d$/);
    if (!match) {
      spinner.fail(chalk.red(`Invalid --since format: ${since}. Use format like "30d".`));
      process.exit(1);
    }
    const days = Number.parseInt(match[1], 10);
    const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;

    // Get knowledge file counts
    const files = listKnowledgeFiles();
    const totalEntries = files.reduce((count, file) => {
      const filePath = join(knowledgeDir, file);
      const content = readMarkdown(filePath);
      const entries = parseMarkdownEntries(content, filePath);
      return count + entries.length;
    }, 0);

    // Get effectiveness metrics from telemetry
    const chesstrace = getChesstrace();
    if (!chesstrace) {
      spinner.fail(chalk.yellow("Telemetry not available. Cannot calculate effectiveness."));
      console.log();
      console.log(chalk.bold("Knowledge Base Stats"));
      console.log();
      console.log(`Files: ${files.length}`);
      console.log(`Total entries: ${totalEntries}`);
      return;
    }

    const backend = chesstrace.getBackend();
    const effectiveness = measureKnowledgeEffectiveness(backend, sinceMs);

    spinner.succeed(chalk.green("Stats calculated"));
    console.log();
    console.log(chalk.bold("Knowledge Base Stats"));
    console.log();

    // File stats
    console.log(chalk.cyan("Files:"), files.length);
    console.log(chalk.cyan("Total entries:"), totalEntries);
    console.log();

    // Usage stats
    console.log(chalk.bold(`Usage (last ${days} days):`));
    console.log(chalk.cyan("  Consulted runs:"), effectiveness.consultedRuns);
    console.log(chalk.cyan("  Baseline runs:"), effectiveness.baselineRuns);
    console.log();

    // Effectiveness
    if (effectiveness.consultedRuns > 0 || effectiveness.baselineRuns > 0) {
      const withKnowledgePct = Math.round(effectiveness.withKnowledge * 100);
      const baselinePct = Math.round(effectiveness.baseline * 100);
      const improvementPct = Math.round(effectiveness.improvement * 100);

      console.log(chalk.bold("Effectiveness:"));
      console.log(chalk.cyan("  Success rate with knowledge:"), `${withKnowledgePct}%`);
      console.log(chalk.cyan("  Baseline success rate:"), `${baselinePct}%`);

      const improvementColor = effectiveness.improvement > 0 ? chalk.green : effectiveness.improvement < 0 ? chalk.red : chalk.gray;
      console.log(chalk.cyan("  Improvement:"), improvementColor(`${improvementPct > 0 ? "+" : ""}${improvementPct}%`));
    } else {
      console.log(chalk.gray("No runs found in time window to measure effectiveness."));
    }
    console.log();

  } catch (err) {
    spinner.fail(chalk.red(`Failed to calculate stats: ${(err as Error).message}`));
    process.exit(1);
  }
}
