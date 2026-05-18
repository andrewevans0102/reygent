import { writeFileSync } from "fs";
import * as XLSX from "xlsx";
import type { StorageBackend } from "../chesstrace/backends/types.js";
import { parseSince, formatTimestamp } from "./utils.js";

export interface ExportOptions {
  scope: "local" | "global";
  runId?: string;
  since?: string;
  output?: string;
}

/**
 * Export telemetry data to XLSX format with proper formatting
 */
export async function exportToXLSX(
  backend: StorageBackend,
  options: ExportOptions
): Promise<string> {
  let events;
  let runs;

  if (options.runId) {
    // Export specific run
    events = await backend.query({ runId: options.runId });
    if (events.length === 0) {
      throw new Error(`Run ${options.runId} not found`);
    }
    runs = [{ runId: options.runId }];
  } else {
    // Export all runs in time range
    const startTime = options.since ? parseSince(options.since) : undefined;
    runs = await backend.listRuns();
    const filtered = startTime
      ? runs.filter((r) => r.startTime >= startTime)
      : runs;

    // Collect all events from filtered runs
    const allEvents = await Promise.all(
      filtered.map((run) => backend.query({ runId: run.runId }))
    );
    events = allEvents.flat();
    runs = filtered;
  }

  // Sort by timestamp
  events.sort((a, b) => a.timestamp - b.timestamp);

  // Create workbook
  const workbook = XLSX.utils.book_new();

  // Create events sheet
  const eventsData = events.map((evt) => ({
    "Run ID": evt.runId.slice(0, 8),
    "Timestamp": evt.timestamp,
    "ISO Time": formatTimestamp(evt.timestamp),
    "Category": evt.category,
    "Event": evt.event,
    "Level": evt.minLevel,
    "Agent": evt.data.agent ?? "",
    "Provider": evt.data.provider ?? "",
    "Model": evt.data.model ?? "",
    "Stage": evt.data.stage ?? "",
    "Message": evt.data.message ?? "",
    "Error": evt.data.error ?? "",
    "Tool": evt.data.tool ?? "",
    "Cost": evt.data.cost ?? "",
    "Tokens": evt.data.tokens ?? "",
    "Duration": evt.data.duration ?? "",
    "Data": JSON.stringify(evt.data),
  }));

  const eventsSheet = XLSX.utils.json_to_sheet(eventsData);
  XLSX.utils.book_append_sheet(workbook, eventsSheet, "Events");

  // Create runs summary sheet
  const runsSummaryData = await Promise.all(
    runs.map(async (run) => {
      const runEvents = await backend.query({ runId: run.runId });

      // Calculate summary stats
      const startTime = runEvents[0]?.timestamp ?? run.startTime;
      const endTime =
        runEvents[runEvents.length - 1]?.timestamp ?? run.endTime ?? startTime;
      const duration = endTime - startTime;

      const commandEnd = runEvents.find((e) => e.event === "command.end");
      const pipelineEnd = runEvents.find((e) => e.event === "pipeline.end");
      const hasErrors = runEvents.some((e) => e.category === "error");
      let status = "incomplete";
      if (commandEnd || pipelineEnd) {
        status = hasErrors ? "failure" : "success";
      }

      const agentCount = runEvents.filter((e) => e.event === "agent.spawn").length;
      const errorCount = runEvents.filter((e) => e.category === "error").length;

      let totalCost = 0;
      for (const evt of runEvents) {
        if (evt.event === "usage.cost" && evt.data.cost) {
          totalCost += evt.data.cost as number;
        }
      }

      return {
        "Run ID": run.runId.slice(0, 8),
        "Full Run ID": run.runId,
        "Start Time": formatTimestamp(startTime),
        "End Time": formatTimestamp(endTime),
        "Duration (ms)": duration,
        "Status": status,
        "Event Count": runEvents.length,
        "Agent Count": agentCount,
        "Error Count": errorCount,
        "Total Cost": totalCost > 0 ? `$${totalCost.toFixed(4)}` : "",
      };
    })
  );

  const runsSheet = XLSX.utils.json_to_sheet(runsSummaryData);
  XLSX.utils.book_append_sheet(workbook, runsSheet, "Runs Summary");

  // Create categories sheet (breakdown by category)
  const categoryCounts = new Map<string, number>();
  for (const evt of events) {
    categoryCounts.set(evt.category, (categoryCounts.get(evt.category) ?? 0) + 1);
  }

  const categoriesData = Array.from(categoryCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => ({
      "Category": category,
      "Event Count": count,
      "Percentage": ((count / events.length) * 100).toFixed(1) + "%",
    }));

  const categoriesSheet = XLSX.utils.json_to_sheet(categoriesData);
  XLSX.utils.book_append_sheet(workbook, categoriesSheet, "Categories");

  // Create agents sheet (breakdown by agent)
  const agentCounts = new Map<string, number>();
  for (const evt of events) {
    if (evt.event === "agent.spawn" && evt.data.agent) {
      const agentName = evt.data.agent as string;
      agentCounts.set(agentName, (agentCounts.get(agentName) ?? 0) + 1);
    }
  }

  const agentsData = Array.from(agentCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([agent, count]) => ({
      "Agent": agent,
      "Spawn Count": count,
    }));

  if (agentsData.length > 0) {
    const agentsSheet = XLSX.utils.json_to_sheet(agentsData);
    XLSX.utils.book_append_sheet(workbook, agentsSheet, "Agents");
  }

  // Determine output path
  const filepath =
    options.output ?? generateFilename(options.scope, options.runId, "xlsx");

  // Write to file
  XLSX.writeFile(workbook, filepath);

  return filepath;
}

/**
 * Generate descriptive filename
 */
function generateFilename(
  scope: "local" | "global",
  runId: string | undefined,
  extension: string
): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").split("T")[0];

  if (runId) {
    return `reygent-telemetry-${scope}-${runId.slice(0, 8)}-${timestamp}.${extension}`;
  }

  return `reygent-telemetry-${scope}-${timestamp}.${extension}`;
}
