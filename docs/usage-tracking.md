# Usage Tracking

Reygent tracks cost, tokens, and duration for every agent invocation. Data flows from providers through `UsageTracker` to a summary displayed at the end of each run.

## UsageInfo Fields

| Field          | Type     | Description                        |
|---------------|----------|------------------------------------|
| `costUsd`     | `number` | Total cost in USD                  |
| `durationMs`  | `number` | Wall-clock time of the invocation  |
| `inputTokens` | `number` | Prompt/input token count           |
| `outputTokens`| `number` | Completion/output token count      |
| `numTurns`    | `number` | Number of agentic turns (Claude)   |

All fields are optional. Providers report what they can.

## Provider Coverage

| Provider   | Duration | Input Tokens | Output Tokens | Cost   | Turns |
|-----------|----------|-------------|--------------|--------|-------|
| Claude     | Yes      | Yes         | Yes          | Yes    | Yes   |
| OpenRouter | Yes      | Yes         | Yes          | Yes*   | No    |
| Gemini     | Yes      | Best-effort | Best-effort  | No     | No    |
| Codex      | Yes      | Best-effort | Best-effort  | No     | No    |

\* OpenRouter cost depends on the upstream model reporting `total_cost` in the API response.

Gemini and Codex are CLI providers. Token counts depend on whether the CLI includes usage metadata in its JSON output. Duration is always available since it is measured client-side.

## Data Flow

1. **Provider `spawn()`** returns `SpawnResult` with optional `usage: UsageInfo`
2. **`src/spawn.ts`** passes `SpawnResult.usage` to the caller
3. **`src/implement.ts` / `src/gate.ts`** call `UsageTracker.record(agent, stage, usage)`
4. **`src/commands/run.ts`** calls `printUsageSummary(tracker)` at the end of the run

## UsageTracker API

- `record(agent, stage, usage)` — store one entry
- `getTotalCost()` — sum of all `costUsd` values
- `getByAgent()` — aggregated stats per agent name
- `getEntries()` — raw entry list

## Summary Output

`printUsageSummary()` displays a table with total cost, duration, token counts, and per-agent breakdown. `printVerboseUsage()` shows every individual invocation with full detail.
