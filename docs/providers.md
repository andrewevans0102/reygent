# Providers Guide

Reygent supports multiple AI providers. Each provider implements the same `ProviderAdapter` interface, so agents work identically regardless of which provider is used.

## Available Providers

### Claude (default)

| Property | Value |
|---|---|
| **Type** | CLI-based (`claude` subprocess) |
| **Default model** | `claude-sonnet-4-5-20250929` |
| **Supported models** | Sonnet 4.5, Opus 4.6, Haiku 4.5, Sonnet 4, 3.5 Sonnet, 3.5 Haiku, 3 Opus, custom models |
| **Requires** | `claude` CLI installed and authenticated |

Claude is the default and most full-featured provider. It spawns the Claude CLI as a subprocess with `--output-format stream-json`, giving agents access to the full tool ecosystem (Read, Write, Edit, Bash, Glob, Grep).

```bash
reygent run --spec spec.md                                    # uses Claude by default
reygent run --spec spec.md --model claude-opus-4-6            # use Opus
reygent run --spec spec.md --model claude-haiku-4-5           # use Haiku
```

**Short aliases:** `claude-sonnet-4-5` → `claude-sonnet-4-5-20250929`, `claude-haiku-4-5` → `claude-haiku-4-5-20251001`, `claude-sonnet-4` → `claude-sonnet-4-20250514`, `claude-3-5-sonnet` → `claude-3-5-sonnet-20241022`, `claude-3-5-haiku` → `claude-3-5-haiku-20241022`, `claude-3-opus` → `claude-3-opus-20240229`

#### Claude via Google Vertex AI

Claude models are available on Google Vertex AI Model Garden. To use Claude through Vertex AI:

