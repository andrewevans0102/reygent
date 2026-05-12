# Living Documentation

Reygent learns from your project over time through `.reygent/knowledge/`:

- **common-failures.md** - Documented errors and solutions
- **success-patterns.md** - Proven approaches that work
- **project-conventions.md** - User-written project rules
- **agents/*.md** - Agent-specific tips (dev.md, qe.md, planner.md, pr-reviewer.md)

Agents consult this knowledge before running, avoiding past mistakes and following proven patterns.

## Initialization

Knowledge directory auto-created during `reygent init`:

```bash
# Create .reygent/ structure with knowledge templates
reygent init
```

This creates:
- `.reygent/knowledge/` directory
- `common-failures.md` template
- `success-patterns.md` template
- `project-conventions.md` template
- `agents/*.md` templates (dev, qe, planner, pr-reviewer)
- `.reygent/.gitignore` - Ignores auto-generated files

Files include helpful starter content explaining each section. You can immediately populate `project-conventions.md` with your project rules.

If knowledge directory missing, you'll see warning: `⚠ No knowledge directory found. Run 'reygent init' to create .reygent/knowledge/`

## Project Detection & Auto-Initialization

Reygent detects projects by searching upward for markers (`.git`, `package.json`, etc.):

**In a project** (has `.git`, `package.json`, `pyproject.toml`, `Cargo.toml`, etc.):
- **First run**: Auto-creates `.reygent/` with message `✓ Created .reygent/ for local knowledge learning`
- **Telemetry**: Writes to BOTH:
  - Local: `./.reygent/telemetry.db` (project-specific runs)
  - Global: `~/.reygent/telemetry.db` (aggregate across all projects)
- **Knowledge**: `./.reygent/knowledge/` (auto-updated after each run)
- **Config**: Uses `./.reygent/config.json` if exists, otherwise built-in agents

**Outside project** (no markers found):
- **Telemetry**: `~/.reygent/telemetry.db` (global only)
- **Knowledge**: Skipped (no project context)
- **Config**: Built-in agents only

**Works from subdirectories:**
```bash
/my-project/
  ├── .git/
  └── src/
      └── components/

$ cd /my-project/src/components
$ reygent run ...
# Finds .git in parent, creates .reygent/ in /my-project/
```

**Optional: `reygent init` for customization**
- Pre-create `.reygent/` before first run
- Customize agents in `config.json`
- Add custom skills to `skills/`
- Not required for basic usage - auto-initialization works

## Source Control

`.reygent/` is partially committed:

**Committed (shared with team):**
- `config.json` - Agent configurations
- `skills/` - Custom team skills
- `knowledge/project-conventions.md` - User-written project rules
- `knowledge/agents/*.md` - Curated agent tips

**Ignored (local only):**
- `knowledge/common-failures.md` - Auto-generated from local telemetry
- `knowledge/success-patterns.md` - Auto-generated from local telemetry

`.reygent/.gitignore` auto-created during init handles this automatically.

## Directory Structure

```
.reygent/
  knowledge/
    common-failures.md        # Auto-generated from error patterns
    success-patterns.md       # Extracted from successful runs
    project-conventions.md    # User-written project rules
    agents/
      dev.md                  # Dev agent tips
      qe.md                   # QE agent tips
      planner.md              # Planner agent tips
      pr-reviewer.md          # PR reviewer agent tips
```

## Managing Knowledge

**View knowledge:**
```bash
# List all files
reygent knowledge list

# Show specific file
reygent knowledge show common-failures
reygent knowledge show agents/dev

# Search across all files
reygent knowledge search "circular import"
```

**Add entries:**
```bash
# Document a failure (with interactive prompts if options omitted)
reygent knowledge add-failure \
  --issue "Circular import between modules" \
  --solution "Import inside function scope" \
  --agent dev \
  --example "def get_user(): from .models import User; return User.query.get(1)"

# Interactive mode - prompts for all fields
reygent knowledge add-failure

# Document a success pattern (with interactive prompts if options omitted)
reygent knowledge add-pattern \
  --description "Dependency analysis first" \
  --approach "1. List files\n2. Identify deps\n3. Order by deps" \
  --success-rate 95

# Interactive mode - prompts for all fields
reygent knowledge add-pattern

# Edit file directly
reygent knowledge edit common-failures
reygent knowledge edit agents/dev
```

**Auto-update from telemetry:**

Knowledge base updates **automatically after every run** (when in a project):
- Extracts top 3 failure patterns from last 7 days
- Extracts top 3 success patterns (85%+ success rate)
- Writes to knowledge files silently
- No user interaction required
- Works from any subdirectory in project
- **Auto-enabled** - just run `reygent` in your project

**Automatic file management:**
- **Deduplication**: Updates existing entries instead of creating duplicates
- **Occurrence tracking**: Increments occurrence count when pattern repeats
- **Auto-pruning**: Removes stale entries (failures >90 days, patterns >60 days)
- **Size limits**: Max 50 failures, 30 patterns (keeps most recent)

Manual analysis (for review):
```bash
# View patterns without updating
reygent analyze failures --since 30d
reygent analyze success --min-success-rate 85

# Force update from specific time window
reygent analyze failures --update-knowledge --since 90d
```

**View statistics:**
```bash
# Show effectiveness metrics
reygent knowledge stats

# Output:
# Files: 7
# Total entries: 15
#
# Usage (last 30 days):
#   Consulted runs: 12
#   Baseline runs: 8
#
# Effectiveness:
#   Success rate with knowledge: 92%
#   Baseline success rate: 75%
#   Improvement: +17%
```

## Knowledge Format

**common-failures.md:**
```markdown
## Circular imports between auth.py and models.py
**Occurrences**: 5 runs
**Last seen**: 2026-05-08
**Agent**: dev

**Solution**: Import User model inside function scope, not module-level.

**Example**:
\`\`\`python
# Bad - causes circular import
from .models import User

def get_current_user():
    return User.objects.get(...)

# Good - deferred import
def get_current_user():
    from .models import User
    return User.objects.get(...)
\`\`\`

---
```

**success-patterns.md:**
```markdown
## Dependency analysis first
**Last seen**: 2026-05-10
**Success rate**: 95%

**Pattern**: Specs that start with dependency analysis have higher success rates.

**Approach**:
1. List files that will be modified
2. Identify dependencies between them
3. Determine modification order
4. Write spec with order preserved

---
```

**agents/dev.md:**
```markdown
# Dev Agent Tips

## Common Failures

### Missing database migrations
**Issue**: Model changes without migrations cause runtime errors.
**Fix**: Always run makemigrations after model changes.

## Success Patterns

### Reference similar features
**Observation**: Specs referencing existing similar code have 91% success rate.

---
```

## How It Works

1. **Knowledge injection**: Before spawning an agent, Reygent loads relevant knowledge from `.reygent/knowledge/` and injects it into the agent's system prompt.

2. **Smart filtering**: Only relevant knowledge is injected:
   - Agent-specific tips for the current agent
   - Common failures filtered by agent name
   - Recent success patterns (last 30 days)
   - Project conventions (always included)

3. **Telemetry tracking**: Knowledge consultation is tracked via telemetry events:
   - `knowledge.consulted` - When knowledge loaded before agent spawn
   - `knowledge.prevented_failure` - When knowledge helps avoid documented failure
   - `knowledge.success` - When knowledge-based run succeeds

4. **Effectiveness measurement**: Compare success rates between runs that consulted knowledge vs baseline runs without knowledge.

5. **Auto-learning**: After every run, system automatically extracts top patterns from last 7 days and updates knowledge files. Runs silently without interrupting workflow.

## Advanced Configuration

**.reygent/config.json knowledge options:**
```json
{
  "knowledge": {
    "enabled": true,
    "auto_update": true,           // Update after each run
    "max_failures": 50,            // Max failure entries
    "max_patterns": 30,            // Max pattern entries
    "failure_ttl_days": 90,        // Failure staleness threshold
    "pattern_ttl_days": 60,        // Pattern staleness threshold
    "min_success_rate": 85,        // Min success rate for patterns
    "lookback_days": 7,            // Days to analyze for auto-update
    "injection": {
      "max_failures_per_agent": 10,
      "max_patterns_per_agent": 5,
      "include_project_conventions": true
    }
  }
}
```

**Environment variables:**
```bash
# Disable knowledge learning
export REYGENT_KNOWLEDGE=false

# Debug mode
export REYGENT_DEBUG=knowledge       # Knowledge injection
```

## Implementation Details

**Chesstrace integration:**
Chesstrace is Reygent's internal event tracking system. Wraps SQLite telemetry DB with structured event logging. All `knowledge.*` events flow through Chesstrace API.

**Scoring algorithm:**
Knowledge entries ranked by:
1. Recency - exponential decay (0.5 weight after 30 days)
2. Occurrence - linear scaling (5+ occurrences = max score)
3. Success rate - for patterns only (>90% weighted higher)

Score = `(recency * 0.5) + (occurrences * 0.3) + (success_rate * 0.2)`

Top-scored entries injected into agent prompts (max 10 failures + 5 patterns per agent).

**Pruning logic:**
Auto-runs after every knowledge update:
1. Remove failures not seen in 90 days
2. Remove patterns with <70% success rate after 60 days
3. Keep max 50 failures (prune lowest-scored)
4. Keep max 30 patterns (prune lowest-scored)
5. Dedup by fuzzy title match (Levenshtein distance <5)

**Deduplication:**
When adding new entry:
1. Normalize title (lowercase, remove punctuation)
2. Compare to existing entries
3. If match found: increment occurrence count, update timestamp
4. If no match: append new entry

## File Structure

**New files:**
- `src/knowledge/loader.ts` - Load and parse knowledge files
- `src/knowledge/analyzer.ts` - Analyze telemetry for patterns
- `src/commands/knowledge.ts` - CLI commands

**Modified files:**
- `src/spawn.ts` - Inject knowledge into agent prompts
- `src/chesstrace/events.ts` - Add knowledge.* telemetry events

**Dependencies:**
- Uses `marked` for markdown parsing
- Integrates with existing Chesstrace telemetry system
- Knowledge files stored locally in `.reygent/knowledge/`

## Troubleshooting

**Knowledge not injected:**
```bash
# Check knowledge directory exists
ls -la .reygent/knowledge/

# Check files have content
cat .reygent/knowledge/common-failures.md

# Enable debug logging
REYGENT_DEBUG=knowledge reygent run ...
```

**Auto-update not working:**
```bash
# Check project detection
reygent status  # Shows project root and .reygent/ location

# Check telemetry has data
reygent analyze failures --since 7d

# Manually trigger update
reygent analyze failures --update-knowledge --since 7d
```

**Knowledge files corrupted:**
```bash
# Validate markdown syntax
npx markdownlint .reygent/knowledge/*.md

# Reset to templates
rm .reygent/knowledge/*.md
reygent init --force  # Recreates templates
```
