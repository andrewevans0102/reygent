import Table from "cli-table3";
import chalk from "chalk";
import type { TelemetryBackend } from "../chesstrace/backends/types.js";
import { parseSince } from "./utils.js";

export interface TrendOptions {
  since?: string;
  granularity?: "day" | "week";
}

export interface TrendResult {
  buckets: TrendBucket[];
  chart: string;
  summary: string;
}

export interface TrendBucket {
  timestamp: number;
  label: string;
  successCount: number;
  failureCount: number;
  incompleteCount: number;
  totalCount: number;
  successRate: number;
}

/**
 * Get success vs failure trend data over time
 */
export async function getTrendData(
  backend: TelemetryBackend,
  options: TrendOptions = {}
): Promise<TrendResult> {
  const startTime = options.since ? parseSince(options.since) : undefined;
  const granularity = options.granularity ?? "day";

  // Get all runs
  const runs = await backend.listRuns();

  // Filter by time range
  const filtered = startTime
    ? runs.filter((r) => r.startTime >= startTime)
    : runs;

  // Sort by start time
  const sorted = filtered.sort((a, b) => a.startTime - b.startTime);

  if (sorted.length === 0) {
    return {
      buckets: [],
      chart: "",
      summary: "",
    };
  }

  // Determine run status for each
  const runStatuses = await Promise.all(
    sorted.map(async (run) => {
      const events = await backend.queryEvents({ runId: run.runId });
      const commandEnd = events.find((e) => e.event === "command.end");
      const pipelineEnd = events.find((e) => e.event === "pipeline.end");
      const hasErrors = events.some((e) => e.category === "error");

      let status: "success" | "failure" | "incomplete" = "incomplete";
      if (commandEnd || pipelineEnd) {
        status = hasErrors ? "failure" : "success";
      }

      return {
        runId: run.runId,
        timestamp: run.startTime,
        status,
      };
    })
  );

  // Group by time buckets
  const bucketSize = granularity === "day" ? 86400000 : 604800000; // ms in day/week
  const buckets = new Map<number, TrendBucket>();

  for (const run of runStatuses) {
    const bucketTimestamp = Math.floor(run.timestamp / bucketSize) * bucketSize;

    if (!buckets.has(bucketTimestamp)) {
      buckets.set(bucketTimestamp, {
        timestamp: bucketTimestamp,
        label: formatBucketLabel(bucketTimestamp, granularity),
        successCount: 0,
        failureCount: 0,
        incompleteCount: 0,
        totalCount: 0,
        successRate: 0,
      });
    }

    const bucket = buckets.get(bucketTimestamp)!;
    bucket.totalCount++;

    if (run.status === "success") {
      bucket.successCount++;
    } else if (run.status === "failure") {
      bucket.failureCount++;
    } else {
      bucket.incompleteCount++;
    }

    bucket.successRate = bucket.successCount / bucket.totalCount;
  }

  // Convert to sorted array
  const bucketArray = Array.from(buckets.values()).sort(
    (a, b) => a.timestamp - b.timestamp
  );

  // Create chart
  const chart = createTrendChart(bucketArray);

  // Create summary
  const totalSuccess = bucketArray.reduce((sum, b) => sum + b.successCount, 0);
  const totalFailure = bucketArray.reduce((sum, b) => sum + b.failureCount, 0);
  const totalIncomplete = bucketArray.reduce((sum, b) => sum + b.incompleteCount, 0);
  const total = totalSuccess + totalFailure + totalIncomplete;
  const overallSuccessRate = total > 0 ? totalSuccess / total : 0;

  const summaryLines = [
    `${chalk.bold("Total Runs:")} ${total}`,
    `${chalk.bold("Success:")} ${chalk.green(totalSuccess.toString())} (${(overallSuccessRate * 100).toFixed(1)}%)`,
    `${chalk.bold("Failure:")} ${chalk.red(totalFailure.toString())} (${((totalFailure / total) * 100).toFixed(1)}%)`,
  ];

  if (totalIncomplete > 0) {
    summaryLines.push(
      `${chalk.bold("Incomplete:")} ${chalk.yellow(totalIncomplete.toString())} (${((totalIncomplete / total) * 100).toFixed(1)}%)`
    );
  }

  return {
    buckets: bucketArray,
    chart,
    summary: summaryLines.join("\n"),
  };
}

/**
 * Format bucket label based on timestamp and granularity
 */
function formatBucketLabel(timestamp: number, granularity: "day" | "week"): string {
  const date = new Date(timestamp);
  if (granularity === "day") {
    return date.toISOString().split("T")[0]; // YYYY-MM-DD
  } else {
    // Week: show start of week
    const weekStart = new Date(date);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    return weekStart.toISOString().split("T")[0];
  }
}

/**
 * Create ASCII chart of trend data
 */
function createTrendChart(buckets: TrendBucket[]): string {
  const table = new Table({
    head: [
      chalk.bold("Period"),
      chalk.bold("Success"),
      chalk.bold("Failure"),
      chalk.bold("Total"),
      chalk.bold("Rate"),
      chalk.bold("Trend"),
    ],
    style: { head: [], border: [] },
  });

  for (const bucket of buckets) {
    const successBar = createBar(bucket.successCount, bucket.totalCount, chalk.green);
    const failureBar = createBar(bucket.failureCount, bucket.totalCount, chalk.red);
    const trendBar = successBar + failureBar;

    table.push([
      bucket.label,
      chalk.green(bucket.successCount.toString()),
      chalk.red(bucket.failureCount.toString()),
      bucket.totalCount.toString(),
      formatRate(bucket.successRate),
      trendBar,
    ]);
  }

  return table.toString();
}

/**
 * Create colored bar segment
 */
function createBar(
  count: number,
  total: number,
  color: (text: string) => string
): string {
  const maxWidth = 20;
  const width = Math.round((count / total) * maxWidth);
  return color("█".repeat(width));
}

/**
 * Format success rate as percentage
 */
function formatRate(rate: number): string {
  const pct = (rate * 100).toFixed(1);
  const num = parseFloat(pct);

  if (num >= 90) return chalk.green(`${pct}%`);
  if (num >= 70) return chalk.yellow(`${pct}%`);
  return chalk.red(`${pct}%`);
}
