import { writeFileSync } from "fs";
import path from "path";
import type { StorageBackend } from "../chesstrace/backends/types.js";
import { parseSince, formatTimestamp } from "./utils.js";

export interface ExportOptions {
  scope: "local" | "global";
  runId?: string;
  since?: string;
  output?: string;
}

/**
 * Export telemetry data to CSV format
 */
export async function exportToCSV(
  backend: StorageBackend,
  options: ExportOptions
): Promise<string> {
  let events;

  if (options.runId) {
    // Export specific run
    events = await backend.query({ runId: options.runId });
    if (events.length === 0) {
      throw new Error(`Run ${options.runId} not found`);
    }
  } else {
    // Export all runs in time range
    const startTime = options.since ? parseSince(options.since) : undefined;
    const runs = await backend.listRuns();
    const filtered = startTime
      ? runs.filter((r) => r.startTime >= startTime)
      : runs;

    // Collect all events from filtered runs
    const allEvents = await Promise.all(
      filtered.map((run) => backend.query({ runId: run.runId }))
    );
    events = allEvents.flat();
  }

  // Sort by timestamp
  events.sort((a, b) => a.timestamp - b.timestamp);

  // Generate CSV content
  const headers = [
    "Run ID",
    "Timestamp",
    "ISO Time",
    "Category",
    "Event",
    "Level",
    "Data",
  ];

  const rows = events.map((evt) => [
    evt.runId,
    evt.timestamp.toString(),
    formatTimestamp(evt.timestamp),
    evt.category,
    evt.event,
    evt.minLevel.toString(),
    JSON.stringify(evt.data),
  ]);

  const csvLines = [
    headers.join(","),
    ...rows.map((row) => row.map((cell) => escapeCSV(cell)).join(",")),
  ];

  const csvContent = csvLines.join("\n");

  // Determine output path
  const filepath =
    options.output ??
    generateFilename(options.scope, options.runId, "csv");

  // Write to file
  writeFileSync(filepath, csvContent, "utf-8");

  return filepath;
}

/**
 * Escape CSV field (handle commas, quotes, newlines)
 */
function escapeCSV(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
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
