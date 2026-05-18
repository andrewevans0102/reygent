export { getRunsList } from "./runs-list.js";
export type { RunsListOptions, RunsListResult, RunSummaryRow } from "./runs-list.js";

export { getRunDetail } from "./run-detail.js";
export type { RunDetailResult } from "./run-detail.js";

export { getTrendData } from "./trends.js";
export type { TrendOptions, TrendResult, TrendBucket } from "./trends.js";

export { getAgentFailures } from "./agent-failures.js";
export type {
  AgentFailuresOptions,
  AgentFailuresResult,
  AgentFailureSummary,
} from "./agent-failures.js";

export { exportToCSV } from "./export-csv.js";
export type { ExportOptions as CSVExportOptions } from "./export-csv.js";

export { exportToXLSX } from "./export-xlsx.js";
export type { ExportOptions as XLSXExportOptions } from "./export-xlsx.js";
