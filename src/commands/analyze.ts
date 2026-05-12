import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import Table from "cli-table3";
import { loadConfig } from "../config.js";
import { SqliteBackend } from "../chesstrace/backends/sqlite.js";
import type { TelemetryEvent } from "../chesstrace/events.js";
import { Events } from "../chesstrace/events.js";
import { analyzeFailurePatterns, analyzeSuccessPatterns } from "../knowledge/analyzer.js";
import { addFailureEntry, addPatternEntry } from "../knowledge/manager.js";

/**
 * Cost estimation constants
 */
// Conservative estimate of retry cost as fraction of total monthly spend
// Based on typical gate retry patterns adding ~10% overhead
const RETRY_COST_ESTIMATE_MULTIPLIER = 0.1;

// Conservative estimate of recoverable failure cost as fraction of failed spend
// Assumes ~50% of failures preventable through config/prompt improvements
const POTENTIAL_SAVINGS_MULTIPLIER = 0.5;

interface AnalyzeOptions {
  agent?: string;
  since?: string;
  limit?: string;
  stage?: string;
  minSuccessRate?: string;
  byAgent?: boolean;
  showRuns?: boolean;
  compareModels?: boolean;
  updateKnowledge?: boolean;
}

/**
 * Parse duration string like "30d", "7d" into timestamp
 */
function parseSince(since: string): number {
  const match = since.match(/^(\d+)d$/);
  if (!match) {
    throw new Error(`Invalid duration format: ${since}. Use format like "30d", "7d".`);
  }
  const days = Number.parseInt(match[1], 10);
  return Date.now() - days * 24 * 60 * 60 * 1000;
}

