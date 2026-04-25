# Technical Architecture

A deep-dive into how reygent works under the hood — from command invocation to agent subprocess management, JSON extraction, state threading, and platform API integration.

## System Overview

Reygent is a meta-orchestrator: it doesn't call the Claude API directly. Instead, it spawns the `claude` CLI as child processes, each acting as an independent AI agent with a specific role and toolset. The pipeline coordinates these agents through a shared `TaskContext` state object.

```
┌──────────────────────────────────────────────────┐
│                  reygent CLI                     │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │
│  │ Commander │  │  Config  │  │  Spec Loader │   │
│  │  (CLI)    │  │  System  │  │  (md/jira/   │   │
│  │          │  │          │  │   linear)     │   │
│  └────┬─────┘  └────┬─────┘  └──────┬───────┘   │
│       │              │               │           │
│       ▼              ▼               ▼           │
│  ┌───────────────────────────────────────────┐   │
│  │            Pipeline Orchestrator          │   │
│  │         (commands/run.ts)                 │   │
│  └───────────────┬───────────────────────────┘   │
│                  │                               │
│    ┌─────────────┼─────────────┐                 │
│    ▼             ▼             ▼                 │
│ ┌──────┐  ┌──────────┐  ┌──────────┐            │
│ │Planner│  │Implement │  │  Gates   │            │
│ └──┬───┘  └────┬─────┘  └────┬─────┘            │
│    │           │              │                   │
│    ▼           ▼              ▼                   │
│ ┌────────────────────────────────────────────┐   │
│ │          spawn.ts (Agent Spawner)          │   │
│ └────────────────────┬───────────────────────┘   │
│                      │                           │
└──────────────────────┼───────────────────────────┘
                       │
                       ▼
              ┌────────────────┐
              │   claude CLI   │
              │  (subprocess)  │
              └────────────────┘
```

## File Structure

```
src/
├── cli.ts              # Entry point, Commander setup, command registration
├── agents.ts           # AgentConfig interface + builtinAgents array
├── config.ts           # Config resolution (local .reygent/ → built-in fallback)
├── env.ts              # .env file parser
├── spec.ts             # Spec loading (markdown, Jira, Linear dispatch)
├── linear.ts           # Linear GraphQL API client
├── jira.ts             # Jira REST API client
├── spawn.ts            # Claude CLI subprocess spawner + stream-json parser
├── task.ts             # Type definitions, TaskContext, PIPELINE constant
├── planner.ts          # Planner agent execution + JSON extraction
├── implement.ts        # Dev + QE agent orchestration (parallel/sequential)
├── gate.ts             # Test gate runner (unit + functional)
├── security-review.ts  # Security scan + severity comparison
├── pr-create.ts        # Git operations + GitHub/GitLab API PR creation
├── pr-review.ts        # PR diff review + comment posting
├── generate-spec.ts    # Spec generation from description
└── commands/
    ├── init.ts          # `reygent init` handler
    ├── agent.ts         # `reygent agent` handler (interactive sessions)
    ├── spec.ts          # `reygent spec` handler
    ├── generate-spec.ts # `reygent generate-spec` handler
    └── run.ts           # `reygent run` handler (pipeline orchestrator)
```

## Entry Point: How a Command Starts

### 1. CLI Parsing (`src/cli.ts`)

The `commander` library parses `process.argv` and dispatches to the appropriate command handler. Before dispatch (unless `--help` or `--version`), a styled header is printed:

```
reygent v0.1.0
```

### 2. Environment Loading

Commands that need external APIs call `loadEnvFile()` from `src/env.ts`. This is a custom parser (no `dotenv` dependency) that:
- Reads `.env` from `process.cwd()`
- Parses `KEY=VALUE` lines, strips quotes
- Only sets vars not already in `process.env` (no overrides)

### 3. Spec Loading (`src/spec.ts`)

The `loadSpec(source)` function dispatches based on input pattern:

```typescript
// Decision logic
if (isLinearUrl(source))     → readLinearSpec(extractLinearId(source))
if (/^[A-Z]+-\d+$/.test(source)) → readLinearSpec() or readJiraSpec() based on env vars
else                         → readSpec(source)  // treat as file path
```

**Linear** (`src/linear.ts`): Fetches via GraphQL API. Includes child/sub-issues.

**Jira** (`src/jira.ts`): Fetches via REST API v3 with Basic auth. Parses Atlassian Document Format (ADF) for description content. Checks multiple custom fields for acceptance criteria.

