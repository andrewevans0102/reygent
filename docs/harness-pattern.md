# Reygent as an Agent Harness

How the reygent workflow implements the "harness" pattern for orchestrating long-running AI agents, as described in Anthropic's engineering article [Effective Harnesses for Long-Running Agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents).

## What is a Harness?

A harness is a structured framework that enables AI agents to make consistent progress on complex tasks. Rather than relying on a single agent session to complete everything at once, a harness decomposes work into discrete stages, manages state between them, and ensures each agent has the context it needs to contribute effectively.

Key properties of a harness:

- **Structured input** prevents agents from misunderstanding scope or declaring premature completion
- **Specialized agents** handle distinct phases of work instead of one agent doing everything
- **State threading** passes artifacts and context between stages
- **Progress tracking** makes work observable and recoverable
- **Incremental execution** keeps each agent focused on a bounded task

## How Reygent Implements the Harness Pattern

### Specialized Agent Roles (Two-Agent Architecture → Multi-Agent Pipeline)

The Anthropic article describes a two-agent architecture: an **initializer** that sets up the environment and a **coding agent** that implements features incrementally.

Reygent extends this into a seven-stage pipeline with six specialized agent roles:

| Harness Concept | Reygent Implementation |
|---|---|
| Initializer agent | **Planner** — validates the spec, decomposes work into goals/tasks/constraints/definition-of-done |
| Coding agent | **Dev** — implements code and unit tests based on the plan |
| (no direct equivalent) | **QE** — writes functional/integration tests in parallel with dev |
| Verification testing | **Unit Test Gate** + **Functional Test Gate** — automated pass/fail checks with retry |
| (no direct equivalent) | **Security Reviewer** — OWASP Top 10 scan before PR creation |
| (no direct equivalent) | **PR Reviewer** — creates PR, reviews diff, posts structured comments |

Each agent is a `claude` CLI subprocess with a focused system prompt and bounded scope, preventing the context exhaustion that comes from one agent trying to do everything.

### Structured Input (Feature List → Spec + Plan)

The article emphasizes a detailed feature manifest — a JSON list of 200+ features with verification procedures — to prevent agents from declaring work "done" prematurely.

Reygent achieves this through two layers:

1. **Spec input** — a structured task description loaded from markdown files, Jira issues, or Linear issues. This is the equivalent of the feature manifest entry.
2. **Planner output** — the planner agent decomposes the spec into explicit goals, tasks, constraints, and a definition of done. This structured plan feeds into all downstream agents as their work contract.

The planner also runs a **clarification loop** (up to 3 attempts) if the spec is ambiguous, ensuring agents never start implementation with unclear requirements.

### State Threading (Progress Files → TaskContext)

The article uses progress files and git commits to maintain continuity across sessions.

Reygent uses a `TaskContext` object that threads through the entire pipeline:

```
Spec → Plan → Implementation → Gate Results → Security Findings → PR → Review
```

Each stage reads from previous stages and writes its own output. The `results` array provides an append-only log of every stage's outcome. This is analogous to progress files — each agent knows exactly what happened before it and what it needs to do next.

### Incremental, Bounded Execution (One Feature at a Time)

The article's core insight: agents work best when focused on one feature per session rather than attempting everything at once.

Reygent enforces this structurally:

- Each pipeline run processes **one spec** (one issue, one feature)
- Each agent handles **one stage** with a clear entry/exit contract
- Test gates provide **explicit checkpoints** — work doesn't proceed until verification passes
- On gate failure, agents **retry with failure context** (test output, attempt count) rather than starting from scratch

### Retry with Context (Session Continuity)

The article describes agents reading git logs and progress files to orient themselves at the start of each session.

Reygent's retry mechanism mirrors this: when a test gate fails, the framework re-invokes the relevant agent with a `FailureContext` that includes:

- Which gate failed
- Truncated test output (first 4000 + last 4000 chars)
- Current attempt number and max attempts

This gives the agent targeted context about what went wrong, similar to how the article's agents read progress files to understand current state.

## Comparison Summary

```
┌─────────────────────────┬──────────────────────────────────────────┐
│  Harness Pattern        │  Reygent Workflow                        │
├─────────────────────────┼──────────────────────────────────────────┤
│  Initializer agent      │  Planner stage with clarification loop   │
│  Coding agent           │  Dev + QE agents (parallel execution)    │
│  Feature manifest       │  Spec + structured planner output        │
│  Progress files         │  TaskContext state threading              │
│  Git commits            │  PR creation stage with commit history   │
│  One feature/session    │  One spec per pipeline run               │
│  Verification testing   │  Unit + functional test gates            │
│  Session orientation    │  Failure context injection on retry      │
└─────────────────────────┴──────────────────────────────────────────┘
```

## Further Reading

- [Effective Harnesses for Long-Running Agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) — the Anthropic engineering article that describes the harness pattern
- [Architecture](./architecture.md) — deep technical walkthrough of reygent internals
- [Workflows](./workflows.md) — visual diagrams of the pipeline stages
- [Agents](./agents.md) — detailed agent specifications and customization
