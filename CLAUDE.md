# Reygent

## Tech Stack

- TypeScript
- tsup (bundling)
- commander (CLI framework)
- Node.js 22+

## Development

- Build: `npm run build`
- Dev: `npm run dev`
- Verify pricing: Use `/verify-pricing` skill in Claude Code (see below)

## Conventions

- Source code lives in `src/`
- Entry point: `src/cli.ts`
- Bundle output: `dist/`

## Config System

- **Built-in agents:** `src/agents.ts` exports `builtinAgents` array
- **Config loader:** `src/config.ts` handles local vs global resolution
- **Local config:** `.reygent/config.json` (searched upward from cwd)
- **Fallback:** If no local config found, use built-in agents
- All agent-consuming code uses `getAgents()` from `src/config.ts`

## Branch Naming

Branch names use **conventional commit prefixes** to categorize work types. Format: `<type>/<identifier>` where `<identifier>` is the issue key (Jira/Linear) or slugified title (markdown).

### Valid Branch Types

| Type | Description | Example |
|------|-------------|---------|
| `feat` | New features | `feat/PROJ-123`, `feat/add-user-auth` |
| `fix` | Bug fixes | `fix/DT-456`, `fix/login-error` |
| `chore` | Maintenance tasks | `chore/PROJ-789`, `chore/update-deps` |
| `refactor` | Code refactoring | `refactor/DT-999`, `refactor/auth-module` |
| `docs` | Documentation | `docs/PROJ-111`, `docs/update-readme` |
| `test` | Test additions/fixes | `test/DT-222`, `test/add-unit-tests` |
| `style` | Code style changes | `style/PROJ-333`, `style/format-files` |
| `perf` | Performance improvements | `perf/DT-444`, `perf/optimize-queries` |

**Aliases:** `feature` → `feat`, `bugfix` → `fix`

### Type Detection

Branch types auto-detect from issue metadata when possible:

#### Jira Issue Type Mapping

Jira issue types detected using **partial match** (e.g., "Bug Fix" matches "bug" keyword):

| Jira Issue Type Pattern | Branch Type | Example |
|------------------------|-------------|---------|
| bug, fix | `fix` | PROJ-456 (Bug) → `fix/PROJ-456` |
| story, feature, enhancement | `feat` | PROJ-123 (Story) → `feat/PROJ-123` |
| task, chore | `chore` | PROJ-789 (Task) → `chore/PROJ-789` |
| refactor, technical debt | `refactor` | PROJ-999 (Technical Debt) → `refactor/PROJ-999` |
| doc | `docs` | PROJ-111 (Documentation) → `docs/PROJ-111` |
| test | `test` | PROJ-222 (Test) → `test/PROJ-222` |
| style | `style` | PROJ-333 (Style) → `style/PROJ-333` |
| perf, performance | `perf` | PROJ-444 (Performance) → `perf/PROJ-444` |
| *(other)* | prompt user | Epic → prompt for type |

#### Linear Label Mapping

Linear labels detected using **partial match** (e.g., "bugfix" label matches "bug" keyword):

| Label Pattern | Branch Type | Priority | Example |
|---------------|-------------|----------|---------|
| bug, bugfix | `fix` | 1 (highest) | ["bug", "urgent"] → `fix/DT-123` |
| feature | `feat` | 2 | ["feature", "ui"] → `feat/DT-456` |
| chore, maintenance | `chore` | 3 | ["maintenance"] → `chore/DT-789` |
| refactor, tech-debt | `refactor` | 3 | ["tech-debt"] → `refactor/DT-999` |
| doc, documentation | `docs` | 3 | ["documentation"] → `docs/DT-111` |

**Priority:** If multiple type labels present, bug takes precedence over feature.

### Type Selection Priority

1. **CLI flag** (`--type feat`) — highest priority, skips all detection
2. **Auto-detection** — from Jira issue type or Linear labels
3. **Interactive prompt** — when no flag and no detection available

### Implementation

- **Production logic:** `src/branch-type.ts` exports all detection, validation, and branch name functions
  - `detectTypeFromJiraIssueType()` - Jira issue type → branch type (partial match)
  - `detectTypeFromLinearLabels()` - Linear labels → branch type (partial match with priority)
  - `normalizeType()` - Validate and normalize type strings
  - `deriveBranchNameWithType()` - Generate branch name from spec + type
  - `promptForType()` - Interactive type selection
- **CLI validation:** `src/cli.ts` validates `--type` flag at parse time using `isValidType()`
- **Branch creation:** `src/commands/run.ts` uses detection functions and prompting logic
- **Type constant:** `VALID_BRANCH_TYPES` in `src/branch-type.ts` is single source of truth
- **Legacy exports:** `src/pr-create.ts` still exports deprecated versions for backward compatibility