**Markdown**: Reads file, validates non-empty, extracts title from first `# Heading`.

All three return a `SpecPayload` with `{ source, content, title }` (plus `issueKey` or `issueId` for tracker sources).

---

## Agent Spawning: The Core Mechanism

### How `spawnAgentStream` Works (`src/spawn.ts`)

This is the most critical function — it's how reygent talks to Claude.

```typescript
spawnAgentStream(name: string, prompt: string, timeoutMs: number, options?: SpawnOptions)
```

**Step 1: Build CLI arguments**

```typescript
const args = ["-p", prompt, "--output-format", "stream-json", "--verbose"];
if (options?.autoApprove) {
  args.push("--allowedTools", "Bash", "Edit", "Write", "Read", "Glob", "Grep");
}
```

**Step 2: Spawn subprocess**

```typescript
const stdinMode = options?.autoApprove === false ? "inherit" : "ignore";
const child = spawn("claude", args, { stdio: [stdinMode, "pipe", "pipe"] });
```

Key detail: when `autoApprove` is false, stdin is `"inherit"` so the user sees approval prompts. When true, stdin is `"ignore"` since all tools are pre-approved.

**Step 3: Parse streaming JSON**

The Claude CLI outputs newline-delimited JSON events. Each line is parsed:

```typescript
// Assistant event — contains tool calls and text blocks
{
  "type": "assistant",
  "message": {
    "content": [
      { "type": "tool_use", "name": "Write", "input": { "file_path": "..." } },
      { "type": "text", "text": "I'll create the file..." }
    ]
  }
}

// Result event — final output
{
  "type": "result",
  "subtype": "...",
  "result": "final output text here"
}
```

**Step 4: Real-time logging**

Tool calls are logged to stderr with formatted details:

```
[dev] → Write src/auth.ts
[dev] → Bash npm test
[qe]  → Read src/auth.ts
```

The `formatToolDetail()` function extracts the most relevant info from each tool's input (file path for Read/Write/Edit, command snippet for Bash, pattern for Glob/Grep).

**Step 5: Resolution**

The function waits for three conditions before resolving:
1. stdout stream closed
2. stderr stream closed
3. process exited

This prevents race conditions where the process exits before all output is consumed.

**Step 6: Timeout**

Each agent has a configurable timeout (default 15 min, planner 5 min). If exceeded, the child process is killed and a `TaskError` is thrown.

---

## JSON Extraction: How Structured Output is Parsed

Agents are prompted to output structured JSON, but their output also contains natural language. The `extractJSON()` function (`src/planner.ts`) handles this with three strategies:

### Strategy 1: Fenced Code Block

```
Here's the plan:

\`\`\`json
{ "goals": [...], "tasks": [...] }
\`\`\`
```

Matches the content inside the last ` ```json ... ``` ` block.

### Strategy 2: Last Fenced Block (any language)

Same as above but matches ` ``` ... ``` ` without a language tag.

### Strategy 3: Brace Matching

Finds the last `{ ... }` in the output by tracking brace depth. This handles cases where JSON is embedded in natural language without code fences.

Each agent module (planner, implement, security-review, pr-review) has its own output extraction function that first calls `extractJSON()` then applies regex/parsing specific to that agent's expected schema.

---

## Pipeline Execution: The `run` Command

### The PIPELINE Constant (`src/task.ts`)

```typescript
const PIPELINE: readonly TaskStage[] = [
  { name: "plan",                  execution: { kind: "agent",    agent: "planner" } },
  { name: "implement",             execution: { kind: "parallel", agents: ["dev", "qe"] } },
  { name: "gate-unit-tests",       execution: { kind: "gate",     agent: "dev",  condition: "unit-tests-pass" } },
  { name: "gate-functional-tests", execution: { kind: "gate",     agent: "qe",   condition: "functional-tests-pass" } },
  { name: "security-review",       execution: { kind: "agent",    agent: "security-reviewer" } },
  { name: "pr-create",             execution: { kind: "agent",    agent: "pr-reviewer" } },
  { name: "pr-review",             execution: { kind: "agent",    agent: "pr-reviewer" } },
];
```

Three execution kinds:
- **`agent`** — single agent runs
- **`parallel`** — multiple agents run concurrently (only when auto-approved)
- **`gate`** — pass/fail checkpoint with retry capability

