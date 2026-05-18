# Telemetry

Analyze Reygent runs to optimize performance and reduce costs. All analysis runs on local telemetry database. No data leaves your machine.

> **New:** Looking for visual exploration? Try the [Dashboard](/dashboard) for interactive views of run history, trends, and agent failures.

## Commands

- `reygent last` - Show latest run details (quick summary, verbose log, output, errors, or JSON)
- `reygent analyze failures` - Common error patterns
- `reygent analyze success` - What works well
- `reygent analyze costs` - Cost breakdown and savings
- `reygent analyze agents` - Agent performance comparison

## Command Details

**Duration Format:** All commands use `--since` with format `Nd` where N is number of days. Examples: `7d` (7 days), `30d` (30 days), `90d` (90 days).

**Latest Run Details:**
```bash
reygent last [--verbose] [--output] [--errors] [--json]
```
Quick access to most recent run:
- Default: Summary with status, duration, agents, cost, and top errors
- `--verbose`: Full event log with timestamps and details
- `--output`: Only final output from the run
- `--errors`: Only errors with stack traces
- `--json`: Machine-readable JSON for scripting

**Failures Analysis:**
```bash
reygent analyze failures [--agent <name>] [--since 30d] [--limit N]
```
Shows top failure patterns with occurrence counts, agent breakdown, and actionable recommendations.

**Success Analysis:**
```bash
reygent analyze success [--stage <name>] [--since 30d] [--min-success-rate <pct>]
```
Extracts patterns from successful runs: agent performance, model distribution, optimal configurations.

**Cost Analysis:**
```bash
reygent analyze costs [--since 30d] [--by-agent] [--show-runs]
```
Cost breakdown by stage/agent with optimization opportunities and potential savings.

**Agent Analysis:**
```bash
reygent analyze agents [--agent <name>] [--since 30d] [--compare-models]
```
Per-agent performance: success rates, duration, costs, error types, model distribution.

## Privacy & Control

**What data is collected:**
- Run timestamps and duration
- Agent names and execution stages
- Error messages (sanitized - see below)
- API costs (tokens, provider, model)
- Success/failure status
- File paths modified (relative to project root)
- Knowledge consultation events

**What is NOT collected:**
- File contents or code
- Environment variables or secrets
- Command arguments with sensitive data
- Network requests or API keys

**Security measures:**

*Error sanitization:*
All error messages automatically sanitized before storage to remove:
- API keys and tokens (20+ character strings)
- User home paths (`/Users/name`, `/home/name`, `C:\Users\name`)
- Email addresses
- IP addresses
- Environment variable values (`password=secret` → `password=[REDACTED]`)

*Cross-project isolation:*
By default, telemetry writes to BOTH:
- Local: `.reygent/chesstrace.db` (project-specific)
- Global: `~/.reygent/chesstrace.db` (aggregate across all projects)

**Warning:** Global DB contains data from all projects. If you work on private and public repos, consider disabling global telemetry to prevent cross-project data leakage.

*DB size limits:*
- Max DB size: 50MB (auto-prunes old events if exceeded)
- Max events per run: 10,000 (prevents spam attacks)
- Auto-retention: 180 days (older events pruned automatically)

**Disable telemetry:**
```bash
# Set environment variable to skip all telemetry
export REYGENT_TELEMETRY=false

# Or in .reygent/config.json
{
  "telemetry": {
    "enabled": false
  }
}
```

**Export data:**
```bash
# Export telemetry as JSON
reygent telemetry export --since 30d --output data.json

# Export knowledge as markdown bundle
reygent knowledge export --output knowledge-backup.tar.gz
```

## Advanced Configuration

**.reygent/config.json telemetry options:**
```json
{
  "telemetry": {
    "enabled": true,
    "global_enabled": true,        // Write to global DB (set false for security)
    "retention_days": 180,         // Event retention (default 180)
    "error_retention_days": 90,    // Error log retention (default 90)
    "auto_prune": true,            // Auto-prune on analyze commands
    "debug": false,                // Enable verbose logging
    "max_db_size_mb": 50,          // Max DB size before pruning (default 50)
    "max_events_per_run": 10000    // Max events per run (prevents spam)
  }
}
```

