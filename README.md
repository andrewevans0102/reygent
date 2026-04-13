# Reygent

An AI-powered CLI that orchestrates multiple Claude agents to automate the software development lifecycle — from spec to shipped PR.

Reygent reads a spec (markdown file, Jira issue, or Linear issue), then runs a pipeline of specialized agents that plan the work, implement code, write tests, run quality gates, perform a security review, create a pull request, and review the PR.

## Prerequisites

- **Node.js** 18+
- **Claude CLI** (`claude`) installed and authenticated
- **GitHub CLI** (`gh`) installed and authenticated (for PR operations)
- **Git** configured in your project

## Install

```bash
npm install -g reygent
```

Or run directly with npx:

```bash
npx reygent
```

## Quick Start

### 1. Initialize agents in your project

```bash
cd your-project
reygent init
```

This scaffolds `.claude/agents/` with config files for each built-in agent (dev, qe, planner, security-reviewer, pr-reviewer, adhoc).

### 2. Generate a spec (or write one manually)

Generate a spec from a short description:

```bash
reygent generate-spec "Add rate-limited login endpoint" --output spec.md
```

Or create a markdown file by hand:

```markdown
# Add rate-limited login endpoint

## Requirements
- POST /api/login accepts email and password
- Passwords hashed with bcrypt
- Sessions expire after 24 hours
- Rate-limit to 5 attempts per minute per IP

## Acceptance Criteria
- Auth middleware created
- Login endpoint implements rate limiting
- Tests cover success and failure paths
```

### 3. Run the full pipeline

```bash
reygent run --spec spec.md
```

Reygent will:
1. **Plan** — Validate the spec and break it into goals, tasks, and constraints
2. **Implement** — Run dev and QE agents in parallel (code + tests)
3. **Gate: Unit Tests** — Run unit tests; fail the pipeline if they don't pass
4. **Gate: Functional Tests** — Run functional tests written by the QE agent
5. **Security Review** — Scan for vulnerabilities (OWASP Top 10)
6. **Create PR** — Branch, commit, push, and open a pull request
7. **Review PR** — Review the diff and output comments and recommended actions

### 4. Preview without executing

```bash
reygent run --spec spec.md --dry-run
```

Prints the pipeline stages as JSON without running anything.

## Commands

### `reygent init`

Scaffold `.claude/agents/` in the current project with default agent configs.

### `reygent generate-spec <description> [--output <file>]`

Generate a full markdown spec from a short description using the Planner agent. Defaults to writing `spec.md` in the current directory.

```bash
reygent generate-spec "Add a REST API for user authentication"
reygent generate-spec "Dark mode support" --output dark-mode-spec.md
```

### `reygent spec <source>`

Load and display a parsed spec. Useful for verifying that a spec source resolves correctly.

```bash
# From a markdown file
reygent spec spec.md

# From a Jira issue
reygent spec PROJ-123

# From a Linear issue
reygent spec ENG-456
reygent spec https://linear.app/team/issue/ENG-456
```

### `reygent agent <name> --spec <source>`

Run a single agent in isolation. Helpful for debugging or testing one stage at a time.

```bash
reygent agent planner --spec spec.md
reygent agent dev --spec PROJ-123
reygent agent security-reviewer --spec spec.md
```

Available agents: `dev`, `qe`, `planner`, `security-reviewer`, `pr-reviewer`, `adhoc`.

### `reygent run --spec <source> [options]`

Run the full orchestration pipeline.

| Option | Default | Description |
|---|---|---|
| `--spec <source>` | *(required)* | Markdown file path, Jira key, or Linear issue |
| `--dry-run` | `false` | Print pipeline stages without executing |
| `--security-threshold <level>` | `HIGH` | Minimum severity to fail: `CRITICAL`, `HIGH`, `MEDIUM`, `LOW` |

```bash
# Run with a lower security threshold
reygent run --spec spec.md --security-threshold CRITICAL

# Dry run to inspect the pipeline
reygent run --spec ENG-456 --dry-run
```

## Pipeline

The pipeline runs seven stages sequentially. Gates halt the pipeline on failure.

```
spec
 |
 v
[1] Plan ──────────────── Planner agent validates spec, outputs goals/tasks/constraints
 |
 v
[2] Implement ─────────── Dev + QE agents run in parallel (code and tests)
 |
 v
[3] Gate: Unit Tests ──── Dev agent runs unit tests (pipeline fails if tests fail)
 |
 v
[4] Gate: Func Tests ──── QE agent runs functional tests (pipeline fails if tests fail)
 |
 v
[5] Security Review ───── Security agent scans for vulnerabilities
 |
 v
[6] PR Create ─────────── Creates branch, commits, pushes, opens PR via gh
 |
 v
[7] PR Review ─────────── Reviews the PR diff and outputs comments
```

## Spec Sources

Reygent accepts specs from three sources:

### Markdown files

Any `.md` or `.markdown` file:

```bash
reygent run --spec ./specs/feature.md
```

### Jira issues

Pass a Jira issue key. Requires `JIRA_MCP_URL` in your `.env`:

```bash
reygent run --spec PROJ-123
```

### Linear issues

Pass a Linear issue identifier or full URL. Requires `LINEAR_MCP_URL` in your `.env`:

```bash
reygent run --spec ENG-456
reygent run --spec https://linear.app/team/issue/ENG-456
```

## Configuration

### Environment variables

Create a `.env` file in your project root:

```bash
# Linear integration (optional)
LINEAR_MCP_URL=https://your-linear-mcp-server/sse

# Jira integration (optional)
JIRA_MCP_URL=https://your-jira-mcp-server/sse

# GitHub authentication (required for PR operations)
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
```

### Agent configs

After running `reygent init`, agent configs live in `.claude/agents/<name>/agent.json`. Each config has:

```json
{
  "name": "dev",
  "description": "Write, edit, and refactor implementation code",
  "systemPrompt": "You are the Dev agent...",
  "tools": ["read", "write", "bash", "search"],
  "role": "developer"
}
```

You can customize system prompts and tool access to fit your project's conventions.

## Agents

| Agent | Role | What it does |
|---|---|---|
| `planner` | Planner | Validates the spec and breaks it into goals, tasks, constraints, and definition of done |
| `dev` | Developer | Implements code based on the plan |
| `qe` | Quality Engineer | Writes functional tests (does not modify source code) |
| `security-reviewer` | Security Reviewer | Scans for OWASP Top 10 vulnerabilities |
| `pr-reviewer` | Reviewer | Creates PRs and performs code review |
| `adhoc` | General | Runs one-off tasks with full tool access |

## Development

```bash
git clone https://github.com/your-org/reygent.git
cd reygent
npm install
npm run build    # Compile to dist/
npm run dev      # Watch mode
```
