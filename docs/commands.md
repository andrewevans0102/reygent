# Commands Reference

All available CLI commands with options, arguments, and usage examples.

---

## `reygent init`

Initialize a `.reygent/` config folder in your project.

```bash
reygent init
```

**What it does:**
- Creates `.reygent/config.json` with all built-in agent definitions
- Warns if `.reygent/` already exists
- Skips creation if `config.json` already exists

**When to use:** First time setting up reygent on a project so you can customize agent prompts and tools.

---

## `reygent generate-spec`

Generate a full markdown spec from a short description.

```bash
reygent generate-spec [description] [--output <file>]
```

| Argument/Option | Description |
|---|---|
| `description` | Short description of the feature (prompted interactively if omitted) |
| `--output <file>` | File path to write the spec to (prompted interactively if omitted) |

**Example:**

```bash
reygent generate-spec "Add dark mode toggle to settings" --output dark-mode-spec.md
```

The planner agent generates a structured spec with Title, Overview, Requirements, Acceptance Criteria, and Constraints sections.

---

## `reygent spec <source>`

Load and display a parsed spec from any supported source.

```bash
reygent spec <source> [--clarify]
```

| Argument/Option | Description |
|---|---|
| `source` | Path to `.md` file, issue key (`PROJ-123`), or Linear URL |
| `--clarify` | Run the planner with an interactive clarification loop |

**Examples:**

```bash
# Load from markdown
reygent spec ./feature-spec.md

# Load from Jira
reygent spec PROJ-123

# Load from Linear
reygent spec https://linear.app/team/issue/ENG-456

# Load and run planner clarification
reygent spec ENG-456 --clarify
```

Without `--clarify`, outputs the raw spec as JSON. With `--clarify`, runs the planner agent and displays a structured plan with goals, tasks, constraints, and definition of done.

---

## `reygent agent <name> [prompt]`

Run a single agent in isolation, outside the pipeline.

```bash
reygent agent <name> [prompt] [--spec <source>] [--auto-approve]
```

| Argument/Option | Description |
|---|---|
| `name` | Agent name: `dev`, `qe`, `planner`, `security-reviewer`, `pr-reviewer`, `adhoc` |
| `prompt` | Freeform prompt for the agent (alternative to `--spec`) |
| `--spec <source>` | Path to `.md` file, issue key, or Linear URL |
| `--auto-approve` | Auto-approve file edits without prompting |

**Examples:**

```bash
# Run dev agent with a freeform prompt
reygent agent dev "Refactor the auth middleware to use async/await"

# Run QE agent against a spec
reygent agent qe --spec ./feature-spec.md

# Run security reviewer with auto-approve
reygent agent security-reviewer --spec PROJ-123 --auto-approve

# Run adhoc agent for a one-off task
reygent agent adhoc "Update all console.log statements to use the logger utility"
```

---

## `reygent run`

Run the full 7-stage pipeline from spec to reviewed PR.

```bash
reygent run --spec <source> [options]
```

| Option | Default | Description |
|---|---|---|
| `--spec <source>` | **(required)** | Path to `.md` file, issue key, or Linear URL |
| `--dry-run` | `false` | Print pipeline stages as a tree diagram without executing |
| `--security-threshold <level>` | `HIGH` | Minimum severity to fail security review (`CRITICAL`, `HIGH`, `MEDIUM`, `LOW`) |
| `--auto-approve` | `false` | Auto-approve all file edits and actions without prompting |
| `--insecure` | `false` | Skip SSL certificate verification for API calls |
| `--skip-clarification` | `false` | Skip planner clarification questions; make assumptions instead |
| `--max-retries <count>` | `2` | Maximum retry attempts when gate tests fail |

**Examples:**

```bash
# Full pipeline with interactive prompts
reygent run --spec feature.md

# Fully autonomous — no prompts at all
reygent run --spec ENG-123 --auto-approve --skip-clarification

# Preview what stages would run
reygent run --spec feature.md --dry-run

# Strict security — fail on any finding
reygent run --spec feature.md --security-threshold LOW

# More retries for flaky tests
reygent run --spec feature.md --max-retries 5

# Corporate network with self-signed certs
reygent run --spec feature.md --insecure
```

### Pipeline Stages

| # | Stage | Agent(s) | What happens |
|---|---|---|---|
| 1 | Plan | `planner` | Breaks spec into goals, tasks, constraints, definition of done |
| 2 | Implement | `dev` + `qe` | Dev writes code + unit tests; QE writes functional tests |
| 3 | Unit Test Gate | `dev` | Runs unit tests; retries dev agent on failure |
| 4 | Functional Test Gate | `qe` | Runs functional tests; retries dev + qe agents on failure |
| 5 | Security Review | `security-reviewer` | Scans for OWASP Top 10 vulnerabilities |
| 6 | PR Create | `pr-reviewer` | Creates branch, commits, pushes, opens PR |
| 7 | PR Review | `pr-reviewer` | Reviews diff, posts review comment on PR |

### Interactive Prompts

When running without `--auto-approve`, you'll be prompted for:
1. **Auto-approve mode** — whether to let agents edit files freely
2. **Clarification preference** — whether the planner should ask questions or make assumptions
3. **Retry decisions** — when a test gate fails, whether to retry
4. **Security bypass** — when the security review fails, whether to continue

---

## `reygent pr-create`

Create a pull request from the current branch, independent of the full pipeline.

```bash
reygent pr-create [options]
```

| Option | Default | Description |
|---|---|---|
| `--title <title>` | Spec title or last commit message | PR title |
| `--body <body>` | Auto-generated from spec | PR body/description |
| `--spec <source>` | *(optional)* | Path to `.md` file, issue key, or Linear URL |
| `--base <branch>` | Auto-detected (`origin/HEAD`) | Base branch for the PR |
| `--push` / `--no-push` | `--push` | Whether to push the branch before creating PR |
| `--insecure` | `false` | Skip SSL certificate verification |

**Examples:**

```bash
# Simple PR from current branch
reygent pr-create --title "Fix login timeout"

# PR with a spec for auto-generated body
reygent pr-create --spec feature.md

# PR against a specific base branch
reygent pr-create --title "Hotfix" --base release/2.0

# Already pushed — just create the PR
reygent pr-create --title "Feature X" --no-push
```

**Supports:** GitHub (including Enterprise), GitLab. Auth resolved via `git credential fill`.

---

## Environment Variables

Set these in a `.env` file in your project root.

| Variable | Used For |
|---|---|
| `LINEAR_API_KEY` | Linear issue tracker integration |
| `JIRA_URL` | Jira instance URL (e.g., `https://company.atlassian.net`) |
| `JIRA_EMAIL` | Jira account email |
| `JIRA_API_TOKEN` | Jira API token |
| `GIT_SSL_NO_VERIFY` | Skip SSL verification globally |
| `NODE_TLS_REJECT_UNAUTHORIZED` | Node.js TLS override (set to `0` to skip) |
