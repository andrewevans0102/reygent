import { describe, it, expect } from 'vitest';
import { TelemetryUserConfigSchema, DEFAULT_TELEMETRY_CONFIG } from './config.js';

describe('TelemetryUserConfigSchema', () => {
  it('validates valid minimal config', () => {
    const config = {
      enabled: true,
      level: 'minimal' as const,
      backend: 'sqlite' as const,
      retention: 7,
    };
    const result = TelemetryUserConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('validates valid standard config', () => {
    const config = {
      enabled: false,
      level: 'standard' as const,
      backend: 'sqlite' as const,
      retention: 30,
    };
    const result = TelemetryUserConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('validates valid verbose config', () => {
    const config = {
      enabled: true,
      level: 'verbose' as const,
      backend: 'sqlite' as const,
      retention: 90,
    };
    const result = TelemetryUserConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('validates config with undefined enabled', () => {
    const config = {
      level: 'standard' as const,
      backend: 'sqlite' as const,
      retention: 30,
    };
    const result = TelemetryUserConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('rejects invalid level', () => {
    const config = {
      enabled: true,
      level: 'invalid',
      backend: 'sqlite' as const,
      retention: 30,
    };
    const result = TelemetryUserConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
    if (!result.success) {
      const levelError = result.error.issues.find((issue) => issue.path.includes('level'));
      expect(levelError).toBeDefined();
      expect(levelError?.code).toBe('invalid_value');
      expect(levelError?.message).toMatch(/minimal|standard|verbose/);
    }
  });

  it('rejects invalid backend', () => {
    const config = {
      enabled: true,
      level: 'standard' as const,
      backend: 'postgres',
      retention: 30,
    };
    const result = TelemetryUserConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
    if (!result.success) {
      const backendError = result.error.issues.find((issue) => issue.path.includes('backend'));
      expect(backendError).toBeDefined();
      expect(backendError?.code).toBe('invalid_value');
      expect(backendError?.message).toMatch(/sqlite/);
    }
  });

  it('rejects zero retention', () => {
    const config = {
      enabled: true,
      level: 'standard' as const,
      backend: 'sqlite' as const,
      retention: 0,
    };
    const result = TelemetryUserConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
    if (!result.success) {
      const retentionError = result.error.issues.find((issue) => issue.path.includes('retention'));
      expect(retentionError).toBeDefined();
      expect(retentionError?.code).toBe('too_small');
      expect(retentionError?.message).toMatch(/>0|positive/);
    }
  });

  it('rejects negative retention', () => {
    const config = {
      enabled: true,
      level: 'standard' as const,
      backend: 'sqlite' as const,
      retention: -1,
    };
    const result = TelemetryUserConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('rejects fractional retention', () => {
    const config = {
      enabled: true,
      level: 'standard' as const,
      backend: 'sqlite' as const,
      retention: 30.5,
    };
    const result = TelemetryUserConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('rejects non-boolean enabled', () => {
    const config = {
      enabled: 'yes',
      level: 'standard' as const,
      backend: 'sqlite' as const,
      retention: 30,
    };
    const result = TelemetryUserConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
    if (!result.success) {
      const enabledError = result.error.issues.find((issue) => issue.path.includes('enabled'));
      expect(enabledError).toBeDefined();
      expect(enabledError?.code).toBe('invalid_type');
      expect(enabledError?.message).toContain('boolean');
    }
  });
});

describe('DEFAULT_TELEMETRY_CONFIG', () => {
  it('has enabled set to undefined', () => {
    expect(DEFAULT_TELEMETRY_CONFIG.enabled).toBeUndefined();
  });

  it('has level set to standard', () => {
    expect(DEFAULT_TELEMETRY_CONFIG.level).toBe('standard');
  });

  it('has backend set to sqlite', () => {
    expect(DEFAULT_TELEMETRY_CONFIG.backend).toBe('sqlite');
  });

  it('has retention set to 30', () => {
    expect(DEFAULT_TELEMETRY_CONFIG.retention).toBe(30);
  });

  it('validates against schema', () => {
    const result = TelemetryUserConfigSchema.safeParse(DEFAULT_TELEMETRY_CONFIG);
    expect(result.success).toBe(true);
  });
});

describe('TelemetryUserConfig tri-state enabled field', () => {
  it('distinguishes undefined from false', () => {
    const withUndefined = {
      level: 'standard' as const,
      backend: 'sqlite' as const,
      retention: 30,
    };
    const withFalse = {
      enabled: false,
      level: 'standard' as const,
      backend: 'sqlite' as const,
      retention: 30,
    };

    const resultUndefined = TelemetryUserConfigSchema.safeParse(withUndefined);
    const resultFalse = TelemetryUserConfigSchema.safeParse(withFalse);

    expect(resultUndefined.success).toBe(true);
    expect(resultFalse.success).toBe(true);
    if (resultUndefined.success && resultFalse.success) {
      expect(resultUndefined.data.enabled).toBeUndefined();
      expect(resultFalse.data.enabled).toBe(false);
      expect(resultUndefined.data.enabled).not.toBe(resultFalse.data.enabled);
    }
  });

  it('allows enabled true', () => {
    const config = {
      enabled: true,
      level: 'standard' as const,
      backend: 'sqlite' as const,
      retention: 30,
    };
    const result = TelemetryUserConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(true);
    }
  });

  it('allows enabled false', () => {
    const config = {
      enabled: false,
      level: 'standard' as const,
      backend: 'sqlite' as const,
      retention: 30,
    };
    const result = TelemetryUserConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(false);
    }
  });

  it('allows enabled undefined', () => {
    const config = {
      level: 'standard' as const,
      backend: 'sqlite' as const,
      retention: 30,
    };
    const result = TelemetryUserConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBeUndefined();
    }
  });
});

describe('TelemetryUserConfig retention edge cases', () => {
  it('accepts retention of 1', () => {
    const config = {
      level: 'minimal' as const,
      backend: 'sqlite' as const,
      retention: 1,
    };
    const result = TelemetryUserConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.retention).toBe(1);
    }
  });

  it('accepts large retention values', () => {
    const config = {
      level: 'standard' as const,
      backend: 'sqlite' as const,
      retention: 9999,
    };
    const result = TelemetryUserConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.retention).toBe(9999);
    }
  });

  it('rejects retention of 0', () => {
    const config = {
      level: 'standard' as const,
      backend: 'sqlite' as const,
      retention: 0,
    };
    const result = TelemetryUserConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('rejects negative retention', () => {
    const config = {
      level: 'standard' as const,
      backend: 'sqlite' as const,
      retention: -30,
    };
    const result = TelemetryUserConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('rejects fractional retention', () => {
    const config = {
      level: 'standard' as const,
      backend: 'sqlite' as const,
      retention: 30.5,
    };
    const result = TelemetryUserConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });
});

describe('TelemetryUserConfig level validation', () => {
  it('accepts all valid levels', () => {
    const levels = ['minimal', 'standard', 'verbose'] as const;
    for (const level of levels) {
      const config = {
        level,
        backend: 'sqlite' as const,
        retention: 30,
      };
      const result = TelemetryUserConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid level string', () => {
    const config = {
      level: 'debug',
      backend: 'sqlite' as const,
      retention: 30,
    };
    const result = TelemetryUserConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('rejects empty level string', () => {
    const config = {
      level: '',
      backend: 'sqlite' as const,
      retention: 30,
    };
    const result = TelemetryUserConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });
});

describe('TelemetryUserConfig backend validation', () => {
  it('accepts sqlite backend', () => {
    const config = {
      level: 'standard' as const,
      backend: 'sqlite' as const,
      retention: 30,
    };
    const result = TelemetryUserConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('rejects postgres backend', () => {
    const config = {
      level: 'standard' as const,
      backend: 'postgres',
      retention: 30,
    };
    const result = TelemetryUserConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('rejects empty backend string', () => {
    const config = {
      level: 'standard' as const,
      backend: '',
      retention: 30,
    };
    const result = TelemetryUserConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });
});

describe('TelemetryUserConfigSchema missing required fields', () => {
  it('rejects config missing level', () => {
    const config = {
      backend: 'sqlite' as const,
      retention: 30,
    };
    const result = TelemetryUserConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('rejects config missing backend', () => {
    const config = {
      level: 'standard' as const,
      retention: 30,
    };
    const result = TelemetryUserConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('rejects config missing retention', () => {
    const config = {
      level: 'standard' as const,
      backend: 'sqlite' as const,
    };
    const result = TelemetryUserConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('rejects empty config', () => {
    const config = {};
    const result = TelemetryUserConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });
});

describe('TelemetryUserConfigSchema extra fields handling', () => {
  it('strips extra fields not in schema', () => {
    const config = {
      enabled: true,
      level: 'standard' as const,
      backend: 'sqlite' as const,
      retention: 30,
      extraField: 'should be stripped',
      anotherExtra: 123,
    };
    const result = TelemetryUserConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect('extraField' in result.data).toBe(false);
      expect('anotherExtra' in result.data).toBe(false);
    }
  });
});

describe('DEFAULT_TELEMETRY_CONFIG immutability', () => {
  it('returns same values after multiple accesses', () => {
    const first = DEFAULT_TELEMETRY_CONFIG;
    const second = DEFAULT_TELEMETRY_CONFIG;
    expect(first.enabled).toBe(second.enabled);
    expect(first.level).toBe(second.level);
    expect(first.backend).toBe(second.backend);
    expect(first.retention).toBe(second.retention);
  });

  it('matches expected default values', () => {
    expect(DEFAULT_TELEMETRY_CONFIG.enabled).toBeUndefined();
    expect(DEFAULT_TELEMETRY_CONFIG.level).toBe('standard');
    expect(DEFAULT_TELEMETRY_CONFIG.backend).toBe('sqlite');
    expect(DEFAULT_TELEMETRY_CONFIG.retention).toBe(30);
  });
});
