/**
 * Parse duration string like "30d", "7d" into timestamp
 */
export function parseSince(since: string): number {
  const match = since.match(/^(\d+)d$/);
  if (!match) {
    throw new Error(`Invalid since format: ${since}. Use format like "30d", "7d".`);
  }
  const days = Number.parseInt(match[1], 10);
  return Date.now() - days * 86400000; // Convert days to milliseconds
}

/**
 * Format timestamp to human-readable date
 */
export function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
}

/**
 * Format duration in milliseconds to human-readable string
 */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

/**
 * Format relative time (e.g., "2 days ago", "5 hours ago")
 */
export function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days} day${days !== 1 ? "s" : ""} ago`;
  }
  if (hours > 0) {
    return `${hours} hour${hours !== 1 ? "s" : ""} ago`;
  }
  if (minutes > 0) {
    return `${minutes} min${minutes !== 1 ? "s" : ""} ago`;
  }
  return "just now";
}

/**
 * Get project root by searching upward for .reygent directory
 */
export async function getProjectRoot(): Promise<string> {
  const { findProjectRoot } = await import("../project-detection.js");
  const root = findProjectRoot(process.cwd());
  if (!root) {
    throw new Error(
      "No .reygent directory found. Run 'reygent init' or use --global flag for global telemetry."
    );
  }
  return root;
}
