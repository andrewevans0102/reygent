---
layout: home

hero:
  name: Reygent
  text: AI-Powered Development Automation
  tagline: Orchestrate multiple Claude agents to automate the software development lifecycle — from spec to shipped PR
  image:
    src: /ReygentLogo.png
    alt: Reygent Logo
  actions:
    - theme: brand
      text: Get Started
      link: /quickstart
    - theme: alt
      text: View on GitHub
      link: https://github.com/andrewevans0102/reygent

features:
  - icon: 🤖
    title: Multi-Agent Orchestration
    details: Specialized agents for planning, implementation, testing, security review, and PR creation working together seamlessly.

  - icon: 📋
    title: Spec-to-PR Automation
    details: Read specs from markdown, Jira, or Linear — then automatically implement, test, and create pull requests.

  - icon: 🔌
    title: Multi-Provider Support
    details: Works with Claude (Anthropic/Vertex AI), Gemini, GPT via Codex, and 200+ models through OpenRouter.

  - icon: 🎯
    title: Quality Gates
    details: Built-in quality checks including tests, security scanning, and automated code review before PR creation.

  - icon: 📊
    title: Local Telemetry with Chesstrace
    details: Track pipeline execution with Chesstrace — a local telemetry engine that captures events and powers analytics. All data stays on your machine.

  - icon: 🧠
    title: Knowledge System
    details: Auto-learning system that captures insights from runs, errors, and successes to improve future executions.
---

## Quick Install

Install globally via npm:

```bash
npm install -g reygent-code
```

Or run directly with npx:

```bash
npx reygent-code
```

## Prerequisites

- **Node.js** 22+
- **AI Provider** — Claude CLI, Gemini CLI, Codex CLI, or OpenRouter API key
- **GitHub CLI** (`gh`) for PR operations
- **Git** configured in your project

See the [Providers Guide](/providers) for detailed setup instructions.

## What is Chesstrace?

<div style="text-align: center; margin: 2em 0;">
  <img src="/ChesstraceLogo.png" alt="Chesstrace Logo" style="max-width: 400px; width: 100%;" />
</div>

**Chesstrace** is Reygent's local telemetry engine that works alongside the main tool. It:

- Captures pipeline execution events
- Stores data locally in SQLite
- Powers `reygent last`, `reygent analyze`, `reygent dashboard`, and `reygent telemetry` commands
- **Keeps all data on your machine** — nothing sent externally

Learn more in the [Chesstrace documentation](/chesstrace) and explore your data with the [Dashboard](/dashboard).

## Example Workflow

```bash
# Run the full workflow from a spec
reygent run --spec ./specs/add-auth.md

# Or start from a Jira issue
reygent run --jira PROJ-123

# Or from a Linear issue
reygent run --linear DT-456

# Review last run telemetry
reygent last

# Analyze recent runs
reygent analyze --since "2 days ago"
```

## License

Released under the [Apache-2.0 License](https://github.com/andrewevans0102/reygent/blob/main/LICENSE).
