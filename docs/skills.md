# Skills

Skills are self-contained agent definitions that follow the [agentskills.io](https://agentskills.io/specification) specification. Each skill lives in its own directory with a `SKILL.md` manifest and is automatically discovered and loaded as an agent by the Reygent CLI.

## How It Works

Skills bridge the agentskills.io standard to Reygent's `AgentConfig` system. The loading pipeline:

1. **Discovery** — On any `reygent agent` or `reygent run` call, the CLI scans `.reygent/skills/` for subdirectories containing a `SKILL.md` file
2. **Parsing** — Each `SKILL.md` is parsed: YAML frontmatter is extracted and validated, the markdown body becomes the agent's system prompt
3. **Conversion** — The `SkillManifest` is mapped to an `AgentConfig` (the same type used by built-in agents like `dev`, `qe`, `planner`)
4. **Merging** — Skill agents are merged into the agent list alongside built-in and config-defined agents
5. **Execution** — Skills are invoked the same way as any other agent: `reygent agent <skill-name>`

All agent-consuming code uses `getAgents()` from `src/config.ts`, so skills appear transparently everywhere — no special handling needed in commands, spawn logic, or the pipeline.

## Directory Structure

```
your-project/
├── .reygent/
│   ├── config.json
│   └── skills/
│       ├── code-reviewer/
│       │   └── SKILL.md
│       └── doc-writer/
│           ├── SKILL.md
│           └── references/
│               └── STYLE-GUIDE.md
```

Each skill directory name must match the `name` field in its `SKILL.md` frontmatter.

## SKILL.md Format

A `SKILL.md` file has two parts: YAML frontmatter and a markdown body.

```markdown
---
name: code-reviewer
description: Reviews code for quality, best practices, and potential issues
license: MIT
metadata:
  role: skill
  author: your-name
allowed-tools: read bash
---

# Code Reviewer

Agent instructions go here. This becomes the systemPrompt.
```

### Required Fields

| Field | Constraints |
|-------|-------------|
| `name` | 1-64 chars. Lowercase letters, numbers, hyphens. No leading/trailing/consecutive hyphens. Must match directory name. |
| `description` | 1-1024 chars. What the skill does and when to use it. |

### Optional Fields

| Field | Constraints |
|-------|-------------|
| `license` | SPDX identifier or reference to bundled LICENSE file |
| `compatibility` | 1-500 chars. Environment requirements (tools, runtime, network) |
| `metadata` | Key-value map of strings. Common keys: `role`, `author`, `version` |
| `allowed-tools` | Space-separated string of tool names (e.g., `read write bash`) |

## Configuration

Skills are configured in `.reygent/config.json` under the `skills` key:

```json
{
  "agents": [...],
  "skills": {
    "path": "skills",
    "disabled": ["test-generator"]
  },
  "model": "claude-sonnet-4-5-20250929"
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `path` | `"skills"` | Directory relative to `.reygent/` where skills are stored |
| `disabled` | `[]` | Skill names to skip during discovery |

## Precedence Rules

When a skill has the same name as a config-defined agent, the config agent wins. A warning is printed:

```
Warning: skill "dev" shadowed by config agent with same name
```

Built-in agents (from `src/agents.ts`) are included via the config's `agents` array, so they also take precedence over skills with the same name.

## Mapping to AgentConfig

Skills are converted to `AgentConfig` objects via `skillToAgentConfig()`:

| SKILL.md Field | AgentConfig Field | Notes |
|----------------|-------------------|-------|
| `name` | `name` | Direct mapping |
| `description` | `description` | Direct mapping |
| markdown body | `systemPrompt` | Full markdown body after frontmatter |
| `allowed-tools` | `tools` | Parsed, lowercased, qualifiers stripped (e.g., `Bash(git:*)` → `bash`) |
| `metadata.role` | `role` | Falls back to `"skill"` if not set |

## Creating a Skill

1. Run `reygent init` (creates `.reygent/skills/` if it doesn't exist)
2. Create a directory: `.reygent/skills/my-skill/`
3. Add `SKILL.md` with valid frontmatter and instructions
4. Run `reygent agent my-skill`

For reusable skills, see the [reygent-skills](https://github.com/andrewevans0102/reygent-skills) repository which contains community skills and a validation utility.

## Internals

Key source files:

| File | Purpose |
|------|---------|
| `src/skills.ts` | `parseSkillMd`, `validateSkillName`, `discoverSkills`, `skillToAgentConfig`, `mapToolNames` |
| `src/config.ts` | `SkillsConfig` type, `findLocalConfigDir`, `resolveSkillsPath`, `getSkillsAsAgents`, merged `getAgents()` |
| `src/commands/init.ts` | Creates `.reygent/skills/` directory during `reygent init` |

The `discoverSkills()` function scans a directory for subdirectories containing `SKILL.md`, parses each one, validates the name matches the directory, and returns an array of `SkillManifest` objects. Invalid skills are silently skipped during discovery.