### TaskContext: The State Thread

```typescript
interface TaskContext {
  spec: SpecPayload;              // Set at start
  plan?: PlannerOutput;           // Set by Stage 1
  implement?: ImplementOutput;    // Set by Stage 2
  gates?: GateOutput;             // Set by Stages 3-4
  securityReview?: SecurityReviewOutput; // Set by Stage 5
  prCreate?: PRCreateOutput;      // Set by Stage 6
  prReview?: PRReviewOutput;      // Set by Stage 7
  results: StageResult[];         // Append-only log of all stage outcomes
}
```

Each stage reads from previous stages' context and writes its own output. The `results` array is an append-only log used for diagnostics.

### Stage-by-Stage Execution (`src/commands/run.ts`)

The `runCommand()` function iterates through `PIPELINE` with a `for...of` loop. Each stage is handled by a dedicated `if` block (not a generic dispatcher) because each stage has unique pre/post logic:

1. **Plan**: Runs clarification loop if needed. Validates plan has non-empty goals/tasks/constraints/dod arrays.

2. **Implement**: Builds separate prompts for dev and qe. In auto-approve mode, runs both via `Promise.all()`. In interactive mode, runs sequentially with inherited stdin.

3. **Unit Test Gate**: Spawns dev agent to run the project's test suite. Looks for `GATE_RESULT:PASS` or `GATE_RESULT:FAIL` markers in output. On failure, enters retry loop.

4. **Functional Test Gate**: Same pattern as unit tests but for QE agent's test files. On failure, retries both dev and qe agents.

5. **Security Review**: Runs security-reviewer agent. Compares severity levels numerically: `LOW(0) < MEDIUM(1) < HIGH(2) < CRITICAL(3)`. Fails if any finding >= threshold.

6. **PR Create**: Calls `runPRCreate()` which handles all git operations and API calls.

7. **PR Review**: Gets PR diff via `gh pr diff`, spawns reviewer agent, posts review as PR comment.

---

## Retry Mechanism

### How Retries Work

When a test gate fails, the `retryGate()` function:

1. Prompts the user (interactive mode) or auto-retries (auto-approve mode)
2. Injects `FailureContext` into the agent's prompt:

```typescript
interface FailureContext {
  gateName: string;       // "unit tests" or "functional tests"
  testOutput: string;     // Truncated to 8000 chars
  attempt: number;        // Current attempt
  maxAttempts: number;    // Total allowed
}
```

3. The prompt includes a `RETRY` section:

```
## RETRY (attempt 1/2)

The previous implementation failed the **unit tests** gate.
Review the test output below, identify what went wrong, and fix the issues.

**Test output:**
\`\`\`
... (test failure output, max 8000 chars) ...
\`\`\`
```

4. Re-runs the relevant agents (dev only for unit tests, dev+qe for functional tests)
5. Merges new outputs into `TaskContext`
6. Re-runs the gate
7. Repeats until pass or max retries exhausted

### Output Truncation

Test output is truncated to 8000 characters using a middle-cut strategy:
- Keep first 4000 chars
- Insert `... [truncated] ...`
- Keep last 4000 chars

This preserves both the test command output header and the final failure summary.

---

## PR Creation Internals (`src/pr-create.ts`)

### Remote URL Parsing

Handles both SSH and HTTPS formats:

```
git@github.com:owner/repo.git      → { platform: "github", host: "github.com", owner, repo }
https://github.com/owner/repo.git  → { platform: "github", host: "github.com", owner, repo }
git@gitlab.com:owner/repo.git      → { platform: "gitlab", host: "gitlab.com", owner, repo }
```

Platform is determined by hostname: if it contains "gitlab", it's GitLab; otherwise GitHub.

### Authentication

Uses `git credential fill` — the same mechanism used by the `gh` CLI and git itself:

```typescript
const child = execFile("git", ["credential", "fill"]);
child.stdin.write(`protocol=https\nhost=${host}\n\n`);
// Reads password= line from stdout
```

This works with any credential helper (macOS Keychain, Windows Credential Manager, `gh auth`, etc.).

### TLS/SSL Handling

A sophisticated `resolveTlsOptions()` function handles corporate/enterprise environments:

