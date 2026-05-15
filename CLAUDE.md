# Reygent - Claude Code Integration

This file contains Claude Code specific integration notes. For general Reygent documentation, see [README.md](./README.md) and [docs/](./docs/).

## Quick Reference

- **Full Documentation**: See [README.md](./README.md) for commands, agents, providers, and workflows
- **Telemetry**: See [docs/telemetry.md](./docs/telemetry.md) for analysis commands and troubleshooting
- **Living Documentation**: See [docs/knowledge.md](./docs/knowledge.md) for auto-learning knowledge system
- **Architecture**: See [docs/architecture.md](./docs/architecture.md) for technical implementation details

## Tech Stack

- TypeScript
- tsup (bundling)
- commander (CLI framework)
- Node.js 22+

## Development

- Build: `npm run build`
- Dev: `npm run dev`
- Verify pricing: Use `/verify-pricing` skill in Claude Code

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

This project uses **chalk** and **ora** for terminal output. **cli-progress** is available as a dependency but not currently used in the codebase. Always use chalk/ora instead of plain `console.log` for anything user-facing.

### Setup

Ensure these packages are installed:
```
npm install chalk ora
```

Both are ESM-compatible. Use ESM imports (`import`) unless the project uses CommonJS, in which case use dynamic `import()`.

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

### cli-progress — progress bars for batch work (available, not yet used)

cli-progress is installed as a dependency but not yet imported in the codebase. Use it when adding operations with a known number of steps (file processing, batch uploads, loops, etc.).

---

### General conventions

- Start scripts with a chalk-styled header line identifying the tool and version.
- Print a blank line before and after progress bars and spinners for breathing room.
- On fatal errors: print with `chalk.red.bold('Error:')`, then the message, then `process.exit(1)`.
- Use `chalk.gray` for timestamps and secondary metadata.
- Keep output scannable: one concept per line, consistent indentation.

## Provider Adapter Contract

Provider adapters (Claude, Gemini, Codex, OpenRouter) implement the `ProviderAdapter` interface defined in `src/providers/types.ts`. The `spawn()` method returns a `SpawnResult` with the following structure:

### SpawnResult Interface

```typescript
interface SpawnResult {
  stdout: string;          // Agent output text
  exitCode: number;        // 0 for success, non-zero for failure
  usage?: UsageInfo;       // Optional cost/token metrics
  errorMessage?: string;   // Clean error message from provider (e.g., "Model not available")
  apiErrorStatus?: number; // HTTP status code from API error (e.g., 404, 401, 429)
}
```

### Field Descriptions

- **stdout**: Primary output text from agent. May contain JSON, markdown, or plain text depending on agent type.
- **exitCode**: Standard exit code convention. 0 = success, non-zero = failure.
- **usage**: Optional telemetry for cost tracking (USD, tokens, duration). See `src/usage.ts` for full interface.
- **errorMessage**: Optional clean error message from provider. Only present when `exitCode !== 0` and provider returned structured error info. Preferred over parsing stdout for error details.
- **apiErrorStatus**: Optional HTTP status code from API errors. Only present when provider API returned an error (404 model not found, 401 auth failure, 429 rate limit, etc.).

### Error Handling Pattern

When `exitCode !== 0`, consumers should use `formatExitDetail()` from `src/spawn.ts` to build user-friendly error messages:

```typescript
import { formatExitDetail } from "./spawn.js";

const result = await spawnAgentStream("dev", prompt, 120_000);
if (result.exitCode !== 0) {
  const detail = formatExitDetail(result);
  throw new TaskError(`Agent failed with code ${result.exitCode}${detail}`);
}
```

**formatExitDetail()** behavior:
- Prefers `errorMessage` + `apiErrorStatus` if present (e.g., "Model not available (HTTP 404)")
- Falls back to first 500 chars of `stdout` if no `errorMessage`
- Adds helpful tips for common errors (e.g., 404 model errors suggest running `reygent config`)
- Returns empty string if no error info available

### Telemetry Integration

When emitting `Events.ERROR_TASK` to chesstrace, always include `errorMessage` and `apiErrorStatus` fields:

```typescript
import { getChesstrace } from "./chesstrace/index.js";
import { Events } from "./chesstrace/events.js";

if (exitCode !== 0) {
  const chesstrace = getChesstrace();
  if (chesstrace) {
    chesstrace.emit(Events.ERROR_TASK, {
      type: "TaskError",
      message: `Agent failed: ${formatExitDetail(result)}`,
      stage: "plan",
      agent: "planner",
      errorMessage: result.errorMessage,
      apiErrorStatus: result.apiErrorStatus,
    });
  }
}
```

This pattern is used in:
- `src/planner.ts` (planning stage)
- `src/generate-spec.ts` (clarification and generation stages)
- `src/implement.ts` (implementation stage)

### Provider Implementation Notes

**Claude provider** (`src/providers/claude.ts`):
- Parses `StreamResultMessage` from agent stdout
- Sets `errorMessage` and `apiErrorStatus` when `is_error: true` flag present
- Example: `{ type: "result", is_error: true, result: "Model not available", api_error_status: 404 }`

**Other providers**: Should follow same pattern when API errors occur. Check provider CLI/library for error response structure.

## Security

Reygent implements comprehensive security measures enforced across ALL providers (Claude, Gemini, Codex, OpenRouter).

**Implementation**: Core security code in provider-agnostic locations:
- Error sanitization: `src/knowledge/analyzer.ts`
- Knowledge validation: `src/knowledge/loader.ts`
- DB limits: `src/chesstrace/backends/sqlite.ts`
- Cross-project isolation: `src/chesstrace/backends/dual.ts`
- Path traversal limits: `src/project-detection.ts`

**For complete security details**, including threat model, configuration, and developer guidelines, see **[SECURITY.md](./SECURITY.md)**.

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

See `.claude/skills/verify-pricing/SKILL.md` for full implementation details.