### Rules

- Type detection uses **partial match** for both Jira and Linear (e.g., "Bug Fix" matches "bug", "Feature Request" matches "feature")
- Type detection is **case-insensitive** (BUG, bug, Bug all map to `fix`)
- Issue identifiers **preserve case** (PROJ-123, DT-456 stay uppercase)
- Markdown titles **slugify to lowercase** with dashes, max 60 chars
- Invalid types throw clear error messages listing valid options

## Terminal output style

This project uses **chalk**, **ora**, and **cli-progress** for terminal output. Always use these libraries instead of plain `console.log` for anything user-facing.

### Setup

Ensure these packages are installed:
```
npm install chalk ora cli-progress
```

All three are ESM-compatible. Use ESM imports (`import`) unless the project uses CommonJS, in which case use dynamic `import()`.

---

### chalk — colors and text styling

Use chalk for all colored or styled terminal text.

- `chalk.green('...')` — success messages
- `chalk.red('...')` — errors
- `chalk.yellow('...')` — warnings
- `chalk.blue('...')` or `chalk.cyan('...')` — info/labels
- `chalk.gray('...')` — secondary/muted text
- `chalk.bold('...')` — emphasis
- `chalk.bgBlue.white(' TAG ')` — inline badges/labels

Prefer semantic color choices (green = good, red = bad, yellow = caution). Chain styles: `chalk.bold.green(...)`. Do not use chalk for log messages that go to files or are machine-parsed.

---

### ora — spinners for async tasks

Use ora whenever an async operation takes perceptible time (network requests, file I/O, builds, etc.).

Pattern:
```js
import ora from 'ora';

const spinner = ora('Fetching data...').start();
try {
  await doWork();
  spinner.succeed(chalk.green('Done'));
} catch (err) {
  spinner.fail(chalk.red(`Failed: ${err.message}`));
}
```

- `.succeed(msg)` — green checkmark
- `.fail(msg)` — red cross
- `.warn(msg)` — yellow warning
- `.info(msg)` — blue info
- Always call `.succeed()`, `.fail()`, or `.stop()` — never leave a spinner running on exit.
- Use `spinner.text = '...'` to update the label mid-task.

---

### cli-progress — progress bars for batch work

Use cli-progress for operations with a known number of steps (file processing, batch uploads, loops, etc.).

Single bar:
```js
import { SingleBar, Presets } from 'cli-progress';

const bar = new SingleBar({
  format: '{task} {bar} {percentage}% | {value}/{total}',
  barCompleteChar: '█',
  barIncompleteChar: '░',
  hideCursor: true,
}, Presets.shades_classic);

bar.start(total, 0, { task: 'Processing' });
for (const item of items) {
  await process(item);
  bar.increment();
}
bar.stop();
```

Multi bar (parallel tasks):
```js
import { MultiBar, Presets } from 'cli-progress';
const multi = new MultiBar({ hideCursor: true }, Presets.shades_classic);
const b1 = multi.create(100, 0, { label: 'Task A' });
const b2 = multi.create(100, 0, { label: 'Task B' });
// ... increment individually
multi.stop();
```

- Always call `.stop()` when done.
- Do not mix `console.log` with an active progress bar — use `bar.update()` payload fields for status text instead.

---

### General conventions

- Start scripts with a chalk-styled header line identifying the tool and version.
- Print a blank line before and after progress bars and spinners for breathing room.
- On fatal errors: print with `chalk.red.bold('Error:')`, then the message, then `process.exit(1)`.
- Use `chalk.gray` for timestamps and secondary metadata.
- Keep output scannable: one concept per line, consistent indentation.

## Telemetry Analysis

Analyze Reygent runs to optimize performance and reduce costs:

- `reygent last` - Show latest run details (quick summary, verbose log, output, errors, or JSON)
- `reygent analyze failures` - Common error patterns
- `reygent analyze success` - What works well
- `reygent analyze costs` - Cost breakdown and savings
- `reygent analyze agents` - Agent performance comparison

All analysis runs on local telemetry database. No data leaves your machine.

### Command Details

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

## Provider Pricing Verification

Provider pricing data lives in `src/pricing.ts`. To verify accuracy against current provider documentation:

**Use Claude Code skill:**
```
/verify-pricing
```

The skill:
- Fetches current pricing from provider documentation URLs
- Compares against `src/pricing.ts` values
- Reports mismatches with suggested updates
- Auto-updates `lastVerified` dates when all values match
- Prompts for confirmation before applying pricing changes when mismatches exist

See `.claude/skills/verify-pricing.md` for full implementation details.