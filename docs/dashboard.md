# Telemetry Dashboard

Visual interface for exploring Reygent telemetry data. The dashboard provides interactive views of run history, success/failure trends, agent performance, and data export capabilities.

## Quick Start

```bash
# View recent runs
reygent dashboard runs

# See success/failure trends over time
reygent dashboard trends

# Analyze agent failures
reygent dashboard agent-failures

# View details of a specific run
reygent dashboard run <runId>

# Export data to CSV or XLSX
reygent dashboard export --format xlsx
```

## Commands

### `dashboard runs`

List runs with summary information.

```bash
reygent dashboard runs [options]
```

**Options:**
- `--global` - Use global telemetry scope instead of local project scope
- `--limit <n>` - Maximum number of runs to display (default: 50)
- `--since <duration>` - Show runs since duration (e.g., `7d`, `30d`) (default: 30d)

**Example:**
```bash
# Show last 20 local runs
reygent dashboard runs --limit 20

# Show global runs from last 7 days
reygent dashboard runs --global --since 7d
```

**Output:**
- Table with: Run ID, timestamp, status (✓/✗), duration, agents used, cost
- Color-coded status indicators (green for success, red for failure)

---

### `dashboard run <runId>`

Show detailed information for a specific run.

```bash
reygent dashboard run <runId> [options]
```

**Arguments:**
- `<runId>` - The run ID to display (get from `dashboard runs` output)

**Options:**
- `--global` - Use global telemetry scope instead of local

**Example:**
```bash
# View specific run details
reygent dashboard run abc123def456

# View from global scope
reygent dashboard run abc123def456 --global
```

**Output:**
- Run summary: ID, timestamp, status, duration, total cost
- Agent execution timeline
- Full event log with timestamps and details
- Error messages (if any)
- Usage breakdown by agent

---

### `dashboard trends`

Show success vs failure trends over time with visual chart.

```bash
reygent dashboard trends [options]
```

**Options:**
- `--global` - Use global telemetry scope instead of local
- `--since <duration>` - Show trends since duration (default: 30d)
  - Examples: `7d` (7 days), `30d` (30 days), `90d` (90 days)
- `--granularity <unit>` - Time bucket size: `day` or `week` (default: day)

**Example:**
```bash
# Daily trends for last 30 days
reygent dashboard trends

# Weekly trends for last 90 days
reygent dashboard trends --since 90d --granularity week

# Global trends
reygent dashboard trends --global --since 7d
```

**Output:**
- ASCII chart showing success (green) vs failure (red) counts over time
- Summary statistics: total runs, success rate, failure rate
- Trend direction indicators

---

### `dashboard agent-failures`

Drill down into agent-level failures to identify problematic agents and error patterns.

```bash
reygent dashboard agent-failures [options]
```

**Options:**
- `--global` - Use global telemetry scope instead of local
- `--since <duration>` - Show failures since duration (default: 30d)
- `--limit <n>` - Maximum agents to display (default: 10)

**Example:**
```bash
# Top 5 failing agents from last 7 days
reygent dashboard agent-failures --since 7d --limit 5

# All failing agents from last 30 days (global scope)
reygent dashboard agent-failures --global
```

**Output:**
- Table with: Agent name, failure count, failure rate, recent errors
- Error type breakdown: Top error categories with occurrence counts
- Most common failure reasons

---

### `dashboard export`

Export telemetry data to CSV or XLSX for external analysis or archival.

```bash
reygent dashboard export [options]
```

**Options:**
- `--global` - Use global telemetry scope instead of local
- `--format <type>` - Export format: `csv` or `xlsx` (default: csv)
- `--run <runId>` - Export specific run only (otherwise exports all runs)
- `--since <duration>` - Export runs since duration (default: 30d)
- `--output <file>` - Output file path (auto-generated if not provided)

**Example:**
```bash
# Export all runs from last 30 days to CSV
reygent dashboard export

# Export to Excel with custom filename
reygent dashboard export --format xlsx --output my-telemetry.xlsx

# Export specific run
reygent dashboard export --run abc123def456 --format xlsx

# Export last 7 days from global scope
reygent dashboard export --global --since 7d
```

**Auto-generated filenames:**
- Format: `reygent-{scope}-{date}-{time}.{ext}`
- Examples:
  - `reygent-local-2026-05-17-143052.csv`
  - `reygent-global-2026-05-17-143052.xlsx`

**CSV Export:**
- Headers: run_id, timestamp, status, duration_ms, agents, cost_usd, error_message
- One row per run
- Comma-delimited, quoted fields

**XLSX Export:**
- Formatted spreadsheet with:
  - Bold headers
  - Auto-sized columns
  - Status indicators (✓/✗)
  - Timestamp formatting
  - Cost formatting with $ symbol
- Multiple sheets for different views (if applicable)

---

## Local vs Global Scope

The dashboard supports two telemetry scopes:

### Local Scope (default)
- **Location:** `.reygent/chesstrace.db` in current project
- **Contains:** Runs for the current project only
- **Use when:** Analyzing project-specific performance

```bash
# Local scope (default)
reygent dashboard runs
```

### Global Scope
- **Location:** `~/.reygent/chesstrace.db` in home directory
- **Contains:** Runs from ALL projects
- **Use when:** Comparing across projects or seeing aggregate trends

```bash
# Global scope (requires --global flag)
reygent dashboard runs --global
```

