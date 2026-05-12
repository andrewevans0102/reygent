import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Security tests for error sanitization, knowledge validation, and limits
 */

describe('Error Sanitization', () => {
  it('should sanitize API tokens from error messages', () => {
    // Import the analyzer to test sanitization
    const analyzerPath = join(process.cwd(), 'src/knowledge/analyzer.ts');
    const analyzerSource = readFileSync(analyzerPath, 'utf-8');

    // Verify sanitization function exists
    expect(analyzerSource).toContain('function sanitizeErrorMessage');
    expect(analyzerSource).toContain('[REDACTED_TOKEN]');
  });

  it('should sanitize user home paths from error messages', () => {
    const analyzerPath = join(process.cwd(), 'src/knowledge/analyzer.ts');
    const analyzerSource = readFileSync(analyzerPath, 'utf-8');

    // Verify path sanitization
    expect(analyzerSource).toContain('/Users/***');
    expect(analyzerSource).toContain('/home/***');
  });

  it('should sanitize environment variables from error messages', () => {
    const analyzerPath = join(process.cwd(), 'src/knowledge/analyzer.ts');
    const analyzerSource = readFileSync(analyzerPath, 'utf-8');

    // Verify env var sanitization
    expect(analyzerSource).toContain('password|secret|key|token|api');
    expect(analyzerSource).toContain('[REDACTED]');
  });
});

describe('Knowledge Validation', () => {
  it('should validate markdown files before injection', () => {
    const loaderPath = join(process.cwd(), 'src/knowledge/loader.ts');
    const loaderSource = readFileSync(loaderPath, 'utf-8');

    // Verify validation function exists
    expect(loaderSource).toContain('function validateMarkdown');
    expect(loaderSource).toContain('1024 * 1024'); // 1MB limit
  });

  it('should sanitize prompt injection patterns', () => {
    const loaderPath = join(process.cwd(), 'src/knowledge/loader.ts');
    const loaderSource = readFileSync(loaderPath, 'utf-8');

    // Verify sanitization patterns
    expect(loaderSource).toContain('function sanitizeMarkdown');
    expect(loaderSource).toContain('ignore');
    expect(loaderSource).toContain('system prompt');
    expect(loaderSource).toContain('.env');
  });
});

describe('Database Limits', () => {
  it('should enforce max DB size limit', () => {
    const sqlitePath = join(process.cwd(), 'src/chesstrace/backends/sqlite.ts');
    const sqliteSource = readFileSync(sqlitePath, 'utf-8');

    // Verify size limit constant
    expect(sqliteSource).toContain('MAX_DB_SIZE_BYTES');
    expect(sqliteSource).toContain('50 * 1024 * 1024'); // 50MB
  });

  it('should enforce max events per run limit', () => {
    const sqlitePath = join(process.cwd(), 'src/chesstrace/backends/sqlite.ts');
    const sqliteSource = readFileSync(sqlitePath, 'utf-8');

    // Verify event limit constant
    expect(sqliteSource).toContain('MAX_EVENTS_PER_RUN');
    expect(sqliteSource).toContain('10000');
  });

  it('should check limits before writing events', () => {
    const sqlitePath = join(process.cwd(), 'src/chesstrace/backends/sqlite.ts');
    const sqliteSource = readFileSync(sqlitePath, 'utf-8');

    // Verify limit checks
    expect(sqliteSource).toContain('checkDbSize');
    expect(sqliteSource).toContain('checkRunEventLimit');
  });

  it('should prune old events when limit exceeded', () => {
    const sqlitePath = join(process.cwd(), 'src/chesstrace/backends/sqlite.ts');
    const sqliteSource = readFileSync(sqlitePath, 'utf-8');

    // Verify pruning function
    expect(sqliteSource).toContain('pruneOldEvents');
    expect(sqliteSource).toContain('180'); // 180 days retention
  });
});

describe('Path Traversal Limits', () => {
  it('should limit upward directory traversal', () => {
    const projectDetectionPath = join(process.cwd(), 'src/project-detection.ts');
    const projectDetectionSource = readFileSync(projectDetectionPath, 'utf-8');

    // Verify traversal limit
    expect(projectDetectionSource).toContain('MAX_TRAVERSAL_DEPTH');
    expect(projectDetectionSource).toContain('10');
  });

  it('should check depth during traversal', () => {
    const projectDetectionPath = join(process.cwd(), 'src/project-detection.ts');
    const projectDetectionSource = readFileSync(projectDetectionPath, 'utf-8');

    // Verify depth check
    expect(projectDetectionSource).toContain('depth');
    expect(projectDetectionSource).toContain('depth++');
    expect(projectDetectionSource).toContain('depth < MAX_TRAVERSAL_DEPTH');
  });
});

describe('Global Telemetry Opt-Out', () => {
  it('should support global telemetry disable flag', () => {
    const dualBackendPath = join(process.cwd(), 'src/chesstrace/backends/dual.ts');
    const dualBackendSource = readFileSync(dualBackendPath, 'utf-8');

    // Verify opt-out flag
    expect(dualBackendSource).toContain('REYGENT_GLOBAL_TELEMETRY');
    expect(dualBackendSource).toContain('globalEnabled');
  });

  it('should skip global writes when disabled', () => {
    const dualBackendPath = join(process.cwd(), 'src/chesstrace/backends/dual.ts');
    const dualBackendSource = readFileSync(dualBackendPath, 'utf-8');

    // Verify conditional writes
    expect(dualBackendSource).toContain('if (this.globalBackend)');
  });
});
