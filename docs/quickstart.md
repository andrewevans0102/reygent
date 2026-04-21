# QuickStart Guide

Get from zero to your first AI-driven pull request in minutes.

## Prerequisites

- **Node.js** 18 or later
- **Git** with a configured credential helper
- **Claude CLI** installed and authenticated ([install guide](https://docs.anthropic.com/en/docs/claude-code/overview))
- A **GitHub** or **GitLab** repository with push access

## Installation

```bash
# Clone the repo
git clone https://github.com/andrewevans0102/reygent.git
cd reygent

# Install dependencies
npm install

# Build
npm run build

# Link globally (optional — makes `reygent` available everywhere)
npm link
```

## Initialize Your Project

Navigate to the repo you want reygent to work on and run:

```bash
reygent init
```

This creates a `.reygent/` folder with a `config.json` containing all default agent definitions. You can customize agent prompts, tools, and roles in this file.

## Write a Spec

Create a markdown file describing what you want built:

```markdown
# Add User Avatar Upload

## Overview
Allow users to upload a profile avatar image from the settings page.

## Requirements
- Accept PNG and JPEG files up to 5MB
- Resize to 256x256 on the server
- Store in S3 with a CDN-backed URL
- Display the avatar in the navbar and profile page

## Acceptance Criteria
- Upload form validates file type and size client-side
- Server returns 400 for invalid uploads
- Avatar URL updates immediately after successful upload
```

Save this as `spec.md` (or any `.md` file).

Alternatively, generate a spec from a short description:

```bash
reygent generate-spec "user avatar upload feature"
```

## Run the Reygent Workflow

```bash
reygent run --spec spec.md
```

This kicks off the 7-stage reygent workflow:

1. **Plan** — Planner agent breaks down the spec into goals, tasks, constraints, and definition of done
2. **Implement** — Dev agent writes code + unit tests; QE agent writes functional tests (in parallel when auto-approved)
3. **Unit Test Gate** — Runs unit tests, retries on failure
4. **Functional Test Gate** — Runs functional tests, retries on failure
5. **Security Review** — Scans for OWASP Top 10 vulnerabilities
6. **PR Create** — Creates a branch, commits, pushes, opens a pull request
7. **PR Review** — Reviews the diff and posts a review comment on the PR

You'll be prompted to choose:
- **Auto-approve mode** — agents run without asking permission for each file edit (faster, parallel execution)
- **Clarification preference** — whether the planner should ask you questions or make assumptions

## Using Issue Trackers Instead of Markdown

### Linear

```bash
# Set your API key
echo "LINEAR_API_KEY=lin_api_xxxxx" >> .env

# Pass a Linear URL or issue ID
reygent run --spec https://linear.app/myteam/issue/ENG-123
reygent run --spec ENG-123
```

### Jira

```bash
# Set your Jira credentials
echo "JIRA_URL=https://mycompany.atlassian.net" >> .env
echo "JIRA_EMAIL=you@company.com" >> .env
echo "JIRA_API_TOKEN=your-token" >> .env

# Pass a Jira issue key
reygent run --spec PROJ-456
```

## Quick Options

```bash
# Preview workflow stages without running anything
reygent run --spec spec.md --dry-run

# Skip all prompts — fully autonomous
reygent run --spec spec.md --auto-approve --skip-clarification

# Run a single agent outside the reygent workflow
reygent agent dev "Add input validation to the signup form"

# Create a PR from current branch without the full reygent workflow
reygent pr-create --title "Fix login bug"
```

## Next Steps

- [Commands Reference](./commands.md) — all commands and their options
- [Agents Guide](./agents.md) — how each agent works and how to customize them
- [Reygent Workflow](./workflows.md) — visual diagrams of the reygent workflow and retry logic
- [Architecture](./architecture.md) — deep technical walkthrough of how it all works under the hood
