import { Command } from "commander";
import { createInterface } from "node:readline";
import chalk from "chalk";
import { findProjectRoot } from "../project-detection.js";
import { resetTerminalForInput } from "../terminal-reset.js";
import { runCommand } from "./run.js";
import { listUnfinishedSnapshots, type RunSnapshot } from "./run-snapshot.js";

interface ContinueOptions {
  runId?: string;
  autoApprove?: boolean;
  verbose?: boolean;
}

const MAX_DISPLAYED = 5;

function formatAge(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function summarizeSnapshot(snapshot: RunSnapshot): {
  shortId: string;
  title: string;
  lastCompleted: string;
  failedStage: string;
  age: string;
} {
  const lastCompleted = snapshot.completedStages.length > 0
    ? snapshot.completedStages[snapshot.completedStages.length - 1]
    : "(none)";
  return {
    shortId: snapshot.runId.substring(0, 8),
    title: snapshot.specTitle || snapshot.specSource,
    lastCompleted,
    failedStage: snapshot.failedStage ?? "—",
    age: formatAge(Date.now() - snapshot.updatedAt),
  };
}

function findByRunIdPrefix(snapshots: RunSnapshot[], prefix: string): {
  match?: RunSnapshot;
  error?: string;
} {
  const matches = snapshots.filter((s) => s.runId.startsWith(prefix));
  if (matches.length === 0) return { error: `No resumable run matches "${prefix}"` };
  if (matches.length > 1) {
    return { error: `Ambiguous run id "${prefix}" — matched ${matches.length} runs. Use a longer prefix.` };
  }
  return { match: matches[0] };
}

async function promptForSelection(snapshots: RunSnapshot[]): Promise<RunSnapshot | null> {
  const visible = snapshots.slice(0, MAX_DISPLAYED);

  console.log(chalk.bold.cyan("\nUnfinished runs:\n"));
  visible.forEach((snapshot, idx) => {
    const summary = summarizeSnapshot(snapshot);
    console.log(
      `  ${chalk.bold((idx + 1).toString())}) ${chalk.gray(summary.shortId)}  ${chalk.white(summary.title)}`,
    );
    console.log(
      `       ${chalk.gray("last:")} ${summary.lastCompleted}  ${chalk.gray("failed:")} ${summary.failedStage}  ${chalk.gray(summary.age)}`,
    );
  });
  if (snapshots.length > MAX_DISPLAYED) {
    console.log(chalk.gray(`\n  (${snapshots.length - MAX_DISPLAYED} older run(s) not shown)`));
  }
  console.log("");

  resetTerminalForInput();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => {
    rl.question(`Select a run to resume (1-${visible.length}, or q to quit): `, resolve);
  });
  rl.close();
  console.log("");

  const trimmed = answer.trim().toLowerCase();
  if (trimmed === "q" || trimmed === "quit" || trimmed === "") return null;

  const choice = parseInt(trimmed, 10);
  if (Number.isNaN(choice) || choice < 1 || choice > visible.length) {
    console.log(chalk.red("Invalid selection."));
    return null;
  }
  return visible[choice - 1];
}

export async function continueCommand(options: ContinueOptions): Promise<void> {
  const projectRoot = findProjectRoot(process.cwd());
  if (!projectRoot) {
    console.log(chalk.yellow("No project root detected. `reygent continue` requires a .reygent/ directory."));
    return;
  }

  const snapshots = listUnfinishedSnapshots(projectRoot);
  if (snapshots.length === 0) {
    console.log(chalk.gray("No resumable runs found."));
    return;
  }

  let chosen: RunSnapshot | null = null;

  if (options.runId) {
    const { match, error } = findByRunIdPrefix(snapshots, options.runId);
    if (error) {
      console.log(chalk.red.bold("Error:"), error);
      process.exit(1);
    }
    chosen = match!;
  } else {
    if (!process.stdin.isTTY) {
      console.log(chalk.red.bold("Error:"), "--run-id is required in non-interactive environments.");
      process.exit(1);
    }
    chosen = await promptForSelection(snapshots);
  }

  if (!chosen) {
    console.log(chalk.gray("Aborted."));
    return;
  }

  await runCommand({
    spec: undefined,
    type: chosen.runOptions.type,
    dryRun: false,
    securityThreshold: chosen.runOptions.securityThreshold,
    autoApprove: options.autoApprove ?? chosen.runOptions.autoApprove,
    insecure: chosen.runOptions.insecure,
    skipClarification: chosen.runOptions.skipClarification,
    maxRetries: chosen.runOptions.maxRetries,
    verbose: options.verbose ?? chosen.runOptions.verbose,
    _resume: chosen,
  });
}

export function registerContinueCommand(program: Command): void {
  program
    .command("continue")
    .description("Resume a previously failed or interrupted reygent run")
    .option("--run-id <id>", "Run id (or unique prefix) to resume — skips the interactive prompt")
    .option("--auto-approve", "Auto-approve all file edits and actions without prompting")
    .option("--verbose", "Show detailed per-agent token and cost breakdown")
    .action(continueCommand);
}