1. Check `GIT_SSL_NO_VERIFY` env var
2. Check `NODE_TLS_REJECT_UNAUTHORIZED=0`
3. Check `git config --get-urlmatch http.sslVerify` for the specific host
4. Check `git config http.sslVerify` globally
5. Load custom CA bundle from `git config http.sslCAInfo` (combined with Node's root CAs)
6. If all else fails and an SSL error occurs, auto-retry with `rejectUnauthorized: false`

### API Calls

**GitHub** (including Enterprise):
```
POST https://api.github.com/repos/{owner}/{repo}/pulls
POST https://{host}/api/v3/repos/{owner}/{repo}/pulls   (Enterprise)
```

**GitLab**:
```
POST https://{host}/api/v4/projects/{owner%2Frepo}/merge_requests
```

Both use native `node:https` — no `fetch` or HTTP libraries.

### Branch Naming

```typescript
deriveBranchName(spec):
  jira   → "reygent/{issueKey}"       // reygent/PROJ-123
  linear → "reygent/{issueId}"        // reygent/ENG-456
  markdown → "reygent/{slugified}"    // reygent/add-user-avatar-upload (max 60 chars)
```

### Commit Message Format

```
[PROJ-123] Add user avatar upload

Goals:
- Allow users to upload profile avatars
- Store avatars in S3 with CDN

Tasks:
- Add upload endpoint
- Add client-side validation
- Add resize logic
```

### PR Body Generation

The `buildPRBody()` function generates structured markdown with:
- Summary (spec title)
- Goals (from planner)
- Tasks (as checkboxes, all checked)
- Files Changed (from dev agent)
- Test Files (from qe agent)
- Security Review findings
- PR Review comments and recommended actions
- Footer: "Created by reygent"

---

## Error Handling

### Custom Error Classes

```typescript
class TaskError extends Error { name = "TaskError" }
class SpecError extends Error { name = "SpecError" }
```

All command handlers catch both types, print styled error messages via `chalk.red.bold("Error:")`, and call `process.exit(1)`. Unexpected errors re-throw to show the full stack trace.

### Agent Failure Handling

- **Single agent failure in parallel mode**: The other agent's output is preserved; pipeline continues
- **All agents fail**: `TaskError` is thrown
- **Agent timeout**: Child process killed, `TaskError` thrown
- **Agent spawn failure**: `TaskError` thrown (e.g., `claude` CLI not installed)

---

## Build System

### tsup Configuration

```typescript
// tsup.config.ts
{
  entry: ["src/cli.ts"],
  format: ["esm"],
  target: "node18",
  banner: { js: "#!/usr/bin/env node --no-warnings=ExperimentalWarning" }
}
```

Key details:
- ESM-only output (matches `"type": "module"` in package.json)
- Node 18 target
- Shebang with `--no-warnings` to suppress the ESM experimental warning
- Single entry point bundled to `dist/cli.js`

### TypeScript Configuration

```json
{
  "target": "ES2022",
  "module": "ES2022",
  "strict": true,
  "moduleResolution": "bundler"
}
```

Uses `"moduleResolution": "bundler"` which allows `.js` extensions in imports (required for ESM compatibility with tsup).

---

## Design Decisions

### Why Spawn Claude CLI Instead of Using the API?

Reygent spawns `claude` as a subprocess rather than calling the Anthropic API directly. This means:
- **Tool execution happens inside Claude Code's sandbox** — file reads, writes, and bash commands are handled by the Claude CLI's built-in tool system
- **No API key management** — auth is handled by the Claude CLI's existing auth flow
- **Full tool ecosystem** — agents get access to Claude Code's tools (Read, Write, Edit, Bash, Glob, Grep) without reygent having to implement them
- **Stream-json output** — provides real-time visibility into what agents are doing

### Why Not Use a Framework?

No LangChain, no agent framework. The pipeline is a simple `for...of` loop over a static array of stages. Each stage function is called directly. State is threaded via a plain TypeScript object. This keeps the codebase small and debuggable.

This design aligns with the **agent harness pattern** described by Anthropic — structured orchestration of specialized agents rather than a monolithic agent or framework. See [Harness Pattern](./harness-pattern.md) for the full mapping.

### Why Custom .env Parser?

The `loadEnvFile()` function is ~20 lines instead of depending on `dotenv`. It handles the common case (KEY=VALUE with optional quotes) and avoids a dependency for minimal functionality.

### Why `git credential fill` for Auth?

Works with any credential helper the user already has configured (macOS Keychain, `gh auth`, Windows Credential Manager). No separate token configuration needed. If you can `git push`, reygent can create PRs.
