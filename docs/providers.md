# Providers Guide

Reygent supports multiple AI providers. Each provider implements the same `ProviderAdapter` interface, so agents work identically regardless of which provider is used.

## Available Providers

### Claude (default)

| Property | Value |
|---|---|
| **Type** | CLI-based (`claude` subprocess) |
| **Default model** | `claude-sonnet-4-5-20250929` |
| **Supported models** | Sonnet 4.5, Opus 4.6, Haiku 4.5 |
| **Requires** | `claude` CLI installed and authenticated |

Claude is the default and most full-featured provider. It spawns the Claude CLI as a subprocess with `--output-format stream-json`, giving agents access to the full tool ecosystem (Read, Write, Edit, Bash, Glob, Grep).

```bash
reygent run --spec spec.md                                    # uses Claude by default
reygent run --spec spec.md --model claude-opus-4-6            # use Opus
reygent run --spec spec.md --model claude-haiku-4-5           # use Haiku
```

**Short aliases:** `claude-sonnet-4-5` → `claude-sonnet-4-5-20250929`, `claude-haiku-4-5` → `claude-haiku-4-5-20251001`

### Gemini

| Property | Value |
|---|---|
| **Type** | CLI-based (`gemini` subprocess) |
| **Default model** | `gemini-2.5-pro` |
| **Supported models** | Gemini 2.5 Pro, Gemini 2.5 Flash |
| **Requires** | `gemini` CLI installed |

```bash
reygent run --spec spec.md --provider gemini
reygent run --spec spec.md --provider gemini --model gemini-2.5-flash
```

### Codex

| Property | Value |
|---|---|
| **Type** | CLI-based (`codex` subprocess) |
| **Default model** | `o4-mini` |
| **Supported models** | o4-mini, o3 |
| **Requires** | `codex` CLI installed |

```bash
reygent run --spec spec.md --provider codex
reygent run --spec spec.md --provider codex --model o3
```

### OpenRouter

| Property | Value |
|---|---|
| **Type** | API-based (HTTP requests) |
| **Default model** | `anthropic/claude-sonnet-4-5` |
| **Supported models** | Any model slug available on OpenRouter |
| **Requires** | `OPENROUTER_API_KEY` environment variable |

OpenRouter is a pass-through API provider that supports 200+ models. No model validation is performed — any model slug is accepted.

```bash
export OPENROUTER_API_KEY=sk-or-v1-xxxxxxxx
reygent run --spec spec.md --provider openrouter
reygent run --spec spec.md --provider openrouter --model google/gemini-2.5-pro
```

**Limitation:** OpenRouter is an API provider, so agents **cannot** access the filesystem. Tool calls (Bash, Write, Edit) will not work. This provider is best suited for read-only stages like planning and review.

## Provider Resolution

The provider is resolved in this order:

1. `--provider` CLI flag
2. `provider` field in `.reygent/config.json`
3. Default: `claude`

## Model Resolution

The model is resolved in this order:

1. `--model` CLI flag
2. `model` field in `.reygent/config.json`
3. Provider's default model

Short aliases are expanded before validation. For example, `claude-sonnet-4-5` is expanded to `claude-sonnet-4-5-20250929`.

Model validation is performed against the provider's supported models list, except for OpenRouter which accepts any model slug.

## Per-Project Configuration

Set the provider and model in `.reygent/config.json`:

```json
{
  "agents": [...],
  "model": "claude-sonnet-4-5-20250929",
  "provider": "claude"
}
```

## Provider Interface

All providers implement the `ProviderAdapter` interface:

| Method | Purpose |
|---|---|
| `isAvailable()` | Check if the provider's CLI/API is available |
| `spawn(options)` | Run an agent non-interactively (returns stdout + exit code) |
| `spawnInteractive(systemPrompt, model)` | Start an interactive agent session |

The `type` field indicates how the provider works:
- **`cli`** — Spawns a CLI subprocess (Claude, Gemini, Codex)
- **`api`** — Makes HTTP API requests (OpenRouter)

## Internals

| File | Purpose |
|---|---|
| `src/providers/types.ts` | `ProviderAdapter` interface, `ProviderName` type, `SpawnAdapterOptions` |
| `src/providers/index.ts` | Provider factory (`getProvider`), `PROVIDER_NAMES` export |
| `src/providers/claude.ts` | Claude CLI adapter with stream-json parsing |
| `src/providers/gemini.ts` | Gemini CLI adapter |
| `src/providers/codex.ts` | Codex CLI adapter |
| `src/providers/openrouter.ts` | OpenRouter HTTP API adapter |
| `src/model.ts` | Model validation, alias resolution, provider-aware defaults |
| `src/spawn.ts` | High-level `spawnAgentStream` that delegates to the resolved provider |
