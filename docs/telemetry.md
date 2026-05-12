# Telemetry

Analyze Reygent runs to optimize performance and reduce costs. All analysis runs on local telemetry database. No data leaves your machine.

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
- Error messages and stack traces
- API costs (tokens, provider, model)
- Success/failure status
- File paths modified (relative to project root)
- Knowledge consultation events

**What is NOT collected:**
- File contents or code
- Environment variables or secrets
- Command arguments with sensitive data
- Network requests or API keys

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
    "dual_write": true,           // Write to both local + global DBs
    "retention_days": 180,         // Event retention (default 180)
    "error_retention_days": 90,    // Error log retention (default 90)
    "auto_prune": true,            // Auto-prune on analyze commands
    "debug": false                 // Enable verbose logging
  }
}
```

**Environment variables:**
```bash
# Disable all telemetry
export REYGENT_TELEMETRY=false

# Debug mode
export REYGENT_DEBUG=telemetry       # Telemetry events

# Custom DB location
export REYGENT_TELEMETRY_DB=/custom/path/telemetry.db
```

## Telemetry Internals

**Database schema (`telemetry.db`):**

SQLite database with tables:
- `runs` - Top-level run metadata (id, timestamp, status, duration)
- `events` - Event log entries (run_id, type, timestamp, payload JSON)
- `costs` - Cost tracking (run_id, stage, tokens, provider, model, cost)
- `errors` - Error details (run_id, stage, message, stack, timestamp)

**Event types:**
- `run.start` - Run initiated
- `run.complete` - Run finished successfully
- `run.error` - Run failed
- `agent.spawn` - Agent started
- `agent.complete` - Agent finished
- `agent.error` - Agent failed
- `knowledge.consulted` - Knowledge loaded before agent spawn
- `knowledge.prevented_failure` - Knowledge helped avoid documented failure
- `knowledge.success` - Knowledge-based run succeeded
- `cost.tracked` - API usage recorded

**Retention policies:**
- Telemetry events: 180 days (auto-pruned on `reygent analyze` commands)
- Error logs: 90 days
- Cost data: 365 days (never pruned)
- Runs with zero events: 30 days

**Performance:**
- DB typically <10MB per project after 6 months
- Indexes on `run_id`, `timestamp`, `event_type`
- Vacuum runs automatically after pruning

**Backup:**
```bash
# Backup telemetry DB
cp .reygent/telemetry.db .reygent/telemetry.db.backup

# Restore from backup
mv .reygent/telemetry.db.backup .reygent/telemetry.db
```

## Troubleshooting

**DB corruption:**
```bash
# Check DB integrity
sqlite3 .reygent/telemetry.db "PRAGMA integrity_check;"

# If corrupted, restore from backup
mv .reygent/telemetry.db .reygent/telemetry.db.corrupted
cp .reygent/telemetry.db.backup .reygent/telemetry.db

# If no backup, rebuild from scratch
rm .reygent/telemetry.db
# Next run will create fresh DB
```

**Telemetry not recording:**
```bash
# Check telemetry enabled
echo $REYGENT_TELEMETRY  # Should be empty or "true"

# Check DB permissions
ls -la .reygent/telemetry.db  # Should be writable

# Enable debug logging
REYGENT_DEBUG=telemetry reygent run ...
```

**Analyze commands fail:**
```bash
# Check DB exists
ls -la .reygent/telemetry.db

# Check DB has data
sqlite3 .reygent/telemetry.db "SELECT COUNT(*) FROM runs;"

# If empty, need at least one run first
reygent run "test task"
```

**Schema version mismatch:**
```bash
# Check current schema version
sqlite3 .reygent/telemetry.db "SELECT value FROM metadata WHERE key='schema_version';"

# Run migration
reygent migrate --from v1 --to v2

# If migration fails, export data first
reygent telemetry export --output backup.json
rm .reygent/telemetry.db
# Next run creates new schema
reygent telemetry import --input backup.json
```
