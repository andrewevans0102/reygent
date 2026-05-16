# Provider Adapter Contract

Provider adapters (Claude, Gemini, Codex, OpenRouter) implement the `ProviderAdapter` interface defined in `src/providers/types.ts`. This document describes the contract that all providers must follow.

## ProviderAdapter Interface

```typescript
interface ProviderAdapter {
  name: string;
  type: "cli" | "api";
  defaultModel: string;
  supportedModels: ModelEntry[];
  shortAliases: Record<string, string>;

  isAvailable(): Promise<{ available: boolean; reason?: string }>;
  spawn(options: SpawnAdapterOptions): Promise<SpawnResult>;
  spawnInteractive(systemPrompt: string, model: string): Promise<number>;
}
```

## SpawnResult Interface

The `spawn()` method returns a `SpawnResult` with the following structure:

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

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `stdout` | `string` | Yes | Primary output text from agent. May contain JSON, markdown, or plain text depending on agent type. |
| `exitCode` | `number` | Yes | Standard exit code convention. `0` = success, non-zero = failure. |
| `usage` | `UsageInfo` | No | Optional telemetry for cost tracking (USD, tokens, duration). See `src/usage.ts` for full interface. |
| `errorMessage` | `string` | No | Clean error message from provider. Only present when `exitCode !== 0` and provider returned structured error info. Preferred over parsing stdout for error details. |
| `apiErrorStatus` | `number` | No | HTTP status code from API errors. Only present when provider API returned an error (404 model not found, 401 auth failure, 429 rate limit, etc.). |

## Error Handling Pattern

When `exitCode !== 0`, consumers should use `formatExitDetail()` from `src/spawn.ts` to build user-friendly error messages:

```typescript
import { formatExitDetail } from "./spawn.js";

const result = await spawnAgentStream("dev", prompt, 120_000);
if (result.exitCode !== 0) {
  const detail = formatExitDetail(result);
  throw new TaskError(`Agent failed with code ${result.exitCode}${detail}`);
}
```

### formatExitDetail() Behavior

The `formatExitDetail()` helper function provides consistent error formatting:

- **Prefers errorMessage + apiErrorStatus** if present (e.g., "Model not available (HTTP 404)")
- **Falls back to first 500 chars of stdout** if no errorMessage
- **Adds helpful tips** for common errors (e.g., 404 model errors suggest running `reygent config`)
- **Returns empty string** if no error info available

Example output:
```
Agent failed with code 1
  Model not available (HTTP 404)
  Tip: edit .reygent/config.json "model" field, or run `reygent config` to pick a supported model.
```

## Telemetry Integration

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

## Provider Implementation Notes

### Claude Provider (`src/providers/claude.ts`)

**Error detection:**
- Parses `StreamResultMessage` from agent stdout (newline-delimited JSON stream)
- Sets `errorMessage` and `apiErrorStatus` when `is_error: true` flag present in result event
- Example error event:
  ```json
  {
    "type": "result",
    "is_error": true,
    "result": "Model not available",
    "api_error_status": 404
  }
  ```

**JSON stream format:**
```json
{"type": "assistant", "message": {"content": [...]}}
{"type": "result", "result": "...", "total_cost_usd": 0.05, ...}
```

**Workspace trust:**

Reygent unconditionally passes `--skip-git-repo-check` to the Claude CLI. Without this flag, Claude CLI refuses to run in directories that are either:
1. Not a git repository
2. Not previously marked as "trusted" by the user in Claude Code

Since reygent already prompts "Auto-approve all actions? (y/n)" before spawning agents, the trust concern is handled at the reygent level. The flag prevents unnecessary failures for users who haven't initialized a git repo or haven't previously used Claude Code in the directory.

When no `.git` directory is detected, the Claude provider emits a one-time warning to stderr advising users that file changes won't be version-controlled.

### Gemini Provider (`src/providers/gemini.ts`)

