import Table from "cli-table3";
import chalk from "chalk";
import type { TelemetryBackend } from "../chesstrace/backends/types.js";
import { formatTimestamp, formatDuration } from "./utils.js";

export interface RunDetailResult {
  runId: string;
  summary: string;
  events: string;
  eventCount: number;
}

/**
 * Get detailed information for a specific run (--verbose parity)
 */
export async function getRunDetail(
  backend: TelemetryBackend,
  runId: string
): Promise<RunDetailResult | null> {
  const events = await backend.queryEvents({ runId });

  if (events.length === 0) {
    return null;
  }

  // Sort by timestamp
  events.sort((a, b) => a.timestamp - b.timestamp);

  const startTime = events[0].timestamp;
  const endTime = events[events.length - 1].timestamp;
  const duration = endTime - startTime;

  // Determine status
  const commandEnd = events.find((e) => e.event === "command.end");
  const pipelineEnd = events.find((e) => e.event === "pipeline.end");
  const hasErrors = events.some((e) => e.category === "error");
  let status: "success" | "failure" | "incomplete" = "incomplete";
  if (commandEnd || pipelineEnd) {
    status = hasErrors ? "failure" : "success";
  }

  // Count agents
  const agentSpawns = events.filter((e) => e.event === "agent.spawn");
  const agentCount = agentSpawns.length;

  // Count errors
  const errorCount = events.filter((e) => e.category === "error").length;

  // Extract cost if available
  let totalCost = 0;
  for (const evt of events) {
    if (evt.event === "usage.cost" && evt.data.cost) {
      totalCost += evt.data.cost as number;
    }
  }

  // Build summary
  const statusColor =
    status === "success" ? chalk.green : status === "failure" ? chalk.red : chalk.yellow;

  const summaryLines = [
    `${chalk.bold("Run ID:")} ${chalk.cyan(runId)}`,
    `${chalk.bold("Status:")} ${statusColor(status)}`,
    `${chalk.bold("Started:")} ${formatTimestamp(startTime)}`,
    `${chalk.bold("Duration:")} ${formatDuration(duration)}`,
    `${chalk.bold("Events:")} ${events.length}`,
    `${chalk.bold("Agents:")} ${agentCount}`,
  ];

  if (errorCount > 0) {
    summaryLines.push(`${chalk.bold("Errors:")} ${chalk.red(errorCount.toString())}`);
  }

  if (totalCost > 0) {
    summaryLines.push(`${chalk.bold("Cost:")} ${chalk.cyan(`$${totalCost.toFixed(4)}`)}`);
  }

  const summary = summaryLines.join("\n");

  // Build events table
  const table = new Table({
    head: [
      chalk.bold("Time"),
      chalk.bold("Category"),
      chalk.bold("Event"),
      chalk.bold("Data"),
    ],
    colWidths: [20, 15, 25, 60],
    wordWrap: true,
    style: { head: [], border: [] },
  });

  for (const evt of events) {
    const categoryColor = getCategoryColor(evt.category);
    const dataStr = formatEventData(evt.data);

    table.push([
      formatTimestamp(evt.timestamp),
      categoryColor(evt.category),
      evt.event,
      dataStr,
    ]);
  }

  return {
    runId,
    summary,
    events: table.toString(),
    eventCount: events.length,
  };
}

/**
 * Get color for category
 */
function getCategoryColor(category: string): (text: string) => string {
  switch (category) {
    case "error":
      return chalk.red;
    case "command":
    case "pipeline":
      return chalk.blue;
    case "agent":
      return chalk.cyan;
    case "gate":
      return chalk.magenta;
    case "knowledge":
      return chalk.green;
    case "git":
      return chalk.yellow;
    default:
      return chalk.white;
  }
}

/**
 * Format event data for display
 */
function formatEventData(data: Record<string, unknown>): string {
  const keys = Object.keys(data);
  if (keys.length === 0) {
    return chalk.gray("—");
  }

  // Show most relevant fields
  const relevant: string[] = [];

  if (data.agent) relevant.push(`agent=${data.agent}`);
  if (data.provider) relevant.push(`provider=${data.provider}`);
  if (data.model) relevant.push(`model=${data.model}`);
  if (data.stage) relevant.push(`stage=${data.stage}`);
  if (data.message) relevant.push(`msg=${data.message}`);
  if (data.error) relevant.push(`error=${data.error}`);
  if (data.tool) relevant.push(`tool=${data.tool}`);
  if (data.cost) relevant.push(`cost=$${(data.cost as number).toFixed(4)}`);
  if (data.tokens) relevant.push(`tokens=${data.tokens}`);
  if (data.duration) relevant.push(`duration=${data.duration}ms`);

  // If no relevant fields, show all keys
  if (relevant.length === 0) {
    return chalk.gray(keys.join(", "));
  }

  return relevant.join(", ");
}
