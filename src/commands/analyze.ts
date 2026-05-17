import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { loadConfig } from "../config.js";
import { analyzeFailurePatterns, analyzeSuccessPatterns } from "../knowledge/analyzer.js";
import { addFailureEntry, addPatternEntry } from "../knowledge/manager.js";
import {
  parseSince,
  formatRelativeTime,
  formatDuration,
  formatCost,
  formatPercent,
  groupBy,
  filterEvents,
  getBackend,
  checkTelemetryEnabled,
  computeFailureAnalysis,
  computeSuccessAnalysis,
  computeCostAnalysis,
  computeAgentAnalysis,
  RETRY_COST_ESTIMATE_MULTIPLIER,
  POTENTIAL_SAVINGS_MULTIPLIER,
} from "./analyze-data.js";
import { Events } from "../chesstrace/events.js";

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
 * reygent analyze failures - show common failure patterns
 */
export async function analyzeFailures(options: AnalyzeOptions): Promise<void> {
  const spinner = ora("Analyzing failure patterns...").start();

  try {
    const config = loadConfig();
    checkTelemetryEnabled(config);

    const result = await computeFailureAnalysis({
      since: options.since,
      limit: options.limit ? Number.parseInt(options.limit, 10) : undefined,
    });

    if (result.totalErrors === 0) {
      spinner.succeed(chalk.green("No failures found"));
      console.log(chalk.yellow("\nNo error events in telemetry data"));
      return;
    }

    spinner.succeed(chalk.green(`Analyzed ${result.totalErrors} error(s) from ${result.totalRuns} run(s)`));

    console.log();
    console.log(chalk.bold(`Failure Analysis (last ${result.days} days, ${result.totalRuns} runs)`));
    console.log();

    console.log(chalk.bold("Top Failure Patterns:"));
    console.log();

    for (let i = 0; i < result.patterns.length; i++) {
      const p = result.patterns[i];

      console.log(chalk.cyan(`${i + 1}. ${p.eventName}`) + chalk.gray(` (${p.count} occurrences)`));

      const agentSummary = p.agents.map(a => `${a.name} (${a.count})`).join(", ");
      console.log(`   Agents: ${agentSummary}`);

      if (p.commonMessage) {
        console.log(`   Common: "${p.commonMessage}"`);
      }

      console.log(`   Most recent: run ${p.mostRecent.runId.substring(0, 8)} (${formatRelativeTime(p.mostRecent.timestamp)})`);
      console.log();
    }

    // Recommendations
    console.log(chalk.bold("Recommendations:"));

    if (result.recommendations.length === 0) {
      console.log(chalk.gray("  No specific recommendations"));
    } else {
      for (const rec of result.recommendations) {
        console.log(`• ${rec}`);
      }
    }
    console.log();

    // Update knowledge if requested
    if (options.updateKnowledge) {
      const updateSpinner = ora("Updating knowledge base...").start();

      try {
        const analysisBackend = await getBackend();
        const since = options.since ? parseSince(options.since) : Date.now() - 30 * 24 * 60 * 60 * 1000;
        const patterns = analyzeFailurePatterns(analysisBackend, since);
        await analysisBackend.close();

        if (patterns.length === 0) {
          updateSpinner.info(chalk.yellow("No recurring patterns to add"));
        } else {
          let addedCount = 0;
          const limit = options.limit ? Number.parseInt(options.limit, 10) : 5;

          for (const pattern of patterns.slice(0, limit)) {
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
        const errMsg = err instanceof Error ? err.message : String(err);
        updateSpinner.fail(chalk.red(`Failed to update knowledge: ${errMsg}`));
        if (process.env.REYGENT_DEBUG === '1' || process.env.REYGENT_DEBUG === 'telemetry') {
          console.error('[debug:telemetry] analyzeFailures knowledge update error:', err);
        }
      }
    }

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    spinner.fail(chalk.red(`Failed to analyze failures: ${errMsg}`));
    if (process.env.REYGENT_DEBUG === '1' || process.env.REYGENT_DEBUG === 'telemetry') {
      console.error('[debug:telemetry] analyzeFailures error:', err);
    }
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

    const result = await computeSuccessAnalysis({
      since: options.since,
      stage: options.stage,
      minSuccessRate: options.minSuccessRate ? Number.parseFloat(options.minSuccessRate) / 100 : undefined,
    });

    if (result.successfulRuns === 0) {
      spinner.succeed(chalk.yellow("No successful runs found"));
      return;
    }

    spinner.succeed(chalk.green(`Analyzed ${result.successfulRuns} successful run(s)`));

    console.log();
    console.log(chalk.bold(`Success Analysis (last ${result.days} days, ${result.successfulRuns} successful runs)`));
    console.log();

    console.log(chalk.bold("Agent Performance:"));
    console.log();

    for (const a of result.agents) {
      console.log(chalk.cyan(`${a.agent}:`));
      console.log(`  Runs: ${a.completions}`);
      console.log(`  Success rate: ${formatPercent(a.successRate)} (${a.successes} success, ${a.failures} failures)`);
      console.log(`  Avg duration: ${formatDuration(a.avgDuration)}`);

      const modelDist = a.models
        .map(m => `${m.model} (${Math.round(m.count / a.completions * 100)}%)`)
        .join(", ");
      console.log(`  Model distribution: ${modelDist}`);
      console.log();
    }

    console.log(chalk.bold("Recommendations:"));
    if (result.recommendations.length === 0) {
      console.log(chalk.gray("  No specific recommendations"));
    } else {
      for (const rec of result.recommendations) {
        console.log(`• ${rec}`);
      }
    }
    console.log();

    // Update knowledge if requested
    if (options.updateKnowledge) {
      const updateSpinner = ora("Updating knowledge base...").start();

      try {
        const analysisBackend = await getBackend();
        const since = options.since ? parseSince(options.since) : Date.now() - 30 * 24 * 60 * 60 * 1000;
        const minRate = options.minSuccessRate ? Number.parseFloat(options.minSuccessRate) / 100 : 0.8;
        const patterns = analyzeSuccessPatterns(analysisBackend, since, minRate);
        await analysisBackend.close();

        if (patterns.length === 0) {
          updateSpinner.info(chalk.yellow("No high-success patterns to add"));
        } else {
          let addedCount = 0;
          const limit = 5;

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
        const errMsg = err instanceof Error ? err.message : String(err);
        updateSpinner.fail(chalk.red(`Failed to update knowledge: ${errMsg}`));
        if (process.env.REYGENT_DEBUG === '1' || process.env.REYGENT_DEBUG === 'telemetry') {
          console.error('[debug:telemetry] analyzeSuccess knowledge update error:', err);
        }
      }
    }

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    spinner.fail(chalk.red(`Failed to analyze success: ${errMsg}`));
    if (process.env.REYGENT_DEBUG === '1' || process.env.REYGENT_DEBUG === 'telemetry') {
      console.error('[debug:telemetry] analyzeSuccess error:', err);
    }
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

    const result = await computeCostAnalysis({ since: options.since });

    if (result.totalCost === 0) {
      spinner.succeed(chalk.yellow("No cost data found"));
      console.log(chalk.gray("\nEnable verbose telemetry to track costs:"));
      console.log(chalk.cyan("  reygent run --telemetry-level verbose\n"));
      return;
    }

    spinner.succeed(chalk.green(`Analyzed cost data`));

    console.log();
    console.log(chalk.bold(`Cost Analysis (last ${result.days} days, ${result.totalRuns} runs)`));
    console.log();

    console.log(chalk.bold("Total Spend:"), chalk.cyan(formatCost(result.totalCost)));
    console.log(`Successful runs: ${formatCost(result.successCost)} (${formatPercent(result.successCost / result.totalCost)})`);
    console.log(`Failed runs: ${formatCost(result.failedCost)} (${formatPercent(result.failedCost / result.totalCost)} - wasted)`);
    console.log();

    if (options.byAgent) {
      console.log(chalk.bold("Cost by Agent:"));
      for (const b of result.byAgent) {
        console.log(`  ${b.name}: ${formatCost(b.cost)} (${Math.round(b.percent * 100)}%) - ${b.runs} runs, avg ${formatCost(b.avgCost)}/run`);
      }
    } else {
      console.log(chalk.bold("Cost by Stage:"));
      for (const b of result.byStage) {
        console.log(`  ${b.name}: ${formatCost(b.cost)} (${Math.round(b.percent * 100)}%) - ${b.runs} runs, avg ${formatCost(b.avgCost)}/run`);
      }
    }
    console.log();

    // Expensive failures (when --show-runs)
    if (result.failedRuns > 0 && options.showRuns) {
      console.log(chalk.bold("Expensive Failures (top 3):"));

      // Re-query for expensive failure details (preserves original behavior)
      const backend = await getBackend();
      const since = options.since ? parseSince(options.since) : Date.now() - 30 * 24 * 60 * 60 * 1000;
      const allEvents = await backend.query({ startTime: since });
      await backend.close();

      const costEvents = filterEvents(allEvents, { event: Events.USAGE_COST });
      const pipelineEvents = filterEvents(allEvents, { event: Events.PIPELINE_END });

      const failedRunIds = new Set(
        pipelineEvents.filter(e => e.data.success !== true).map(e => e.runId)
      );

      const failureRunCosts = new Map<string, number>();
      for (const event of costEvents) {
        if (failedRunIds.has(event.runId)) {
          failureRunCosts.set(event.runId, (failureRunCosts.get(event.runId) || 0) + (event.data.costUsd as number));
        }
      }

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

    if (result.recommendations.length === 0) {
      console.log(chalk.gray("  No specific recommendations"));
    } else {
      for (const rec of result.recommendations) {
        console.log(`• ${rec}`);
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

    const result = await computeAgentAnalysis({
      since: options.since,
      agent: options.agent,
    });

    if (result.totalSpawns === 0) {
      spinner.succeed(chalk.yellow("No agent data found"));
      return;
    }

    spinner.succeed(chalk.green(`Analyzed ${result.totalSpawns} agent spawn(s)`));

    console.log();
    console.log(chalk.bold(`Agent Performance Analysis (last ${result.days} days)`));
    console.log();

    if (options.agent && result.agents.length === 0) {
      spinner.warn(chalk.yellow(`Agent "${options.agent}" not found in telemetry data`));
      return;
    }

    for (const a of result.agents) {
      console.log(chalk.bold.cyan(a.agent + ":"));
      console.log(`  Runs: ${a.completions}`);
      console.log(`  Success rate: ${formatPercent(a.successRate)} (${a.successes} success, ${a.failures} failures)`);
      console.log(`  Avg duration: ${formatDuration(a.avgDuration)}`);

      if (a.totalCost > 0) {
        console.log(`  Avg cost: ${formatCost(a.avgCost)}`);
      }

      const modelDist = a.models
        .map(m => `${m.model} (${Math.round(m.count / a.spawns * 100)}%)`)
        .join(", ");
      console.log(`  Model distribution: ${modelDist}`);

      // Compare models if requested
      if (options.compareModels && a.models.length > 1) {
        console.log(`\n  Model Comparison:`);

        // Re-query for model comparison details (preserves original per-model breakdown)
        const backend = await getBackend();
        const since = options.since ? parseSince(options.since) : Date.now() - 30 * 24 * 60 * 60 * 1000;
        const allEvents = await backend.query({ startTime: since });
        await backend.close();

        const agentSpawnEvents = filterEvents(allEvents, { event: Events.AGENT_SPAWN });
        const agentCompleteEvents = filterEvents(allEvents, { event: Events.AGENT_COMPLETE });
        const costEvents = filterEvents(allEvents, { event: Events.USAGE_COST });

        const modelPerformance = new Map<string, { successes: number; failures: number; totalDuration: number; totalCost: number; count: number }>();

        for (const complete of agentCompleteEvents) {
          if (complete.data.agent !== a.agent) continue;

          const spawn = agentSpawnEvents.find(s =>
            s.runId === complete.runId &&
            s.data.agent === a.agent &&
            s.timestamp <= complete.timestamp
          );
          if (!spawn) continue;
          const model = spawn.data.model as string;

          const perf = modelPerformance.get(model) || { successes: 0, failures: 0, totalDuration: 0, totalCost: 0, count: 0 };
          perf.count++;
          if (complete.data.success === true) perf.successes++; else perf.failures++;
          if (complete.data.duration) perf.totalDuration += complete.data.duration as number;

          const runCosts = costEvents.filter(c => c.runId === complete.runId && c.data.agent === a.agent);
          for (const costEvent of runCosts) {
            perf.totalCost += costEvent.data.costUsd as number;
          }

          modelPerformance.set(model, perf);
        }

        for (const [model, perf] of modelPerformance) {
          const sr = perf.count > 0 ? perf.successes / perf.count : 0;
          const avgDur = perf.count > 0 ? perf.totalDuration / perf.count : 0;
          const avgCost = perf.count > 0 ? perf.totalCost / perf.count : 0;
          console.log(`    ${model}: ${formatPercent(sr)} success, avg ${formatDuration(avgDur)}, avg ${formatCost(avgCost)}`);
        }
        console.log();
      }

      if (a.errorTypes.length > 0) {
        const topErrors = a.errorTypes
          .slice(0, 3)
          .map(et => `${et.type} (${et.count})`)
          .join(", ");
        console.log(`  Top failures: ${topErrors}`);
      }

      console.log();
    }

    // Recommendations
    console.log(chalk.bold("Recommendations:"));
    if (result.recommendations.length === 0) {
      console.log(chalk.gray("  No specific recommendations"));
    } else {
      for (const rec of result.recommendations) {
        console.log(`• ${rec}`);
      }
    }
    console.log();

  } catch (err) {
    spinner.fail(chalk.red(`Failed to analyze agents: ${(err as Error).message}`));
    process.exit(1);
  }
}

/**
 * reygent analyze dashboard - launch web dashboard
 */
async function analyzeDashboard(options: { since?: string; port?: string; open?: boolean }): Promise<void> {
  const spinner = ora("Starting dashboard server...").start();

  try {
    const config = loadConfig();
    checkTelemetryEnabled(config);

    const port = options.port ? Number.parseInt(options.port, 10) : 3141;
    const since = options.since ?? "30d";

    const { startDashboardServer } = await import("../dashboard/server.js");
    const info = await startDashboardServer({ port, since });

    spinner.succeed(chalk.green(`Dashboard running at ${chalk.cyan(info.url)}`));
    console.log(chalk.gray("  Press Ctrl+C to stop. Auto-stops after 5 minutes idle."));
    console.log();

    if (options.open !== false) {
      try {
        const open = (await import("open")).default;
        await open(info.url);
      } catch {
        // open failed silently — user can navigate manually
      }
    }

    // Keep process alive until server closes
    await new Promise<void>((resolve) => {
      info.server.on("close", resolve);
      process.on("SIGINT", () => {
        console.log(chalk.gray("\nShutting down dashboard..."));
        info.server.close();
        resolve();
      });
    });

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    spinner.fail(chalk.red(`Failed to start dashboard: ${errMsg}`));
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

  analyze
    .command("dashboard")
    .description("Launch web-based telemetry dashboard")
    .option("--since <duration>", "Default time window (e.g., 7d, 30d)", "30d")
    .option("--port <number>", "Server port", "3141")
    .option("--no-open", "Don't open browser automatically")
    .action(analyzeDashboard);
}
