import chalk from "chalk";
import { wrapText } from "./format.js";

export type ProviderName = "claude" | "codex" | "openrouter" | "gemini";

export interface UsageInfo {
  costUsd?: number;
  durationMs?: number;
  numTurns?: number;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  cacheWriteTokens?: number;
  cacheDiscount?: number;
  provider?: ProviderName;
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

  getByAgent(): Map<string, { cost: number; inputTokens: number; outputTokens: number; cachedTokens: number; cacheWriteTokens: number; calls: number; provider?: ProviderName }> {
    const map = new Map<string, { cost: number; inputTokens: number; outputTokens: number; cachedTokens: number; cacheWriteTokens: number; calls: number; provider?: ProviderName }>();
    for (const entry of this.entries) {
      const existing = map.get(entry.agent) ?? { cost: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0, calls: 0 };
      existing.cost += entry.usage.costUsd ?? 0;
      existing.inputTokens += entry.usage.inputTokens ?? 0;
      existing.outputTokens += entry.usage.outputTokens ?? 0;
      existing.cachedTokens += entry.usage.cachedTokens ?? 0;
      existing.cacheWriteTokens += entry.usage.cacheWriteTokens ?? 0;
      existing.calls += 1;
      if (entry.usage.provider) existing.provider = entry.usage.provider;
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
  if (usd > 0 && usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function formatTokenCount(n: number): string {
  if (n >= 1000) {
    return n.toLocaleString("en-US");
  }
  return String(n);
}

/**
 * Per-provider cached token discount rates.
 * Savings = cachedTokens * costPerMillion * discountMultiplier
 * Claude: cached tokens billed at ~10% → discount = 0.90 (save 90%)
 * Codex (OpenAI): cached tokens billed at 25% → discount = 0.75 (save 75%)
 * OpenRouter: passthrough, use conservative estimate
 * Gemini: varies, use conservative estimate
 */
const CACHE_DISCOUNT_RATES: Record<ProviderName, number> = {
  claude: 0.90,
  codex: 0.75,
  openrouter: 0.50,
  gemini: 0.50,
};

// Rough per-1M-token input cost by provider (USD) for savings estimation
const INPUT_COST_PER_MILLION: Record<ProviderName, number> = {
  claude: 3.00,
  codex: 2.50,
  openrouter: 3.00,
  gemini: 1.25,
};

/** Estimate dollar savings from cached tokens for a single entry. */
export function calculateCacheSavings(usage: UsageInfo): number {
  // OpenRouter reports cacheDiscount as a dollar amount — use directly when cachedTokens is absent
  if (usage.cacheDiscount && usage.cacheDiscount > 0 && (usage.cachedTokens ?? 0) === 0) {
    return usage.cacheDiscount;
  }
  const cached = usage.cachedTokens ?? 0;
  if (cached === 0) return 0;
  const provider = usage.provider ?? "claude";
  const discount = CACHE_DISCOUNT_RATES[provider] ?? 0.50;
  const costPerMillion = INPUT_COST_PER_MILLION[provider] ?? 3.00;
  return (cached / 1_000_000) * costPerMillion * discount;
}

/** Providers where caching is reliable enough to warn when absent. */
const CACHE_WARN_PROVIDERS = new Set<ProviderName>(["claude", "codex"]);

/**
 * Print warnings if caching appears inactive for providers that support it.
 * Only warns when inputTokens > 0 and cachedTokens is 0.
 */
export function printCacheWarnings(tracker: UsageTracker): void {
  const entries = tracker.getEntries();
  const warned = new Set<string>();

  for (const entry of entries) {
    const { agent, usage } = entry;
    const provider = usage.provider;
    if (!provider || !CACHE_WARN_PROVIDERS.has(provider)) continue;
    if (warned.has(agent)) continue;

    const hasInput = (usage.inputTokens ?? 0) > 0;
    const noCacheHit = (usage.cachedTokens ?? 0) === 0;
    if (hasInput && noCacheHit) {
      console.error(
        chalk.yellow("⚠") +
        chalk.yellow(` [${agent}] Prompt caching appears inactive for ${provider} provider. `) +
        chalk.yellow("Repeated context is not being cached — costs may be higher than expected."),
      );
      warned.add(agent);
    }
  }
}

export function printUsageSummary(tracker: UsageTracker): void {
  const entries = tracker.getEntries();
  if (entries.length === 0) return;

  const totalCost = tracker.getTotalCost();
  const totalDuration = entries.reduce((sum, e) => sum + (e.usage.durationMs ?? 0), 0);
  const totalInput = entries.reduce((sum, e) => sum + (e.usage.inputTokens ?? 0), 0);
  const totalOutput = entries.reduce((sum, e) => sum + (e.usage.outputTokens ?? 0), 0);
  const totalCached = entries.reduce((sum, e) => sum + (e.usage.cachedTokens ?? 0), 0);
  const totalSavings = entries.reduce((sum, e) => sum + calculateCacheSavings(e.usage), 0);
  const byAgent = tracker.getByAgent();

  console.log("");
  console.log(chalk.bold.cyan("┌─ Usage Summary"));
  console.log(chalk.cyan("│") + `  Total cost:  ${chalk.bold(formatCost(totalCost))}`);
  console.log(chalk.cyan("│") + `  Duration:    ${formatDuration(totalDuration)}`);
  if (totalInput > 0 || totalOutput > 0) {
    const cachedSuffix = totalCached > 0
      ? ` / ${formatTokenCount(totalCached)} cached`
      : "";
    console.log(chalk.cyan("│") + `  Tokens:      ${formatTokenCount(totalInput)} in / ${formatTokenCount(totalOutput)} out${cachedSuffix}`);
  }
  if (totalSavings > 0 && Math.round(totalSavings * 100) >= 1) {
    console.log(chalk.cyan("│") + `  Cache saves: ${chalk.green(formatCost(totalSavings))}`);
  }
  console.log(chalk.cyan("│"));
  console.log(chalk.cyan("│") + `  By agent:`);

  for (const [agent, stats] of byAgent) {
    const callLabel = stats.calls === 1 ? "1 call" : `${stats.calls} calls`;
    const tokenParts: string[] = [];
    if (stats.inputTokens > 0 || stats.outputTokens > 0) {
      tokenParts.push(`${formatTokenCount(stats.inputTokens)} in`);
      tokenParts.push(`${formatTokenCount(stats.outputTokens)} out`);
      if (stats.cachedTokens > 0) {
        tokenParts.push(`${formatTokenCount(stats.cachedTokens)} cached`);
      }
    }
    const tokenSuffix = tokenParts.length > 0 ? `  ${tokenParts.join(" / ")}` : "";

    // Per-agent savings
    const agentSavings = stats.cachedTokens > 0 && stats.provider
      ? calculateCacheSavings({ cachedTokens: stats.cachedTokens, provider: stats.provider })
      : 0;
    const savingsSuffix = agentSavings > 0 ? `  ${chalk.green("(" + formatCost(agentSavings) + " saved)")}` : "";

    // Cache hit rate
    const hitRate = stats.inputTokens > 0 && stats.cachedTokens > 0
      ? Math.round((stats.cachedTokens / stats.inputTokens) * 100)
      : 0;
    const hitRateSuffix = hitRate > 0 ? `  ${chalk.green(hitRate + "% hit")}` : "";

    const cols = process.stdout.columns || 80;
    const agentLine = `${agent.padEnd(16)} → ${formatCost(stats.cost).padStart(7)}  (${callLabel})${tokenSuffix}${savingsSuffix}${hitRateSuffix}`;
    // prefix is "│    " = 5 chars
    console.log(chalk.cyan("│") + `    ${wrapText(agentLine, 5, cols)}`);
  }

  console.log(chalk.cyan("└─"));

  // Print cache warnings after summary
  printCacheWarnings(tracker);
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

    // Show cache metadata in verbose mode
    const hasCacheData = (usage.cachedTokens ?? 0) > 0 || (usage.cacheWriteTokens ?? 0) > 0 || (usage.cacheDiscount ?? 0) > 0;
    if (hasCacheData) {
      const savings = calculateCacheSavings(usage);
      const parts: string[] = [];
      if (usage.cachedTokens !== undefined && usage.cachedTokens >= 0) parts.push(`cached: ${formatTokenCount(usage.cachedTokens)}`);
      if (usage.cacheWriteTokens !== undefined && usage.cacheWriteTokens >= 0) parts.push(`cache_write: ${formatTokenCount(usage.cacheWriteTokens)}`);
      if (usage.cacheDiscount !== undefined && usage.cacheDiscount > 0) parts.push(`cache_discount: ${formatCost(usage.cacheDiscount)}`);
      if (savings > 0) parts.push(`saved: ${formatCost(savings)}`);
      if (usage.provider) parts.push(`provider: ${usage.provider}`);
      console.log(
        chalk.cyan("│") +
        `    ${chalk.gray("cache: { " + parts.join(", ") + " }")}`,
      );
    }
  }

  console.log(chalk.cyan("└─"));
}
