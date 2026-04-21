import chalk from "chalk";

export interface UsageInfo {
  costUsd?: number;
  durationMs?: number;
  numTurns?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface AgentUsageEntry {
  agent: string;
  stage: string;
  usage: UsageInfo;
}

export class UsageTracker {
  private entries: AgentUsageEntry[] = [];

  record(agent: string, stage: string, usage: UsageInfo): void {
    this.entries.push({ agent, stage, usage });
  }

  getTotalCost(): number {
    return this.entries.reduce((sum, e) => sum + (e.usage.costUsd ?? 0), 0);
  }

  getByAgent(): Map<string, { cost: number; inputTokens: number; outputTokens: number; calls: number }> {
    const map = new Map<string, { cost: number; inputTokens: number; outputTokens: number; calls: number }>();
    for (const entry of this.entries) {
      const existing = map.get(entry.agent) ?? { cost: 0, inputTokens: 0, outputTokens: 0, calls: 0 };
      existing.cost += entry.usage.costUsd ?? 0;
      existing.inputTokens += entry.usage.inputTokens ?? 0;
      existing.outputTokens += entry.usage.outputTokens ?? 0;
      existing.calls += 1;
      map.set(entry.agent, existing);
    }
    return map;
  }

  getEntries(): AgentUsageEntry[] {
    return [...this.entries];
  }
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function formatCost(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

function formatTokenCount(n: number): string {
  if (n >= 1000) {
    return n.toLocaleString("en-US");
  }
  return String(n);
}

export function printUsageSummary(tracker: UsageTracker): void {
  const entries = tracker.getEntries();
  if (entries.length === 0) return;

  const totalCost = tracker.getTotalCost();
  const totalDuration = entries.reduce((sum, e) => sum + (e.usage.durationMs ?? 0), 0);
  const totalInput = entries.reduce((sum, e) => sum + (e.usage.inputTokens ?? 0), 0);
  const totalOutput = entries.reduce((sum, e) => sum + (e.usage.outputTokens ?? 0), 0);
  const byAgent = tracker.getByAgent();

  console.log("");
  console.log(chalk.bold.cyan("┌─ Usage Summary"));
  console.log(chalk.cyan("│") + `  Total cost:  ${chalk.bold(formatCost(totalCost))}`);
  console.log(chalk.cyan("│") + `  Duration:    ${formatDuration(totalDuration)}`);
  if (totalInput > 0 || totalOutput > 0) {
    console.log(chalk.cyan("│") + `  Tokens:      ${formatTokenCount(totalInput)} in / ${formatTokenCount(totalOutput)} out`);
  }
  console.log(chalk.cyan("│"));
  console.log(chalk.cyan("│") + `  By agent:`);

  for (const [agent, stats] of byAgent) {
    const callLabel = stats.calls === 1 ? "1 call" : `${stats.calls} calls`;
    console.log(chalk.cyan("│") + `    ${agent.padEnd(20)} ${formatCost(stats.cost).padStart(7)}  (${callLabel})`);
  }

  console.log(chalk.cyan("└─"));
}

export function printVerboseUsage(tracker: UsageTracker): void {
  const entries = tracker.getEntries();
  if (entries.length === 0) return;

  console.log("");
  console.log(chalk.bold.cyan("┌─ Detailed Usage"));

  for (const entry of entries) {
    const { agent, stage, usage } = entry;
    const tokens = (usage.inputTokens || usage.outputTokens)
      ? `  ${formatTokenCount(usage.inputTokens ?? 0)} in / ${formatTokenCount(usage.outputTokens ?? 0)} out`
      : "";
    console.log(
      chalk.cyan("│") +
      `  ${chalk.bold(agent)} ${chalk.gray(`(${stage})`)}  ` +
      `${formatCost(usage.costUsd ?? 0)}  ${formatDuration(usage.durationMs ?? 0)}  ${usage.numTurns ?? 0} turns${tokens}`,
    );
  }

  console.log(chalk.cyan("└─"));
}
