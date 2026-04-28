# Commands Reference

All available CLI commands with options, arguments, and usage examples.

---

## Global Flags

These flags apply to all commands:

| Flag | Default | Description |
|---|---|---|
| `--model <id>` | Provider default | Override the AI model (e.g., `claude-opus-4-6`, `gemini-2.5-pro`) |
| `--provider <name>` | `claude` | AI provider: `claude`, `gemini`, `codex`, `openrouter` |
| `--debug` | `false` | Show full stack traces on errors |

```bash
# Use a different model
reygent run --spec spec.md --model claude-opus-4-6

# Use a different provider
reygent agent dev --provider gemini

# Debug mode for troubleshooting
reygent run --spec spec.md --debug
```

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
reygent generate-spec [description] [--output <file>] [--skip-clarification]
```

| Argument/Option | Description |
|---|---|
| `description` | Short description of the feature (prompted interactively if omitted) |
| `--output <file>` | File path to write the spec to (prompted interactively if omitted) |
| `--skip-clarification` | Skip clarifying questions and generate spec directly |

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

## `reygent agent [name]`

Start an interactive agent session. Spawns the Claude CLI with the agent's system prompt injected.

```bash
reygent agent [name] [--spec <source>]
```

| Argument/Option | Description |
|---|---|
| `name` | Agent name: `dev`, `qe`, `planner`, `security-reviewer`, `pr-reviewer`, `adhoc` (prompted interactively if omitted) |
| `--spec <source>` | Path to `.md` file, issue key, or Linear URL — appended to the agent's system prompt |

**Examples:**

```bash
# Pick agent interactively
reygent agent

# Start interactive session with dev agent
reygent agent dev

# Interactive session with spec context
reygent agent qe --spec ./feature-spec.md

# Use a skill from the registry
reygent agent code-reviewer
```

---

## `reygent run`

Run the full reygent workflow from spec to reviewed PR.

```bash
reygent run --spec <source> [options]
```

| Option | Default | Description |
|---|---|---|
| `--spec <source>` | **(required)** | Path to `.md` file, issue key, or Linear URL |
| `--dry-run` | `false` | Print workflow stages as a tree diagram without executing |
| `--security-threshold <level>` | `HIGH` | Minimum severity to fail security review (`CRITICAL`, `HIGH`, `MEDIUM`, `LOW`) |
| `--auto-approve` | `false` | Auto-approve all file edits and actions without prompting |
| `--insecure` | `false` | Skip SSL certificate verification for API calls |
| `--skip-clarification` | `false` | Skip planner clarification questions; make assumptions instead |
| `--max-retries <count>` | `2` | Maximum retry attempts when gate tests fail |
| `--verbose` | `false` | Show detailed token/cost breakdown per agent |

**Examples:**

```bash
# Full reygent workflow with interactive prompts
reygent run --spec feature.md

# Fully autonomous — no prompts at all
reygent run --spec ENG-123 --auto-approve --skip-clarification

# Preview what workflow stages would run
reygent run --spec feature.md --dry-run

# Strict security — fail on any finding
reygent run --spec feature.md --security-threshold LOW

# More retries for flaky tests
reygent run --spec feature.md --max-retries 5

# Corporate network with self-signed certs
reygent run --spec feature.md --insecure
```

### Reygent Workflow Stages

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

## `reygent review-work`

Review the current branch's changes and optionally post the review to an open PR or MR.

```bash
reygent review-work [--spec <source>] [--insecure]
```

| Option | Description |
|---|---|
| `--spec <source>` | Optional spec to review the diff against (provides context for the review) |
| `--insecure` | Skip SSL certificate verification for GitLab API calls |

**What it does:**

1. Detects the current branch and git platform (GitHub or GitLab)
2. Checks for an open PR/MR on the current branch
3. Gets the diff between the current branch and the default branch
4. Runs the `pr-reviewer` agent to review the diff
5. If a PR/MR exists, posts the review as a comment

**Examples:**

```bash
# Review current branch
reygent review-work

# Review with spec context
reygent review-work --spec feature-spec.md

# Review on GitLab with self-signed certs
reygent review-work --insecure
```

**Platform behavior:**

- **GitHub:** Uses `gh pr view` to detect PRs and `gh pr comment` to post reviews
- **GitLab:** Uses the GitLab API to detect MRs and post review notes
- **No PR/MR found:** Review is printed to the console only

---

## `reygent review-comments`

Fetch review comments from an open PR/MR and run the dev agent to address them.

```bash
reygent review-comments [--insecure] [--auto-approve]
```

| Option | Description |
|---|---|
| `--insecure` | Skip SSL certificate verification for GitLab API calls |
| `--auto-approve` | Skip plan approval prompt and execute immediately |

**What it does:**

1. Detects the current branch and git platform
2. Finds the open PR/MR and fetches all review comments
3. Displays a summary of the comments
4. Runs the planner agent to create a plan addressing the comments
5. Presents the plan for approval (unless `--auto-approve`)
6. Runs the dev agent to implement the fixes
7. Commits and pushes the changes

**Examples:**

```bash
# Address review comments interactively
reygent review-comments

# Fully autonomous — no approval prompt
reygent review-comments --auto-approve

# GitLab with self-signed certs
reygent review-comments --insecure
```

**Approval loop:** When not using `--auto-approve`, you can:
- **Approve** — execute the plan
- **Provide feedback** — regenerate the plan with your notes
- **Reject** — exit without changes

---

## `reygent skills`

Manage skills from the [reygent-skills](https://github.com/andrewevans0102/reygent-skills) registry.

### `reygent skills list`

List all available skills in the registry.

```bash
reygent skills list
```

Shows each skill's name, description, version, and license. Already-installed skills display an `[installed]` badge. Checks both local `.reygent/skills/` and global `~/.reygent/skills/`.

### `reygent skills add <name>`

Install a skill from the registry.

```bash
reygent skills add <name> [--global]
```

| Argument/Option | Description |
|---|---|
| `name` | Skill name to install (e.g., `code-reviewer`) |
| `--global` | Install to `~/.reygent/skills/` instead of local `.reygent/skills/` |

**Examples:**

```bash
# Install to local project
reygent skills add code-reviewer

# Install globally (available to all projects)
reygent skills add code-reviewer --global
```

Checks compatibility with your reygent version before installing. Warns (but still installs) if the skill requires a newer version.

Requires a local `.reygent/` directory for local installs. Run `reygent init` first, or use `--global`.

### `reygent skills remove <name>`

Remove an installed skill.

```bash
reygent skills remove <name> [--global]
```

| Argument/Option | Description |
|---|---|
| `name` | Skill name to remove |
| `--global` | Remove from `~/.reygent/skills/` instead of local |

**Examples:**

```bash
reygent skills remove code-reviewer
reygent skills remove code-reviewer --global
```

---

## Environment Variables

Set these in a `.env` file in your project root (or export in your shell).

| Variable | Used For |
|---|---|
| `LINEAR_API_KEY` | Linear issue tracker integration |
| `JIRA_URL` | Jira instance URL (e.g., `https://company.atlassian.net`) |
| `JIRA_EMAIL` | Jira account email |
| `JIRA_API_TOKEN` | Jira API token |
| `GITHUB_TOKEN` | GitHub API authentication for `reygent skills` commands (raises rate limit from 60 to 5,000 req/hr) |
| `GIT_SSL_NO_VERIFY` | Skip SSL verification globally |
| `NODE_TLS_REJECT_UNAUTHORIZED` | Node.js TLS override (set to `0` to skip) |
