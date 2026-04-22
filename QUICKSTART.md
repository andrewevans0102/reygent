# Quickstart

Get from zero to your first AI-driven pull request in minutes.

## 1. Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Claude CLI](https://docs.anthropic.com/en/docs/claude-code/overview) installed and authenticated
- [GitHub CLI](https://cli.github.com/) (`gh`) installed and authenticated
- Git configured with push access to your repo

## 2. Install

```bash
git clone https://github.com/<your-org>/reygent.git
cd reygent
npm install
npm run build
npm link
```

Verify it works:

```bash
reygent --version
```

## 3. Configure API Keys (Optional)

Only needed if you want to pull specs from an issue tracker instead of a markdown file.

Create a `.env` file in your target project root:

```bash
# Linear
LINEAR_API_KEY=lin_api_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Jira
JIRA_URL=https://your-company.atlassian.net
JIRA_EMAIL=you@company.com
JIRA_API_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxx
```

## 4. Initialize Your Project

Navigate to the repo you want reygent to work on:

```bash
cd /path/to/your-project
reygent init
```

This creates `.reygent/config.json` with default agent definitions. You can skip this step — reygent falls back to built-in agents.

## 5. Write a Spec

Create a `spec.md` file describing what you want built:

```markdown
# Add health-check endpoint

## Requirements
- GET /health returns 200 with JSON body { "status": "ok" }
- Responds in under 50ms
- No authentication required

## Acceptance Criteria
- Endpoint is reachable at /health
- Returns correct JSON response
- Unit test covers success case
```

Or generate one from a description:

```bash
reygent generate-spec "Add a health-check endpoint" --output spec.md
```

Or point directly at a Linear or Jira issue:

```bash
reygent run --spec ENG-123
reygent run --spec https://linear.app/your-team/issue/ENG-123/your-issue
```

Issue keys (e.g. `ENG-123`) are resolved based on which credentials are configured in `.env`. If both Linear and Jira are configured, Linear is tried first.

## 6. Run the Workflow

```bash
reygent run --spec spec.md
```

Reygent runs 7 stages automatically:

```
Plan → Implement → Unit Tests → Functional Tests → Security Review → PR Create → PR Review
```

You'll be prompted to choose:
- **Auto-approve mode** — agents run without asking permission for each file edit (faster, runs dev + QE in parallel)
- **Clarification preference** — whether the planner asks you questions or makes assumptions

### Fully autonomous mode

```bash
reygent run --spec spec.md --auto-approve --skip-clarification
```

### Preview without executing

```bash
reygent run --spec spec.md --dry-run
```

## 7. Customize Config

Edit `.reygent/config.json` to change agent behavior:

```json
{
  "agents": [
    {
      "name": "dev",
      "description": "Write, edit, and refactor implementation code",
      "systemPrompt": "You are the Dev agent. Follow our team's coding standards...",
      "tools": ["read", "write", "bash", "search"],
      "role": "developer"
    }
  ],
  "model": "claude-sonnet-4-5-20250929"
}
```

You can also override the model per-run:

```bash
reygent run --spec spec.md --model claude-opus-4-6
```

## Useful Commands

| Command | Description |
|---|---|
| `reygent init` | Initialize `.reygent/` config in current project |
| `reygent generate-spec "..."` | Generate spec from description |
| `reygent spec spec.md` | Load and display a parsed spec |
| `reygent agent dev --spec spec.md` | Run a single agent in isolation |
| `reygent chat dev` | Interactive chat with an agent |
| `reygent run --spec spec.md` | Run full 7-stage workflow |
| `reygent pr-create` | Create a PR from current branch |

## Next Steps

- [README](./README.md) — full documentation, all options, agent details
- [Commands Reference](./docs/commands.md) — every command and flag
- [Agents Guide](./docs/agents.md) — how agents work and how to customize them
- [Workflows](./docs/workflows.md) — visual diagrams of the workflow and retry logic
- [Skills](./docs/skills.md) — extend reygent with custom skills
- [Architecture](./docs/architecture.md) — technical deep-dive
