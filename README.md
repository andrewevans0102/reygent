# Reygent

![Reygent Logo](/README_IMAGES/ReygentLogo.png)

An AI-powered CLI that orchestrates multiple Claude agents to automate the software development lifecycle — from spec to shipped PR.

Reygent reads a spec (markdown file, Jira issue, or Linear issue), then runs the reygent workflow — a sequence of specialized agents that plan the work, implement code, write tests, run quality gates, perform a security review, create a pull request, and review the PR.

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

### Run globally from source (without publishing to NPM)

Clone the repo, build, and use `npm link` to symlink the package globally:

```bash
git clone https://github.com/your-org/reygent.git
cd reygent
npm install
npm run build
npm link
```

Now `reygent` is available as a command anywhere on your machine. To remove it later:

```bash
npm unlink -g reygent
```

## Quick Start

See the full **[Quickstart Guide](./QUICKSTART.md)** to go from zero to your first AI-driven PR.

```bash
reygent init                                               # initialize local config
reygent generate-spec "Add login endpoint" --output spec.md # generate a spec
reygent run --spec spec.md                                 # run the full workflow
```

## Commands

| Command | Description |
|---|---|
| [`reygent init`](./docs/commands.md#reygent-init) | Initialize `.reygent/` config in current project |
| [`reygent generate-spec`](./docs/commands.md#reygent-generate-spec) | Generate a markdown spec from a short description |
| [`reygent spec`](./docs/commands.md#reygent-spec-source) | Load and display a parsed spec |
| [`reygent agent`](./docs/commands.md#reygent-agent-name) | Start an interactive agent session |
| [`reygent run`](./docs/commands.md#reygent-run) | Run the full 7-stage workflow |
| [`reygent review-work`](./docs/commands.md#reygent-review-work) | Review current branch and post to PR/MR |
| [`reygent review-comments`](./docs/commands.md#reygent-review-comments) | Fetch PR comments and address with dev agent |
| [`reygent config`](./docs/commands.md#reygent-config) | Configure provider, model, and per-agent overrides |
| [`reygent skills`](./docs/commands.md#reygent-skills) | Manage skills from the registry |

See the **[Commands Reference](./docs/commands.md)** for full options and examples.

### Global Flags

These flags apply to all commands:

| Flag | Description |
|---|---|
| `--model <id>` | Override the AI model (e.g., `claude-opus-4-6`) |
| `--provider <name>` | AI provider: `claude`, `gemini`, `codex`, `openrouter` |
| `--debug` | Show full stack traces on errors |

## Reygent Workflow

The reygent workflow is an implementation of the **agent harness pattern** — a structured framework for orchestrating AI agents through complex, multi-stage tasks. See [Harness Pattern](./docs/harness-pattern.md) for details.

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
[3] Gate: Unit Tests ──── Dev agent runs unit tests (workflow halts if tests fail)
 |
 v
[4] Gate: Func Tests ──── QE agent runs functional tests (workflow halts if tests fail)
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

## Agents

| Agent | Role | What it does |
|---|---|---|
| `planner` | Planner | Validates the spec and breaks it into goals, tasks, constraints, and definition of done |
| `dev` | Developer | Implements code based on the plan |
| `qe` | Quality Engineer | Writes functional tests (does not modify source code) |
| `security-reviewer` | Security Reviewer | Scans for OWASP Top 10 vulnerabilities |
| `pr-reviewer` | Reviewer | Creates PRs and performs code review |
| `adhoc` | General | Runs one-off tasks with full tool access |

See the **[Agents Guide](./docs/agents.md)** for details on customization, output formats, and execution modes.

## Providers

Reygent supports multiple AI providers. The default is Claude (via the `claude` CLI).

| Provider | Type | Default Model | Requires |
|---|---|---|---|
| `claude` | CLI | Claude Sonnet 4.5 | `claude` CLI installed |
| `gemini` | CLI | Gemini 2.5 Pro | `gemini` CLI installed |
| `codex` | CLI | o4-mini | `codex` CLI installed |
| `openrouter` | API | Claude Sonnet 4.5 | `OPENROUTER_API_KEY` env var |

```bash
reygent run --spec spec.md --provider gemini
reygent run --spec spec.md --provider openrouter --model anthropic/claude-sonnet-4-5
```

See the **[Providers Guide](./docs/providers.md)** for setup and configuration.

## Spec Sources

Reygent accepts specs from three sources (auto-detected):

| Source | Example |
|---|---|
| Markdown file | `reygent run --spec ./specs/feature.md` |
| Jira issue | `reygent run --spec PROJ-123` |
| Linear issue | `reygent run --spec ENG-456` or `reygent run --spec https://linear.app/...` |

Requires corresponding API keys in `.env` for tracker sources. See [Commands Reference](./docs/commands.md#environment-variables).

## Configuration

**Global (default):** Reygent uses built-in agents defined in the package.

**Local (per-project):** Run `reygent init` to create `.reygent/config.json`:

```json
{
  "agents": [
    {
      "name": "dev",
      "description": "Write, edit, and refactor implementation code",
      "systemPrompt": "You are the Dev agent...",
      "tools": ["read", "write", "bash", "search"],
      "role": "developer"
    }
  ],
  "skills": {
    "path": "skills"  // Agents can access custom skills from this directory
  },
  "model": "claude-sonnet-4-5-20250929"
}
```

Reygent searches upward from the current directory to find `.reygent/`, so you can run commands from any subdirectory.

## Telemetry

Reygent includes opt-in telemetry to help improve the tool. On first run, you'll be prompted to enable or disable telemetry. Your choice is stored in `.reygent/config.json`.

**Configuration:**

```json
{
  "telemetry": {
    "enabled": true,
    "level": "standard",
    "backend": "sqlite",
    "retention": 30
  }
}
```

**Telemetry Levels:**

| Level | What's captured | When to use |
|---|---|---|
| `minimal` | Only critical events (errors, warnings) | CI environments, production deployments, or when bandwidth/storage is limited |
| `standard` | Normal usage events including commands, success/failure outcomes | Interactive development and typical debugging workflows (default) |
| `verbose` | Detailed diagnostic events including timing, internal state transitions, API calls | Troubleshooting specific issues or developing Reygent itself |

**Fields:**

- `enabled` — `true` (opted in), `false` (opted out), or `undefined` (prompts on first run)
- `level` — Capture level: `minimal`, `standard`, or `verbose`
- `backend` — Storage backend (currently only `sqlite` supported)
- `retention` — Number of days to retain telemetry data (must be positive integer)

**Privacy:** Telemetry data is stored locally in `.reygent/` and never transmitted to external servers. You can disable telemetry at any time by setting `enabled: false` in your config.

## Documentation

| Document | Description |
|---|---|
| [Quickstart](./QUICKSTART.md) | Zero to first PR guide |
| [Commands Reference](./docs/commands.md) | Every command, flag, and option |
| [Agents Guide](./docs/agents.md) | Agent specs, customization, output formats |
| [Providers Guide](./docs/providers.md) | Multi-provider setup and configuration |
| [Skills Guide](./docs/skills.md) | Extend reygent with custom skills |
| [Workflows](./docs/workflows.md) | Visual diagrams of pipeline and retry logic |
| [Architecture](./docs/architecture.md) | Technical deep-dive into internals |
| [Harness Pattern](./docs/harness-pattern.md) | How reygent implements Anthropic's harness pattern |
| [Verify Pricing](./docs/verify-pricing.md) | Claude Code skill for verifying provider token pricing |

## Development

```bash
git clone https://github.com/your-org/reygent.git
cd reygent
npm install
npm run build    # Compile to dist/
npm run dev      # Watch mode
npm test         # Run tests
```

## Disclaimer

This software is provided "as is", without warranty of any kind. See the [MIT License](./LICENSE) for full terms.

**AI-generated output:** Reygent orchestrates AI agents that produce code, tests, and reviews. All AI-generated output should be reviewed by a human before merging or deploying. The authors are not responsible for any damages resulting from the use of this tool or its output.