**Environment variables:**
```bash
# Disable all telemetry
export REYGENT_TELEMETRY=false

# Disable global telemetry only (security - prevent cross-project data)
export REYGENT_GLOBAL_TELEMETRY=false

# Debug mode
export REYGENT_DEBUG=telemetry       # Telemetry events

# Custom DB location
export REYGENT_TELEMETRY_DB=/custom/path/chesstrace.db
```

## Telemetry Internals

Reygent's telemetry system is called **Chesstrace**. For full architecture details, see the [Chesstrace Guide](./chesstrace.md).

**Database schema (`chesstrace.db`):**

Single SQLite table with WAL mode enabled:

```sql
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  category TEXT NOT NULL,
  event TEXT NOT NULL,
  min_level INTEGER NOT NULL,
  data TEXT NOT NULL          -- JSON serialized
)
```

Indexes: `run_id`, `timestamp`, `category`, `event`.

**Event categories:** `command`, `agent`, `llm`, `git`, `spec`, `error`, `performance`, `pipeline`, `usage`, `gate`, `tool`, `knowledge`

**Key events by level:**

*Minimal (always captured):*
- `command.start`, `command.end`, `command.error`
- `error.unhandled`, `error.validation`, `error.task`, `error.parse`, `error.provider`
- `tool.summary`, `knowledge.prevented_failure`

*Standard (default level):*
- `agent.spawn`, `agent.complete`, `agent.timeout`
- `pipeline.start`, `pipeline.end`, `pipeline.stage_start`, `pipeline.stage_end`
- `gate.result`, `gate.retry`
- `git.branch_create`, `git.commit`, `git.push`
- `spec.fetch`, `spec.parse`
- `tool.invoke`, `knowledge.consulted`, `knowledge.success`

*Verbose (diagnostic):*
- `llm.request`, `llm.response`, `llm.token_usage`
- `performance.metric`, `performance.duration`
- `usage.tokens`, `usage.cost`
- `tool.invoke.full`

**Retention:**
- Default: 30 days (configurable via `telemetry.retention` in config)
- Auto-pruned on init
- DB hard prune at 180 days when size limit approached

**Performance:**
- DB typically <10MB per project after 6 months
- Indexes on `run_id`, `timestamp`, `category`, `event`
- WAL mode for concurrent reads/writes

**Backup:**
```bash
# Backup telemetry DB
cp .reygent/chesstrace.db .reygent/chesstrace.db.backup

# Restore from backup
mv .reygent/chesstrace.db.backup .reygent/chesstrace.db
```

## Troubleshooting

**DB corruption:**
```bash
# Check DB integrity
sqlite3 .reygent/chesstrace.db "PRAGMA integrity_check;"

# If corrupted, restore from backup
mv .reygent/chesstrace.db .reygent/chesstrace.db.corrupted
cp .reygent/chesstrace.db.backup .reygent/chesstrace.db

# If no backup, rebuild from scratch
rm .reygent/chesstrace.db
# Next run will create fresh DB
```

**Telemetry not recording:**
```bash
# Check telemetry enabled
echo $REYGENT_TELEMETRY  # Should be empty or "true"

# Check DB permissions
ls -la .reygent/chesstrace.db  # Should be writable

# Enable debug logging
REYGENT_DEBUG=telemetry reygent run ...
```

**Analyze commands fail:**
```bash
# Check DB exists
ls -la .reygent/chesstrace.db

# Check DB has data
sqlite3 .reygent/chesstrace.db "SELECT COUNT(*) FROM events;"

# If empty, need at least one run first
reygent run "test task"
```

**Schema issues:**
```bash
# If schema problems, safest path is backup + recreate
cp .reygent/chesstrace.db .reygent/chesstrace.db.backup
rm .reygent/chesstrace.db
# Next run creates fresh DB with current schema
```
