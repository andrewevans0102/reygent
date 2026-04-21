# Agents Guide

Reygent orchestrates multiple specialized AI agents, each with a distinct role, toolset, and set of constraints. This doc covers what each agent does, how they interact within the reygent workflow, and how to customize them.

## Agent Architecture

Every agent is a Claude CLI subprocess. Reygent spawns agents via `claude -p <prompt> --output-format stream-json --verbose`, parses the streaming JSON output, and extracts structured results. Agents don't talk to each other directly — the reygent workflow threads a `TaskContext` object through each stage and injects relevant context into each agent's prompt.

## Built-in Agents

### Dev Agent

| Property | Value |
|---|---|
| **Name** | `dev` |
| **Role** | `developer` |
| **Tools** | `read`, `write`, `bash`, `search` |
| **Timeout** | 15 minutes |

**Purpose:** Write, edit, and refactor implementation code based on the spec and planner output. Includes unit tests alongside implementation.

**Constraints:**
- Follows the project's existing conventions
- Never modifies functional test files (those belong to QE)
- Outputs `{ "files": ["path/to/file.ts", ...] }` when done

**When it runs:**
- Stage 2 (Implement) — writes code and unit tests
- Retry loops for unit test gate failures — fixes code based on test output

---

### QE Agent

| Property | Value |
|---|---|
| **Name** | `qe` |
| **Role** | `quality-engineer` |
| **Tools** | `read`, `write`, `bash` |
| **Timeout** | 15 minutes |

**Purpose:** Write functional and integration tests based on the spec. Never touches implementation files.

**Constraints:**
- Read-only for implementation source files
- Only creates and edits test files
- Covers acceptance criteria, edge cases, and error paths from the spec
- Outputs `{ "testFiles": ["tests/example.test.ts", ...] }` when done

**When it runs:**
- Stage 2 (Implement) — writes functional tests in parallel with dev (auto-approve) or sequentially (interactive)
- Retry loops for functional test gate failures — rewrites tests alongside dev fixes

---

### Planner Agent

| Property | Value |
|---|---|
| **Name** | `planner` |
| **Role** | `planner` |
| **Tools** | `read` |
| **Timeout** | 5 minutes |

**Purpose:** Validate and normalize specs into structured breakdowns. Does not write or modify any code.

**Output format:**

```json
{
  "valid": true,
  "goals": ["Goal 1", "Goal 2"],
  "tasks": ["Task 1", "Task 2"],
  "constraints": ["Constraint 1"],
  "dod": ["Definition of done item 1"]
}
```

**Clarification mode:** When the spec is ambiguous, the planner returns:

```json
{
  "valid": false,
  "needsClarification": true,
  "questions": ["What auth method should be used?", "Should the API be versioned?"]
}
```

The user answers each question interactively, and the planner re-runs with the answers included. Up to 3 rounds of clarification are allowed.

**Assumption mode:** When `--skip-clarification` is used, the planner makes reasonable assumptions and documents them in the constraints array.

---

### Security Reviewer Agent

| Property | Value |
|---|---|
| **Name** | `security-reviewer` |
| **Role** | `security-reviewer` |
| **Tools** | `read`, `bash` |
| **Timeout** | 15 minutes |

**Purpose:** Read-only security scan for OWASP Top 10 vulnerabilities. Does not modify any files.

**Output format:**

```json
{
  "severity": "HIGH",
  "findings": [
    {
      "severity": "HIGH",
      "description": "SQL injection via unsanitized user input",
      "location": { "file": "src/db.ts", "line": 42 }
    }
  ]
}
```

**Severity levels:** `CRITICAL` > `HIGH` > `MEDIUM` > `LOW`

The reygent workflow fails the security gate when any finding is at or above the `--security-threshold` (default: `HIGH`). In interactive mode, the user can choose to continue anyway. In auto-approve mode, the security gate is bypassed with a warning.

---

### PR Reviewer Agent

| Property | Value |
|---|---|
| **Name** | `pr-reviewer` |
| **Role** | `reviewer` |
| **Tools** | `read`, `git`, `gh` |
| **Timeout** | 15 minutes |

**Purpose:** Review PR diffs and produce structured findings. Also used in the PR review stage to analyze the pull request after it's created.

**Output format:**

```json
{
  "summary": "Overall assessment of the PR",
  "comments": [
    { "file": "src/auth.ts", "line": 15, "comment": "Missing null check" }
  ],
  "recommendedActions": ["Add error handling for token refresh"]
}
```

The review is posted as a comment on the PR via `gh pr comment`.

---

### Adhoc Agent

| Property | Value |
|---|---|
| **Name** | `adhoc` |
| **Role** | `general` |
| **Tools** | `read`, `write`, `bash`, `search` |
| **Timeout** | 15 minutes |

**Purpose:** Freeform one-off tasks. Follows instructions precisely without workflow constraints.

**When to use:**
- Quick code changes outside the reygent workflow
- Exploratory tasks
- Anything that doesn't fit the structured workflow model

```bash
reygent agent adhoc "Convert all var declarations to const/let in src/"
```

---

## Execution Modes

### Auto-approve (Parallel)

When `--auto-approve` is set, agents run with pre-approved tool access (`--allowedTools Bash Edit Write Read Glob Grep`). Dev and QE agents run in parallel via `Promise.all()` since neither needs stdin.

### Interactive (Sequential)

Without `--auto-approve`, agents inherit stdin so the user can approve each file edit. Dev runs first, then QE, since both need the terminal.

---

## Customizing Agents

Run `reygent init` to generate `.reygent/config.json`. Edit the agent definitions:

```json
{
  "agents": [
    {
      "name": "dev",
      "description": "Write, edit, and refactor implementation code",
      "systemPrompt": "You are the Dev agent. Your role is to...",
      "tools": ["read", "write", "bash", "search"],
      "role": "developer"
    }
  ]
}
```

**What you can customize:**

| Field | Effect |
|---|---|
| `systemPrompt` | Change the instructions the agent receives |
| `tools` | Restrict or expand available tools |
| `description` | Shown in help text and dry-run output |

**Config resolution:**
1. Look for `.reygent/config.json` starting from `cwd`, searching upward
2. If found, use its agents (falls back to built-ins if `agents` key is missing)
3. If not found, use built-in agent definitions

This means you can have different agent configs per project or share one config at a parent directory level.