**Official documentation:**
- [Vertex AI Model Garden - Claude](https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/use-claude)
- [Vertex AI Authentication](https://cloud.google.com/vertex-ai/docs/authentication)

> **Note:** Setup instructions below reflect standard Google Cloud patterns. Always refer to official Google Cloud documentation for the most current and authoritative setup procedures.

**Setup:**

1. Install and authenticate the Google Cloud CLI:
   ```bash
   gcloud auth application-default login
   gcloud config set project YOUR_PROJECT_ID
   ```

2. Enable Vertex AI API and Model Garden access in your GCP project

3. Set Vertex AI environment variables:
   ```bash
   export GOOGLE_CLOUD_PROJECT=your-project-id        # Required: GCP project ID
   export GOOGLE_CLOUD_REGION=us-central1             # Optional: defaults to us-central1
   ```

4. Configure the claude CLI to use Vertex AI:
   ```bash
   claude config set provider vertex
   ```

   **Note:** Some versions of the claude CLI auto-detect Vertex AI from environment variables. If your version does not require explicit provider configuration, skip this step. See the [official Anthropic Claude CLI documentation](https://docs.anthropic.com/en/docs/claude-cli) for your version's requirements.

**Vertex AI-specific values:**

| Environment Variable | Purpose | Required |
|---|---|---|
| `GOOGLE_CLOUD_PROJECT` | GCP project ID | Yes |
| `GOOGLE_CLOUD_REGION` | GCP region (e.g., us-central1, europe-west1) | No (defaults vary by CLI) |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to service account key JSON | No (if using gcloud auth) |

**Standard Claude API values:**

| Environment Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | API key for direct Anthropic API access (not Vertex AI) |

**Why use Claude on Vertex AI:**
- Enterprise SLAs and support through Google Cloud
- VPC networking and private endpoints
- Integration with other GCP services (BigQuery, Cloud Storage, etc.)
- Unified billing with other GCP resources
- Regional data residency requirements
- Use existing GCP credits and committed use discounts

### Gemini

| Property | Value |
|---|---|
| **Type** | CLI-based (`gemini` subprocess) |
| **Default model** | `gemini-2.5-pro` |
| **Supported models** | Gemini 2.5 Pro, Gemini 2.5 Flash, custom models |
| **Requires** | `gemini` CLI installed |

```bash
reygent run --spec spec.md --provider gemini
reygent run --spec spec.md --provider gemini --model gemini-2.5-flash
```

**Workspace trust:** Gemini CLI requires the working directory to be "trusted" before it will run. Reygent sets the `GEMINI_CLI_TRUST_WORKSPACE=true` environment variable automatically when spawning Gemini subprocesses, so no manual trust configuration is needed.

#### Google Vertex AI

Google Vertex AI is a managed service for deploying and scaling Gemini models in Google Cloud. To use Gemini with Vertex AI:

**Official documentation:**
- [Vertex AI Generative AI - Gemini](https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/gemini)
- [Vertex AI Authentication](https://cloud.google.com/vertex-ai/docs/authentication)

> **Note:** Setup instructions below reflect standard Google Cloud patterns. Always refer to official Google Cloud documentation for the most current and authoritative setup procedures.

**Setup:**

1. Install and authenticate the Google Cloud CLI:
   ```bash
   gcloud auth application-default login
   gcloud config set project YOUR_PROJECT_ID
   ```

2. Set Vertex AI environment variables:
   ```bash
   export GOOGLE_CLOUD_PROJECT=your-project-id        # Required: GCP project ID
   export GOOGLE_CLOUD_REGION=us-central1             # Optional: defaults to us-central1
   ```

   Alternatively, use a service account:
   ```bash
   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json
   export GOOGLE_CLOUD_PROJECT=your-project-id
   ```

3. Configure the gemini CLI to use Vertex AI:
   ```bash
   gemini config set provider vertex
   ```

   **Note:** Some versions of the gemini CLI auto-detect Vertex AI from environment variables. If your version does not require explicit provider configuration, skip this step. See the [official Google Gemini CLI documentation](https://ai.google.dev/gemini-api/docs/cli) for your version's requirements.

**Vertex AI-specific values:**

| Environment Variable | Purpose | Required |
|---|---|---|
| `GOOGLE_CLOUD_PROJECT` | GCP project ID | Yes |
| `GOOGLE_CLOUD_REGION` | GCP region (e.g., us-central1, europe-west1) | No (defaults vary by CLI) |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to service account key JSON | No (if using gcloud auth) |

**Standard Gemini API values:**

| Environment Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | API key for standard Gemini API (not Vertex AI) |
| `GEMINI_CLI_TRUST_WORKSPACE` | Auto-set by Reygent to `true` |

Use Vertex AI when you need:
- Enterprise SLAs and support
- VPC networking and private endpoints
- Integration with other GCP services
- Custom model fine-tuning
- Regional data residency requirements

### Codex

| Property | Value |
|---|---|
| **Type** | CLI-based (`codex` subprocess) |
| **Default model** | `gpt-5.4` |
| **Supported models** | gpt-5.4, custom models |
| **Requires** | `codex` CLI installed |

```bash
reygent run --spec spec.md --provider codex
reygent run --spec spec.md --provider codex --model gpt-5.4
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

**Limitation:** OpenRouter is an API provider, so agents **cannot** access the filesystem. Unlike CLI providers (Claude, Gemini, Codex) which spawn local subprocesses with full tool access, API providers send HTTP requests and receive text responses only. Tool calls (Bash, Write, Edit, Read, Glob, Grep) will not work. This provider is best suited for read-only stages like planning and review where agents only need to generate text, not modify files or execute commands.

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

### Custom Models

All providers support custom model names via the interactive config (`reygent config`). When selecting a model, choose "Custom model (enter manually)" to specify any model ID your provider supports. Custom models trigger a warning but are allowed — useful for:

- New models not yet in the predefined list
- Provider-specific model variants (e.g., fine-tuned models)
- Regional model endpoints (e.g., Vertex AI models in specific regions)
- Beta/preview models

Example custom models:
- Claude: `claude-opus-5-0` (when released)
- Gemini: `gemini-exp-1206` (experimental models)
- Vertex AI: `projects/PROJECT_ID/locations/us-central1/publishers/google/models/gemini-2.5-pro`
- Codex: `gpt-6.0` (future models)

OpenRouter accepts any model slug by default (no validation).

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

## Provider Architecture

```
CLI Providers (claude, gemini, codex)
┌──────────────────────────────────────────────────────────────┐
│ Reygent Agent                                                 │
│   ├─ Spawns local subprocess (e.g., `claude --model ...`)    │
│   ├─ Agent has full tool access:                             │
│   │    ├─ Read, Write, Edit (filesystem)                     │
│   │    ├─ Bash (command execution)                           │
│   │    └─ Glob, Grep (search)                                │
│   └─ Stream JSON output parsed in real-time                  │
└──────────────────────────────────────────────────────────────┘

API Providers (openrouter)
┌──────────────────────────────────────────────────────────────┐
│ Reygent Agent                                                 │
│   ├─ Sends HTTP POST to provider API                         │
│   ├─ No local subprocess, no tool access                     │
│   ├─ Agent receives text-only response                       │
│   └─ Best for: planning, review, text generation             │
└──────────────────────────────────────────────────────────────┘
```

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
