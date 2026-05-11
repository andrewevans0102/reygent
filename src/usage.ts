import chalk from "chalk";
import { wrapText } from "./format.js";
import { PROVIDER_PRICING, type ProviderName } from "./pricing.js";
import { getChesstrace } from "./chesstrace/index.js";
import { Events } from "./chesstrace/events.js";

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

    // Emit telemetry events (no-op if telemetry disabled)
    const chesstrace = getChesstrace();
    if (!chesstrace || !chesstrace.isEnabled()) {
      return;
    }

    // Emit usage.tokens event
    chesstrace.emit(Events.USAGE_TOKENS, {
      agent,
      stage,
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      cachedTokens: usage.cachedTokens ?? 0,
      cacheWriteTokens: usage.cacheWriteTokens ?? 0,
      provider: usage.provider,
    });

    // Calculate cache savings and emit usage.cost event
    const cacheSavingsUsd = calculateCacheSavings(usage);
    chesstrace.emit(Events.USAGE_COST, {
      agent,
      stage,
      costUsd: usage.costUsd,
      cacheSavingsUsd,
    });
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


/** Estimate dollar savings from cached tokens for a single entry. */
export function calculateCacheSavings(usage: UsageInfo): number {
  // OpenRouter reports cacheDiscount as a dollar amount — use directly when cachedTokens is absent
  if (usage.cacheDiscount && usage.cacheDiscount > 0 && (usage.cachedTokens ?? 0) === 0) {
    return usage.cacheDiscount;
  }
  const cached = usage.cachedTokens ?? 0;
  if (cached === 0) return 0;
  const provider = usage.provider ?? "claude";
  const discount = PROVIDER_PRICING[provider]?.cacheDiscountRate ?? 0.50;
  const costPerMillion = PROVIDER_PRICING[provider]?.inputCostPerMillion ?? 3.00;
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
    const prefix = chalk.cyan("│") + "    ";

    // First line: agent name, cost, calls
    console.log(prefix + `${agent.padEnd(12)} ${formatCost(stats.cost).padStart(7)}  (${callLabel})`);

    // Second line: token breakdown (if present)
    if (stats.inputTokens > 0 || stats.outputTokens > 0) {
      const tokenParts: string[] = [];
      tokenParts.push(`${formatTokenCount(stats.inputTokens)} in`);
      tokenParts.push(`${formatTokenCount(stats.outputTokens)} out`);
      if (stats.cachedTokens > 0) {
        tokenParts.push(`${formatTokenCount(stats.cachedTokens)} cached`);
      }
      console.log(prefix + chalk.gray(`  ${tokenParts.join(" / ")}`));
    }

    // Third line: cache savings and hit rate (if present)
    const agentSavings = stats.cachedTokens > 0 && stats.provider
      ? calculateCacheSavings({ cachedTokens: stats.cachedTokens, provider: stats.provider })
      : 0;
    const hitRate = stats.inputTokens > 0 && stats.cachedTokens > 0
      ? Math.round((stats.cachedTokens / stats.inputTokens) * 100)
      : 0;

    if (agentSavings > 0 || hitRate > 0) {
      const parts: string[] = [];
      if (agentSavings > 0) parts.push(chalk.green(formatCost(agentSavings) + " saved"));
      if (hitRate > 0) parts.push(chalk.green(hitRate + "% hit"));
      console.log(prefix + `  ${parts.join(" ")}`);
    }
  }

  console.log(chalk.cyan("└─"));

  // Print cache warnings after summary
  printCacheWarnings(tracker);
}

export function printVerboseUsage(tracker: UsageTracker): void {
  const entries = tracker.getEntries();
  if (entries.length === 0) return;

  console.log("");
  console.log(chalk.bold.cyan("┌─ Detailed Usage") + chalk.gray(" (--verbose)"));

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
