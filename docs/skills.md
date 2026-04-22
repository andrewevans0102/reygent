# Skills

Skills are self-contained agent definitions that follow the [agentskills.io](https://agentskills.io/specification) specification. Each skill lives in its own directory with a `SKILL.md` manifest and is automatically discovered and loaded as an agent by the Reygent CLI.

## How It Works

Skills bridge the agentskills.io standard to Reygent's `AgentConfig` system. The loading pipeline:

1. **Discovery** — On any `reygent agent` or `reygent run` call, the CLI scans both local `.reygent/skills/` and global `~/.reygent/skills/` for subdirectories containing a `SKILL.md` file
2. **Parsing** — Each `SKILL.md` is parsed: YAML frontmatter is extracted and validated, the markdown body becomes the agent's system prompt
3. **Conversion** — The `SkillManifest` is mapped to an `AgentConfig` (the same type used by built-in agents like `dev`, `qe`, `planner`)
4. **Merging** — Skill agents are merged into the agent list alongside built-in and config-defined agents
5. **Execution** — Skills are invoked the same way as any other agent: `reygent agent <skill-name>`

All agent-consuming code uses `getAgents()` from `src/config.ts`, so skills appear transparently everywhere — no special handling needed in commands, spawn logic, or the pipeline.

## Directory Structure

Skills can be installed in two locations:

**Local** (project-specific) — discovered first, takes precedence:

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

**Global** (shared across all projects):

```
~/.reygent/
└── skills/
    └── code-reviewer/
        └── SKILL.md
```

Each skill directory name must match the `name` field in its `SKILL.md` frontmatter. If the same skill name exists in both local and global, the local version is used.

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
| `allowed-tools` | Space-separated string of tool names (e.g., `read write bash`). Reygent also accepts a YAML array (e.g., `[read, bash]`) as a convenience extension. |

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

Skills are resolved in this order (first match wins):

1. **Config-defined agents** — agents in `.reygent/config.json` `agents` array (includes built-ins)
2. **Local skills** — `.reygent/skills/` in the project
3. **Global skills** — `~/.reygent/skills/`

When a skill has the same name as a config-defined agent, the config agent wins. A warning is printed:

```
Warning: skill "dev" shadowed by config agent with same name
```

The `disabled` list in config applies to skills from both local and global scopes.

## Skills Registry

Community skills are published in the [andrewevans0102/reygent-skills](https://github.com/andrewevans0102/reygent-skills) GitHub repository. The `reygent skills` commands let you browse, install, and remove skills from this registry without manually copying files.

### `reygent skills list`

Browse all available skills in the registry:

```bash
reygent skills list
```

Output shows each skill's name, description, version, and license. Skills already installed locally or globally show an `[installed]` badge.

### `reygent skills add <name>`

Install a skill from the registry:

```bash
# Install to local .reygent/skills/ (default)
reygent skills add code-reviewer

# Install to global ~/.reygent/skills/
reygent skills add code-reviewer --global
```

What happens:
1. Validates the skill name
2. Checks the target directory doesn't already contain the skill
3. Fetches the skill's `SKILL.md` and checks compatibility with your reygent version
4. Downloads all skill files (including subdirectories like `references/`)
5. Writes files to the target skills directory

If no local `.reygent/` directory exists and `--global` is not set, you'll be prompted to run `reygent init` first.

### `reygent skills remove <name>`

Remove an installed skill:

```bash
# Remove from local .reygent/skills/
reygent skills remove code-reviewer

# Remove from global ~/.reygent/skills/
reygent skills remove code-reviewer --global
```

### Authentication

The registry uses the GitHub API, which has a rate limit of 60 requests/hour for unauthenticated access. If you hit rate limits, set a GitHub token:

```bash
export GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

This raises the limit to 5,000 requests/hour. The token only needs public repo read access.

### Compatibility

Skills can declare a minimum reygent version in their `SKILL.md` frontmatter:

```yaml
compatibility: ">=0.2.0"
```

If your reygent version is lower, `reygent skills add` prints a warning but still installs the skill.

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

### From the registry

```bash
reygent skills list                    # browse available skills
reygent skills add code-reviewer       # install to local project
reygent agent code-reviewer            # use it
```

### Manually

1. Run `reygent init` (creates `.reygent/skills/` if it doesn't exist)
2. Create a directory: `.reygent/skills/my-skill/`
3. Add `SKILL.md` with valid frontmatter and instructions
4. Run `reygent agent my-skill`

For publishing reusable skills, see the [reygent-skills](https://github.com/andrewevans0102/reygent-skills) repository.

## Internals

Key source files:

| File | Purpose |
|------|---------|
| `src/skills.ts` | `parseSkillMd`, `validateSkillName`, `discoverSkills`, `skillToAgentConfig`, `mapToolNames` |
| `src/config.ts` | `SkillsConfig` type, `findLocalConfigDir`, `resolveGlobalConfigDir`, `resolveSkillsDir`, `getSkillsAsAgents`, merged `getAgents()` |
| `src/registry.ts` | `listRemoteSkills`, `fetchSkillManifest`, `fetchSkillFiles`, `checkCompatibility` — GitHub registry client |
| `src/commands/skills.ts` | `registerSkillsCommand` — `reygent skills list\|add\|remove` command handlers |
| `src/commands/init.ts` | Creates `.reygent/skills/` directory during `reygent init` |

The `discoverSkills()` function scans a directory for subdirectories containing `SKILL.md`, parses each one, validates the name matches the directory, and returns an array of `SkillManifest` objects. Invalid skills are silently skipped during discovery. `getSkillsAsAgents()` runs discovery on both local and global skills directories, with local taking precedence on name conflicts.