**Privacy note:** If you work on both private and public repos, consider disabling global telemetry to prevent cross-project data leakage. See [Telemetry Privacy](./telemetry.md#privacy--control) for details.

---

## Duration Format

All dashboard commands accept duration filters using the format `Nd` where N is the number of days:

| Duration | Meaning |
|----------|---------|
| `7d` | Last 7 days |
| `30d` | Last 30 days (default) |
| `90d` | Last 90 days |
| `180d` | Last 180 days |

**Example:**
```bash
reygent dashboard trends --since 90d
```

---

## Common Workflows

### Debugging Recent Failures

```bash
# 1. Check recent runs
reygent dashboard runs --limit 10

# 2. Identify failing runs (marked with ✗)

# 3. Get details on specific failure
reygent dashboard run <failing-run-id>

# 4. See if it's a pattern
reygent dashboard agent-failures --since 7d
```

### Performance Analysis

```bash
# 1. View success/failure trends
reygent dashboard trends --since 30d

# 2. If success rate dropping, check agent failures
reygent dashboard agent-failures

# 3. Export data for deeper analysis
reygent dashboard export --format xlsx --since 30d
```

### Cost Optimization

```bash
# 1. Export runs to Excel
reygent dashboard export --format xlsx

# 2. Open in Excel/Google Sheets

# 3. Sort by cost_usd column (descending)

# 4. Identify expensive runs

# 5. View details of expensive runs
reygent dashboard run <expensive-run-id>
```

### Cross-Project Comparison

```bash
# 1. View global trends
reygent dashboard trends --global --since 90d

# 2. Compare with local project trends
reygent dashboard trends --since 90d

# 3. Export both for comparison
reygent dashboard export --global --output global.xlsx
reygent dashboard export --output local.xlsx
```

---

## Integration with Analyze Commands

The dashboard complements the existing `reygent analyze` commands:

| Dashboard Command | Analyze Equivalent | Difference |
|-------------------|-------------------|------------|
| `dashboard runs` | `reygent last` | Dashboard shows multiple runs vs single latest |
| `dashboard trends` | `reygent analyze success` | Visual chart vs text analysis |
| `dashboard agent-failures` | `reygent analyze failures` | Agent-focused vs pattern-focused |
| `dashboard export` | `reygent telemetry export` | Formatted exports (CSV/XLSX) vs raw JSON |

**Use dashboard when:** You want visual exploration and quick summaries
**Use analyze when:** You want AI-powered insights and recommendations

See [Telemetry Commands](./telemetry.md) for full analyze documentation.

---

## Troubleshooting

### "No runs found"

**Cause:** No telemetry data in the selected scope.

**Solutions:**
```bash
# Check if DB exists
ls -la .reygent/chesstrace.db  # Local
ls -la ~/.reygent/chesstrace.db  # Global

# Verify telemetry is enabled
echo $REYGENT_TELEMETRY  # Should be empty or "true"

# Run a task to generate data
reygent run "test task"

# Check again
reygent dashboard runs
```

### "Run <id> not found"

**Cause:** Wrong scope or run ID doesn't exist.

**Solutions:**
```bash
# List runs to get valid IDs
reygent dashboard runs

# If it was a global run, use --global
reygent dashboard run <id> --global

# Copy exact ID from dashboard runs output
```

### Export fails with permission error

**Cause:** No write permission in output directory.

**Solutions:**
```bash
# Specify writable location
reygent dashboard export --output ~/Downloads/telemetry.csv

# Or change to writable directory
cd ~/Downloads
reygent dashboard export
```

### Dashboard shows different data than analyze

**Cause:** Dashboard and analyze may use different default scopes or time windows.

**Solutions:**
```bash
# Ensure same scope
reygent dashboard runs          # Local
reygent analyze failures        # Also local

# Ensure same time window
reygent dashboard runs --since 30d
reygent analyze failures --since 30d
```

### Empty charts in trends

**Cause:** Not enough data points in selected time window.

**Solutions:**
```bash
# Extend time window
reygent dashboard trends --since 90d

# Use weekly granularity for sparse data
reygent dashboard trends --since 90d --granularity week

# Check if runs exist at all
reygent dashboard runs
```

---

## Security & Privacy

The dashboard reads from local telemetry databases and doesn't send data externally.

**Data sanitization:**
- Error messages are sanitized before storage (see [Telemetry Privacy](./telemetry.md#privacy--control))
- Exports include sanitized data only
- No API keys, tokens, or sensitive paths in output

**Cross-project isolation:**
- Local scope: Project-specific data only
- Global scope: Aggregated across all projects
- No cross-project data mixing in local scope

**Export security:**
- CSV/XLSX files contain sanitized telemetry data
- Review exports before sharing externally
- Consider local-only exports for private projects

---

## Advanced Configuration

Dashboard uses the same telemetry configuration as analyze commands.

**.reygent/config.json:**
```json
{
  "telemetry": {
    "enabled": true,           // Enable telemetry collection
    "global_enabled": true,    // Write to global DB
    "retention_days": 180      // How long to keep data
  }
}
```

**Environment variables:**
```bash
# Disable all telemetry (dashboard will have no data)
export REYGENT_TELEMETRY=false

# Disable global telemetry only
export REYGENT_GLOBAL_TELEMETRY=false
```

See [Telemetry Configuration](./telemetry.md#advanced-configuration) for full options.

---

## Related Documentation

- [Telemetry Overview](./telemetry.md) - Analyze commands, privacy, configuration
- [Chesstrace Architecture](./chesstrace.md) - Telemetry system internals
- [Usage Tracking](./usage-tracking.md) - Token and cost tracking
