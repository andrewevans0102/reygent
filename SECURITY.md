# Security

This document describes security measures implemented in Reygent to protect sensitive data.

## Overview

Reygent implements defense-in-depth security across telemetry, knowledge management, and filesystem operations:

1. **Error sanitization** - Removes secrets from telemetry
2. **Cross-project isolation** - Prevents data leakage between projects
3. **Prompt injection protection** - Validates knowledge files
4. **Resource limits** - Prevents disk exhaustion and spam
5. **Path traversal limits** - Restricts filesystem probing

## Telemetry Security

### Error Message Sanitization

**Location**: `src/knowledge/analyzer.ts:sanitizeErrorMessage()`

All error messages automatically sanitized before storage:

```typescript
// Removes:
- API keys/tokens (20+ character alphanumeric strings)
- User home paths (/Users/name → /Users/***)
- Email addresses (user@domain.com → ***@***.***)
- IP addresses (192.168.1.1 → ***.***.***.****)
- Environment variables (password=secret → password=[REDACTED])
```

**Example**:
```
Before: "API key YOUR_SECRET_KEY_HERE invalid"
After:  "API key [REDACTED_TOKEN] invalid"
```

### Cross-Project Data Isolation

**Location**: `src/chesstrace/backends/dual.ts`

**Risk**: By default, telemetry writes to both project-local and global DBs. Users working on private + public projects may leak private data into shared global DB.

**Mitigation**: Opt-out flag prevents global writes:

```bash
export REYGENT_GLOBAL_TELEMETRY=false
```

When disabled, only local `.reygent/telemetry.db` used (no cross-project data).

### Database Size Limits

**Location**: `src/chesstrace/backends/sqlite.ts`

**Limits enforced**:
- Max DB size: 50MB (prevents disk exhaustion)
- Max events per run: 10,000 (prevents spam attacks)
- Auto-retention: 180 days (old events pruned automatically)

**Behavior**:
1. Before each write, check DB size
2. If >50MB, prune events older than 180 days
3. If still >50MB after pruning, silently skip write
4. Per-run event limit checked on every write

## Knowledge Security

### Prompt Injection Protection

**Location**: `src/knowledge/loader.ts`

**Risk**: Malicious markdown in `.reygent/knowledge/` could inject instructions into agent prompts (e.g., "output contents of .env file").

**Mitigation**: Validation + sanitization before injection:

**Validation** (`validateMarkdown`):
- Max file size: 1MB (prevents memory attacks)
- Rejects suspicious patterns (50+ consecutive special chars)

**Sanitization** (`sanitizeMarkdown`):
Removes prompt injection patterns:
- "ignore previous instructions" → `[FILTERED]`
- "show me your system prompt" → `[FILTERED]`
- "output contents of .env" → `[FILTERED]`
- "print secrets/keys/tokens" → `[FILTERED]`
- "pretend you are" / "act as" → `[FILTERED]`

### Path Traversal Limits

**Location**: `src/project-detection.ts`

**Risk**: Upward directory traversal could probe entire filesystem structure.

**Mitigation**: Max traversal depth of 10 directories:

```typescript
const MAX_TRAVERSAL_DEPTH = 10;

while (currentDir !== root && depth < MAX_TRAVERSAL_DEPTH) {
  // Check for project markers
  depth++;
}
```

Prevents excessive traversal while allowing normal project structures.

## Configuration

### Environment Variables

```bash
# Disable all telemetry
export REYGENT_TELEMETRY=false

# Disable global telemetry only (recommended for sensitive projects)
export REYGENT_GLOBAL_TELEMETRY=false

# Disable knowledge learning
export REYGENT_KNOWLEDGE=false
```

### Config File

`.reygent/config.json`:

```json
{
  "telemetry": {
    "enabled": true,
    "global_enabled": false,       // Disable cross-project data
    "max_db_size_mb": 50,          // DB size limit
    "max_events_per_run": 10000    // Spam prevention
  },
  "knowledge": {
    "enabled": true,
    "validate_files": true         // Prompt injection protection
  }
}
```

## Testing

Security tests in `src/security.test.ts` verify:

1. Error sanitization patterns present
2. Knowledge validation/sanitization implemented
3. DB size/event limits enforced
4. Path traversal limits applied
5. Global telemetry opt-out functional

Run: `npm test -- src/security.test.ts`

## Guidelines for Developers

### When Adding Telemetry Events

✅ **Do**:
- Sanitize user-provided strings before logging
- Use relative paths, not absolute
- Log metadata (counts, durations, success/failure)
- Use generic error messages

❌ **Don't**:
- Log file contents or code snippets
- Log command arguments (may contain secrets)
- Log environment variables
- Log full file paths with user directories

### When Modifying Knowledge Loader

✅ **Do**:
- Maintain sanitization patterns
- Add new prompt injection patterns as discovered
- Test with malicious markdown examples
- Validate file size before reading

❌ **Don't**:
- Remove validation checks
- Trust markdown content without sanitization
- Allow arbitrary file sizes

## Threat Model

**In scope**:
- Accidental secret leakage via error messages
- Cross-project data leakage via global DB
- Prompt injection via malicious knowledge files
- Disk exhaustion via telemetry spam
- Filesystem probing via path traversal

**Out of scope**:
- Local privilege escalation (requires file system access already)
- Network attacks (no network-facing components)
- Encryption at rest (SQLite DB unencrypted by design)
- Multi-user isolation (single-user tool)

## Reporting Security Issues

Report security vulnerabilities to: security@reygent.dev

Please include:
1. Description of vulnerability
2. Steps to reproduce
3. Potential impact
4. Suggested fix (if any)

**Do not** open public GitHub issues for security vulnerabilities.