**Error detection:**
- Tries to parse JSON output for structured error object
- Looks for `error.message` and `error.code`/`error.status` fields
- Maps Gemini error codes to HTTP status codes:
  - Numeric codes are used directly (e.g., `404`, `429`, `500`)
  - String codes are mapped to HTTP status:
    - `"not_found"`, `"model_not_found"` → 404
    - `"permission_denied"`, `"unauthenticated"` → 403
    - `"invalid_api_key"`, `"invalid_authentication"` → 401
    - `"resource_exhausted"`, `"rate_limit_exceeded"` → 429
    - `"internal"`, `"server_error"` → 500
    - `"invalid_argument"` → 400
- Falls back to stderr if exitCode non-zero and no structured error

**Expected JSON format:**
```json
{
  "response": "agent output text",
  "usage_metadata": {
    "prompt_token_count": 100,
    "candidates_token_count": 50
  },
  "error": {
    "message": "Model not found",
    "code": 404,
    "status": 404
  }
}
```

**Alternative error format (string codes):**
```json
{
  "error": {
    "message": "Permission denied",
    "code": "permission_denied"
  }
}
```

### Codex Provider (`src/providers/codex.ts`)

**Error detection:**
- Tries to parse JSON output for structured error object
- Looks for `error.message` and `error.code` fields
- Maps OpenAI error codes (strings) to HTTP status codes using **exact match first**, then fallback to partial match:
  - **Exact matches:**
    - `"model_not_found"`, `"invalid_model"` → 404
    - `"invalid_api_key"`, `"invalid_request_error"` → 401
    - `"rate_limit_exceeded"` → 429
    - `"insufficient_quota"` → 402
    - `"server_error"` → 500
  - **Fallback (partial match):**
    - `.includes("not_found")` → 404
    - `.includes("auth")`, `.includes("unauthorized")` → 401
- Falls back to stderr if exitCode non-zero and no structured error

**Expected JSON format:**
```json
{
  "response": "agent output text",
  "usage": {
    "prompt_tokens": 100,
    "completion_tokens": 50,
    "prompt_tokens_details": {
      "cached_tokens": 20
    }
  },
  "error": {
    "message": "Model not found",
    "code": "model_not_found",
    "status": 404
  }
}
```

**Error codes list (OpenAI format):**
```json
{
  "error": {
    "message": "The model `gpt-5.4` does not exist",
    "code": "model_not_found",
    "type": "invalid_request_error"
  }
}
```

## Implementation Checklist

When implementing a new provider adapter, ensure:

- [ ] `spawn()` returns `SpawnResult` with all required fields
- [ ] `errorMessage` populated when provider returns structured error
- [ ] `apiErrorStatus` populated when HTTP status available
- [ ] Falls back to stderr/stdout when no structured error available
- [ ] Exit code is `0` for success, non-zero for failures
- [ ] `usage` field includes provider name for telemetry
- [ ] Timeout handling kills child process and throws `TaskError`
- [ ] Activity events sent to `onActivity` callback when provided
- [ ] Interactive mode (`spawnInteractive`) returns exit code

## Testing Error Handling

Test error handling with invalid model names:

```bash
# Should show helpful error with tip to run `reygent config`
reygent run spec.md --provider claude --model model-does-not-exist-404
```

Integration test pattern:
```typescript
it("surfaces errorMessage and apiErrorStatus on model not found", async () => {
  const result = await spawnAgentStream(
    "test-agent",
    "Test.",
    5000, // Most providers fail fast on 404 (<5s)
    { provider: "gemini", model: "invalid-model" }
  );

  expect(result.exitCode).not.toBe(0);
  expect(result.errorMessage).toBeDefined();
  expect(result.apiErrorStatus).toBe(404);

  const detail = formatExitDetail(result, "invalid-model");
  expect(detail).toContain("Tip:");
});
```

## Related Files

- **Interface definition:** `src/providers/types.ts`
- **Error formatting:** `src/spawn.ts` (`formatExitDetail` function)
- **Provider implementations:**
  - `src/providers/claude.ts`
  - `src/providers/gemini.ts`
  - `src/providers/codex.ts`
  - `src/providers/openrouter.ts`
- **Consumer examples:**
  - `src/planner.ts`
  - `src/generate-spec.ts`
  - `src/implement.ts`