/**
 * Format timestamp to relative time
 */
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  const hours = Math.floor(diff / (60 * 60 * 1000));

  if (days > 0) return `${days} day${days > 1 ? "s" : ""} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  return "< 1 hour ago";
}

/**
 * Format duration in milliseconds
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);

  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

/**
 * Format USD cost
 */
function formatCost(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

/**
 * Format percentage
 */
function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/**
 * Group events by key function
 */
function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return groups;
}

/**
 * Filter events by category or event type
 */
function filterEvents(
  events: TelemetryEvent[],
  criteria: { category?: string; event?: string }
): TelemetryEvent[] {
  return events.filter(e => {
    if (criteria.category && e.category !== criteria.category) return false;
    if (criteria.event && e.event !== criteria.event) return false;
    return true;
  });
}

/**
 * Get backend instance
 */
async function getBackend(): Promise<SqliteBackend> {
  const backend = new SqliteBackend("local");
  await backend.init();
  return backend;
}

/**
 * Check if telemetry is enabled
 */
function checkTelemetryEnabled(config: ReturnType<typeof loadConfig>): void {
  if (!config.telemetry?.enabled) {
    console.log(chalk.yellow("\nTelemetry is disabled. Enable with:"));
    console.log(chalk.cyan("  reygent telemetry enable\n"));
    process.exit(1);
  }
}

/**
 * reygent analyze failures - show common failure patterns
 */
export async function analyzeFailures(options: AnalyzeOptions): Promise<void> {
  const spinner = ora("Analyzing failure patterns...").start();

  try {
    const config = loadConfig();
    checkTelemetryEnabled(config);

    const backend = await getBackend();
    const since = options.since ? parseSince(options.since) : Date.now() - 30 * 24 * 60 * 60 * 1000;

    // Query all error events
    const allEvents = await backend.query({ startTime: since });
    const errorEvents = filterEvents(allEvents, { category: "error" });
    const pipelineEvents = filterEvents(allEvents, { event: Events.PIPELINE_END });

    await backend.close();

    if (errorEvents.length === 0) {
      spinner.succeed(chalk.green("No failures found"));
      console.log(chalk.yellow("\nNo error events in telemetry data"));
      return;
    }

    const totalRuns = new Set(pipelineEvents.map(e => e.runId)).size;
    const days = Math.floor((Date.now() - since) / (24 * 60 * 60 * 1000));

    spinner.succeed(chalk.green(`Analyzed ${errorEvents.length} error(s) from ${totalRuns} run(s)`));

    console.log();
    console.log(chalk.bold(`Failure Analysis (last ${days} days, ${totalRuns} runs)`));
    console.log();

    // Group by event type
    const patternGroups = groupBy(errorEvents, e => e.event);

    // Sort by occurrence count
    const sortedPatterns = Array.from(patternGroups.entries())
      .sort((a, b) => b[1].length - a[1].length);

    // Apply limit
    const limit = options.limit ? Number.parseInt(options.limit, 10) : sortedPatterns.length;
    const topPatterns = sortedPatterns.slice(0, limit);

    console.log(chalk.bold("Top Failure Patterns:"));
    console.log();

    for (let i = 0; i < topPatterns.length; i++) {
      const [eventName, events] = topPatterns[i];
      const agentGroups = groupBy(events, e => (e.data.agent as string) || "unknown");
      const mostRecent = events.reduce((a, b) => a.timestamp > b.timestamp ? a : b);

      console.log(chalk.cyan(`${i + 1}. ${eventName}`) + chalk.gray(` (${events.length} occurrences)`));

      // Show agent breakdown
      const agentSummary = Array.from(agentGroups.entries())
        .map(([agent, events]) => `${agent} (${events.length})`)
        .join(", ");
      console.log(`   Agents: ${agentSummary}`);

      // Show common message if available
      const messages = events
        .map(e => e.data.message as string)
        .filter(Boolean);
      if (messages.length > 0) {
        const commonMsg = messages[0] ?? "Unknown error";
        console.log(`   Common: "${commonMsg}"`);
      }

      // Show most recent
      console.log(`   Most recent: run ${mostRecent.runId.substring(0, 8)} (${formatRelativeTime(mostRecent.timestamp)})`);
      console.log();
    }

    // Recommendations
    console.log(chalk.bold("Recommendations:"));
    const recommendations: string[] = [];

    // Parse error recommendations
    const parseErrors = errorEvents.filter(e => e.event === Events.ERROR_PARSE);
    if (parseErrors.length > 0) {
      const parseAgents = new Set(parseErrors.map(e => e.data.agent as string));
      for (const agent of parseAgents) {
        const count = parseErrors.filter(e => e.data.agent === agent).length;
        recommendations.push(`• ${agent} has ${count} parse failure(s) - review output format expectations`);
      }
    }

    // Gate retry recommendations
    const gateRetries = allEvents.filter(e => e.event === Events.GATE_RETRY);
    if (gateRetries.length > 0) {
      const gateGroups = groupBy(gateRetries, e => e.data.gateName as string);
      for (const [gateName, events] of gateGroups) {
        const avgAttempts = events.reduce((sum, e) => sum + (e.data.attempt as number), 0) / events.length;
        recommendations.push(`• ${gateName} requires ${avgAttempts.toFixed(1)} avg retries - consider relaxing criteria`);
      }
    }

    // Provider error recommendations
    const providerErrors = errorEvents.filter(e => e.event === Events.ERROR_PROVIDER);
    if (providerErrors.length > 0) {
      const reasons = providerErrors.map(e => e.data.reason as string).filter(Boolean);
      if (reasons.some(r => r.includes("rate limit"))) {
        recommendations.push("• Rate limits hit during peak hours - consider request throttling");
      }
    }

    if (recommendations.length === 0) {
      console.log(chalk.gray("  No specific recommendations"));
    } else {
      for (const rec of recommendations) {
        console.log(rec);
      }
    }
    console.log();

    // Update knowledge if requested
    if (options.updateKnowledge) {
      const updateSpinner = ora("Updating knowledge base...").start();

      try {
        // Use analyzer to extract structured patterns
        const patterns = analyzeFailurePatterns(backend, since);

        if (patterns.length === 0) {
          updateSpinner.info(chalk.yellow("No recurring patterns to add"));
        } else {
          let addedCount = 0;
          const limit = options.limit ? Number.parseInt(options.limit, 10) : 5;

          for (const pattern of patterns.slice(0, limit)) {
            // Add entry for each agent affected
            for (const agent of pattern.agents) {
              await addFailureEntry(process.cwd(), {
                issue: pattern.pattern,
                solution: "Review telemetry for details",
                agent: agent as any,
              });
              addedCount++;
            }
          }

          updateSpinner.succeed(chalk.green(`Added ${addedCount} failure pattern(s) to knowledge base`));
          console.log(chalk.gray(`  See .reygent/knowledge/common-failures.md`));
          console.log();
        }
      } catch (err) {
        updateSpinner.fail(chalk.red(`Failed to update knowledge: ${(err as Error).message}`));
      }
    }

  } catch (err) {
    spinner.fail(chalk.red(`Failed to analyze failures: ${(err as Error).message}`));
    process.exit(1);
  }
}

/**
 * reygent analyze success - extract patterns from successful runs
 */
export async function analyzeSuccess(options: AnalyzeOptions): Promise<void> {
  const spinner = ora("Analyzing success patterns...").start();

  try {
    const config = loadConfig();
    checkTelemetryEnabled(config);

    const backend = await getBackend();
    const since = options.since ? parseSince(options.since) : Date.now() - 30 * 24 * 60 * 60 * 1000;

    const allEvents = await backend.query({ startTime: since });
    const pipelineEvents = filterEvents(allEvents, { event: Events.PIPELINE_END });
    const agentSpawnEvents = filterEvents(allEvents, { event: Events.AGENT_SPAWN });
    const agentCompleteEvents = filterEvents(allEvents, { event: Events.AGENT_COMPLETE });

    await backend.close();

    const successfulRuns = pipelineEvents.filter(e => e.data.success === true);
    const days = Math.floor((Date.now() - since) / (24 * 60 * 60 * 1000));

    if (successfulRuns.length === 0) {
      spinner.succeed(chalk.yellow("No successful runs found"));
      return;
    }

    spinner.succeed(chalk.green(`Analyzed ${successfulRuns.length} successful run(s)`));

    console.log();
    console.log(chalk.bold(`Success Analysis (last ${days} days, ${successfulRuns.length} successful runs)`));
    console.log();

    // Agent Performance
    console.log(chalk.bold("Agent Performance:"));
    console.log();

    const agentStats = new Map<string, {
      spawns: number;
      completions: number;
      successes: number;
      totalDuration: number;
      models: Map<string, number>;
    }>();

    for (const spawn of agentSpawnEvents) {
      const agent = spawn.data.agent as string;
      const model = spawn.data.model as string;

      const stats = agentStats.get(agent) || {
        spawns: 0,
        completions: 0,
        successes: 0,
        totalDuration: 0,
        models: new Map(),
      };

      stats.spawns++;
      stats.models.set(model, (stats.models.get(model) || 0) + 1);
      agentStats.set(agent, stats);
    }

    for (const complete of agentCompleteEvents) {
      const agent = complete.data.agent as string;
      const success = complete.data.success === true;
      const duration = complete.data.duration as number;

      const stats = agentStats.get(agent);
      if (stats) {
        stats.completions++;
        if (success) stats.successes++;
        if (duration) stats.totalDuration += duration;
      }
    }

    for (const [agent, stats] of agentStats) {
      const successRate = stats.completions > 0 ? stats.successes / stats.completions : 0;
      const avgDuration = stats.completions > 0 ? stats.totalDuration / stats.completions : 0;

      // Apply min success rate filter if provided
      if (options.minSuccessRate) {
        const minRate = Number.parseFloat(options.minSuccessRate) / 100;
        if (successRate < minRate) continue;
      }

      // Apply --stage filter if provided
      if (options.stage) {
        // Filter agent events by stage
        const stageEvents = allEvents.filter(e =>
          e.data.stage === options.stage &&
          (e.event === Events.AGENT_SPAWN || e.event === Events.AGENT_COMPLETE)
        );
        const stageAgents = new Set(stageEvents.map(e => e.data.agent as string));
        if (!stageAgents.has(agent)) continue;
      }

      console.log(chalk.cyan(`${agent}:`));
      console.log(`  Runs: ${stats.completions}`);
      console.log(`  Success rate: ${formatPercent(successRate)} (${stats.successes} success, ${stats.completions - stats.successes} failures)`);
      console.log(`  Avg duration: ${formatDuration(avgDuration)}`);

      const modelDist = Array.from(stats.models.entries())
        .map(([model, count]) => `${model} (${Math.round(count / stats.completions * 100)}%)`)
        .join(", ");
      console.log(`  Model distribution: ${modelDist}`);
      console.log();
    }

    console.log(chalk.bold("Recommendations:"));
    const recommendations: string[] = [];

    // Find best performers
    const sortedAgents = Array.from(agentStats.entries())
      .filter(([_, stats]) => stats.completions > 0)
      .map(([agent, stats]) => ({
        agent,
        successRate: stats.successes / stats.completions,
        completions: stats.completions,
      }))
      .sort((a, b) => b.successRate - a.successRate);

    if (sortedAgents.length > 0) {
      const best = sortedAgents[0];
      if (best.successRate >= 0.9) {
        recommendations.push(`• ${best.agent}: Best performer (${formatPercent(best.successRate)} success)`);
      }
    }

    if (recommendations.length === 0) {
      console.log(chalk.gray("  No specific recommendations"));
    } else {
      for (const rec of recommendations) {
        console.log(rec);
      }
    }
    console.log();

    // Update knowledge if requested
    if (options.updateKnowledge) {
      const updateSpinner = ora("Updating knowledge base...").start();

      try {
        // Use analyzer to extract structured patterns
        const minRate = options.minSuccessRate ? Number.parseFloat(options.minSuccessRate) / 100 : 0.8;
        const patterns = analyzeSuccessPatterns(backend, since, minRate);

        if (patterns.length === 0) {
          updateSpinner.info(chalk.yellow("No high-success patterns to add"));
        } else {
          let addedCount = 0;
          const limit = 5; // Top 5 patterns

          for (const pattern of patterns.slice(0, limit)) {
            await addPatternEntry(process.cwd(), {
              description: pattern.pattern,
              successRate: Math.round(pattern.successRate * 100),
            });
            addedCount++;
          }

          updateSpinner.succeed(chalk.green(`Added ${addedCount} success pattern(s) to knowledge base`));
          console.log(chalk.gray(`  See .reygent/knowledge/success-patterns.md`));
          console.log();
        }
      } catch (err) {
        updateSpinner.fail(chalk.red(`Failed to update knowledge: ${(err as Error).message}`));
      }
    }

  } catch (err) {
    spinner.fail(chalk.red(`Failed to analyze success: ${(err as Error).message}`));
    process.exit(1);
  }
}

/**
 * reygent analyze costs - cost breakdown and optimization
 */
export async function analyzeCosts(options: AnalyzeOptions): Promise<void> {
  const spinner = ora("Analyzing costs...").start();

  try {
    const config = loadConfig();
    checkTelemetryEnabled(config);

    const backend = await getBackend();
    const since = options.since ? parseSince(options.since) : Date.now() - 30 * 24 * 60 * 60 * 1000;

    const allEvents = await backend.query({ startTime: since });
    const costEvents = filterEvents(allEvents, { event: Events.USAGE_COST });
    const pipelineEvents = filterEvents(allEvents, { event: Events.PIPELINE_END });

    await backend.close();

    if (costEvents.length === 0) {
      spinner.succeed(chalk.yellow("No cost data found"));
      console.log(chalk.gray("\nEnable verbose telemetry to track costs:"));
      console.log(chalk.cyan("  reygent run --telemetry-level verbose\n"));
      return;
    }

    const totalRuns = new Set(pipelineEvents.map(e => e.runId)).size;
    const successfulRuns = pipelineEvents.filter(e => e.data.success === true).length;
    const failedRuns = totalRuns - successfulRuns;
    const days = Math.floor((Date.now() - since) / (24 * 60 * 60 * 1000));

    spinner.succeed(chalk.green(`Analyzed ${costEvents.length} cost event(s)`));

    console.log();
    console.log(chalk.bold(`Cost Analysis (last ${days} days, ${totalRuns} runs)`));
    console.log();

    // Calculate total costs
    const totalCost = costEvents.reduce((sum, e) => sum + (e.data.costUsd as number), 0);

    // Separate successful vs failed run costs
    const successRunIds = new Set(
      pipelineEvents.filter(e => e.data.success === true).map(e => e.runId)
    );
    const successCost = costEvents
      .filter(e => successRunIds.has(e.runId))
      .reduce((sum, e) => sum + (e.data.costUsd as number), 0);
    const failedCost = totalCost - successCost;

    console.log(chalk.bold("Total Spend:"), chalk.cyan(formatCost(totalCost)));
    console.log(`Successful runs: ${formatCost(successCost)} (${formatPercent(successCost / totalCost)})`);
    console.log(`Failed runs: ${formatCost(failedCost)} (${formatPercent(failedCost / totalCost)} - wasted)`);
    console.log();

    // Cost by stage (if available)
    if (options.byAgent) {
      console.log(chalk.bold("Cost by Agent:"));
      const agentCosts = new Map<string, { cost: number; runs: Set<string> }>();

      for (const event of costEvents) {
        const agent = event.data.agent as string || "unknown";
        const cost = event.data.costUsd as number;
        const existing = agentCosts.get(agent) || { cost: 0, runs: new Set() };
        existing.cost += cost;
        existing.runs.add(event.runId);
        agentCosts.set(agent, existing);
      }

      const sortedAgents = Array.from(agentCosts.entries())
        .sort((a, b) => b[1].cost - a[1].cost);

      for (const [agent, data] of sortedAgents) {
        const percent = (data.cost / totalCost) * 100;
        const avgCost = data.cost / data.runs.size;
        console.log(`  ${agent}: ${formatCost(data.cost)} (${percent.toFixed(0)}%) - ${data.runs.size} runs, avg ${formatCost(avgCost)}/run`);
      }
      console.log();
    } else {
      console.log(chalk.bold("Cost by Stage:"));
      const stageCosts = new Map<string, { cost: number; runs: Set<string> }>();

      for (const event of costEvents) {
        const stage = (event.data.stage as string) ?? "unknown";
        const cost = event.data.costUsd as number;
        const existing = stageCosts.get(stage) || { cost: 0, runs: new Set() };
        existing.cost += cost;
        existing.runs.add(event.runId);
        stageCosts.set(stage, existing);
      }

      const sortedStages = Array.from(stageCosts.entries())
        .sort((a, b) => b[1].cost - a[1].cost);

      for (const [stage, data] of sortedStages) {
        const percent = (data.cost / totalCost) * 100;
        const avgCost = data.cost / data.runs.size;
        console.log(`  ${stage}: ${formatCost(data.cost)} (${percent.toFixed(0)}%) - ${data.runs.size} runs, avg ${formatCost(avgCost)}/run`);
      }
      console.log();
    }

    // Expensive failures
    if (failedRuns > 0 && options.showRuns) {
      console.log(chalk.bold("Expensive Failures (top 3):"));

      const failedRunIds = new Set(
        pipelineEvents
          .filter(e => e.data.success !== true)
          .map(e => e.runId)
      );

      const failureRunCosts = new Map<string, number>();
      for (const event of costEvents) {
        if (failedRunIds.has(event.runId)) {
          const existing = failureRunCosts.get(event.runId) || 0;
          failureRunCosts.set(event.runId, existing + (event.data.costUsd as number));
        }
      }

      // Build Map for O(1) stage lookups
      const runIdToStage = new Map<string, string>();
      for (const event of allEvents) {
        if (event.event === Events.PIPELINE_STAGE_END) {
          runIdToStage.set(event.runId, (event.data.stage as string) || "unknown");
        }
      }

      const topFailures = Array.from(failureRunCosts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);

      for (let i = 0; i < topFailures.length; i++) {
        const [runId, cost] = topFailures[i];
        const stage = runIdToStage.get(runId) || "unknown stage";
        console.log(`  ${i + 1}. run ${runId.substring(0, 8)}: ${formatCost(cost)} (${stage})`);
      }
      console.log();
    }

    // Optimization opportunities
    console.log(chalk.bold("Optimization Opportunities:"));
    const recommendations: string[] = [];

    if (failedCost > 0) {
      const wastePercent = (failedCost / totalCost) * 100;
      recommendations.push(`• ${formatPercent(failedCost / totalCost)} spend on failed runs - see 'reygent analyze failures' to reduce`);
    }

    const gateRetries = allEvents.filter(e => e.event === Events.GATE_RETRY);
    if (gateRetries.length > 0) {
      const monthlyCost = (totalCost / days) * 30;
      const retryCostEst = monthlyCost * RETRY_COST_ESTIMATE_MULTIPLIER;
      recommendations.push(`• Gate retry loops cost ~${formatCost(retryCostEst)}/month - review gate criteria`);
    }

    const potentialSavings = failedCost * POTENTIAL_SAVINGS_MULTIPLIER;
    if (potentialSavings > 0) {
      const monthlySavings = (potentialSavings / days) * 30;
      recommendations.push(`\nPotential Savings: ${formatCost(monthlySavings)}/month (${formatPercent(potentialSavings / totalCost)})`);
    }

    if (recommendations.length === 0) {
      console.log(chalk.gray("  No specific recommendations"));
    } else {
      for (const rec of recommendations) {
        console.log(rec);
      }
    }
    console.log();

  } catch (err) {
    spinner.fail(chalk.red(`Failed to analyze costs: ${(err as Error).message}`));
    process.exit(1);
  }
}

/**
 * reygent analyze agents - agent-specific performance breakdown
 */
export async function analyzeAgents(options: AnalyzeOptions): Promise<void> {
  const spinner = ora("Analyzing agent performance...").start();

  try {
    const config = loadConfig();
    checkTelemetryEnabled(config);

    const backend = await getBackend();
    const since = options.since ? parseSince(options.since) : Date.now() - 30 * 24 * 60 * 60 * 1000;

    const allEvents = await backend.query({ startTime: since });
    const agentSpawnEvents = filterEvents(allEvents, { event: Events.AGENT_SPAWN });
    const agentCompleteEvents = filterEvents(allEvents, { event: Events.AGENT_COMPLETE });
    const errorEvents = filterEvents(allEvents, { category: "error" });
    const costEvents = filterEvents(allEvents, { event: Events.USAGE_COST });

    await backend.close();

    if (agentSpawnEvents.length === 0) {
      spinner.succeed(chalk.yellow("No agent data found"));
      return;
    }

    const days = Math.floor((Date.now() - since) / (24 * 60 * 60 * 1000));

    spinner.succeed(chalk.green(`Analyzed ${agentSpawnEvents.length} agent spawn(s)`));

    console.log();
    console.log(chalk.bold(`Agent Performance Analysis (last ${days} days)`));
    console.log();

    // Build per-agent stats
    interface AgentStats {
      spawns: number;
      completions: number;
      successes: number;
      failures: number;
      totalDuration: number;
      totalCost: number;
      models: Map<string, number>;
      errorTypes: Map<string, number>;
    }

    const agentStats = new Map<string, AgentStats>();

    // Process spawns
    for (const spawn of agentSpawnEvents) {
      const agent = spawn.data.agent as string;
      const model = spawn.data.model as string;

      const stats = agentStats.get(agent) || {
        spawns: 0,
        completions: 0,
        successes: 0,
        failures: 0,
        totalDuration: 0,
        totalCost: 0,
        models: new Map(),
        errorTypes: new Map(),
      };

      stats.spawns++;
      stats.models.set(model, (stats.models.get(model) || 0) + 1);
      agentStats.set(agent, stats);
    }

    // Process completions
    for (const complete of agentCompleteEvents) {
      const agent = complete.data.agent as string;
      const success = complete.data.success === true;
      const duration = complete.data.duration as number;

      const stats = agentStats.get(agent);
      if (stats) {
        stats.completions++;
        if (success) {
          stats.successes++;
        } else {
          stats.failures++;
        }
        if (duration) stats.totalDuration += duration;
      }
    }

    // Process errors
    for (const error of errorEvents) {
      const agent = error.data.agent as string;
      const stats = agentStats.get(agent);
      if (stats) {
        const errorType = error.event;
        stats.errorTypes.set(errorType, (stats.errorTypes.get(errorType) || 0) + 1);
      }
    }

    // Process costs
    for (const cost of costEvents) {
      const agent = cost.data.agent as string;
      const stats = agentStats.get(agent);
      if (stats) {
        stats.totalCost += cost.data.costUsd as number;
      }
    }

    // Filter by specific agent if provided
    let agentsToShow: [string, AgentStats][];
    if (options.agent) {
      const requestedStats = agentStats.get(options.agent);
      if (!requestedStats) {
        spinner.warn(chalk.yellow(`Agent "${options.agent}" not found in telemetry data`));
        console.log(chalk.gray(`\nAvailable agents: ${Array.from(agentStats.keys()).join(", ")}`));
        return;
      }
      agentsToShow = [[options.agent, requestedStats]];
    } else {
      agentsToShow = Array.from(agentStats.entries());
    }

    // Display agent stats
    for (const [agent, stats] of agentsToShow) {

      const successRate = stats.completions > 0 ? stats.successes / stats.completions : 0;
      const avgDuration = stats.completions > 0 ? stats.totalDuration / stats.completions : 0;
      const avgCost = stats.completions > 0 ? stats.totalCost / stats.completions : 0;

      console.log(chalk.bold.cyan(agent + ":"));
      console.log(`  Runs: ${stats.completions}`);
      console.log(`  Success rate: ${formatPercent(successRate)} (${stats.successes} success, ${stats.failures} failures)`);
      console.log(`  Avg duration: ${formatDuration(avgDuration)}`);

      if (stats.totalCost > 0) {
        console.log(`  Avg cost: ${formatCost(avgCost)}`);
      }

      const modelDist = Array.from(stats.models.entries())
        .map(([model, count]) => `${model} (${Math.round(count / stats.spawns * 100)}%)`)
        .join(", ");
      console.log(`  Model distribution: ${modelDist}`);

      // Compare models if requested
      if (options.compareModels && stats.models.size > 1) {
        console.log(`\n  Model Comparison:`);

        // Build model-specific stats
        const modelPerformance = new Map<string, { successes: number; failures: number; totalDuration: number; totalCost: number; count: number }>();

        for (const complete of agentCompleteEvents) {
          if (complete.data.agent !== agent) continue;

          // Find corresponding spawn to get model
          const spawn = agentSpawnEvents.find(s =>
            s.runId === complete.runId &&
            s.data.agent === agent &&
            s.timestamp <= complete.timestamp
          );

          if (!spawn) continue;
          const model = spawn.data.model as string;

          const perf = modelPerformance.get(model) || { successes: 0, failures: 0, totalDuration: 0, totalCost: 0, count: 0 };
          perf.count++;
          if (complete.data.success === true) {
            perf.successes++;
          } else {
            perf.failures++;
          }
          if (complete.data.duration) {
            perf.totalDuration += complete.data.duration as number;
          }

          // Find costs for this completion
          const runCosts = costEvents.filter(c => c.runId === complete.runId && c.data.agent === agent);
          for (const costEvent of runCosts) {
            perf.totalCost += costEvent.data.costUsd as number;
          }

          modelPerformance.set(model, perf);
        }

        for (const [model, perf] of modelPerformance) {
          const successRate = perf.count > 0 ? perf.successes / perf.count : 0;
          const avgDuration = perf.count > 0 ? perf.totalDuration / perf.count : 0;
          const avgCost = perf.count > 0 ? perf.totalCost / perf.count : 0;

          console.log(`    ${model}: ${formatPercent(successRate)} success, avg ${formatDuration(avgDuration)}, avg ${formatCost(avgCost)}`);
        }
        console.log();
      }

      if (stats.errorTypes.size > 0) {
        const topErrors = Array.from(stats.errorTypes.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([type, count]) => `${type} (${count})`)
          .join(", ");
        console.log(`  Top failures: ${topErrors}`);
      }

      console.log();
    }

    // Recommendations
    console.log(chalk.bold("Recommendations:"));
    const recommendations: string[] = [];

    // Find agents with high error rates
    for (const [agent, stats] of agentStats) {
      if (stats.completions > 0) {
        const failureRate = stats.failures / stats.completions;
        if (failureRate > 0.2 && stats.errorTypes.size > 0) {
          const topError = Array.from(stats.errorTypes.entries())
            .sort((a, b) => b[1] - a[1])[0];
          recommendations.push(`• ${agent}: High failure rate (${formatPercent(failureRate)}) - review ${topError[0]} errors`);
        }
      }
    }

    // Find best performer
    const sortedBySuccess = Array.from(agentStats.entries())
      .filter(([_, stats]) => stats.completions > 0)
      .map(([agent, stats]) => ({
        agent,
        successRate: stats.successes / stats.completions,
      }))
      .sort((a, b) => b.successRate - a.successRate);

    if (sortedBySuccess.length > 0 && sortedBySuccess[0].successRate >= 0.9) {
      recommendations.push(`• ${sortedBySuccess[0].agent}: Best performer (${formatPercent(sortedBySuccess[0].successRate)} success)`);
    }

    if (recommendations.length === 0) {
      console.log(chalk.gray("  No specific recommendations"));
    } else {
      for (const rec of recommendations) {
        console.log(rec);
      }
    }
    console.log();

  } catch (err) {
    spinner.fail(chalk.red(`Failed to analyze agents: ${(err as Error).message}`));
    process.exit(1);
  }
}

/**
 * Register analyze command and subcommands
 */
export function registerAnalyzeCommand(program: Command): void {
  const analyze = program
    .command("analyze")
    .description("Analyze telemetry data for insights into failures, successes, costs, and performance");

  analyze
    .command("failures")
    .description("Show common failure patterns from telemetry")
    .option("--agent <name>", "Filter by specific agent")
    .option("--since <duration>", "Time window (e.g., 7d, 30d)", "30d")
    .option("--limit <n>", "Show top N patterns")
    .option("--update-knowledge", "Add patterns to .reygent/knowledge/common-failures.md")
    .action(analyzeFailures);

  analyze
    .command("success")
    .description("Extract patterns from successful runs")
    .option("--stage <name>", "Filter by pipeline stage")
    .option("--since <duration>", "Time window (e.g., 7d, 30d)", "30d")
    .option("--min-success-rate <pct>", "Only show patterns above threshold (e.g., 85)")
    .option("--update-knowledge", "Add patterns to .reygent/knowledge/success-patterns.md")
    .action(analyzeSuccess);

  analyze
    .command("costs")
    .description("Cost breakdown and optimization recommendations")
    .option("--since <duration>", "Time window (e.g., 7d, 30d)", "30d")
    .option("--by-agent", "Group by agent instead of stage")
    .option("--show-runs", "List individual expensive runs")
    .action(analyzeCosts);

  analyze
    .command("agents")
    .description("Agent-specific performance breakdown")
    .option("--agent <name>", "Show specific agent only")
    .option("--since <duration>", "Time window (e.g., 7d, 30d)", "30d")
    .option("--compare-models", "Compare model performance within agent")
    .action(analyzeAgents);
}
