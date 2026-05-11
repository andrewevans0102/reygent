import { describe, it, expect } from 'vitest';
import {
  TelemetryLevel,
  TelemetryCategory,
  TelemetryEvent,
  Events,
  EVENT_LEVELS,
  categoryFromEvent,
} from './events';

describe('TelemetryLevel', () => {
  it('has correct enum values', () => {
    expect(TelemetryLevel.minimal).toBe(0);
    expect(TelemetryLevel.standard).toBe(1);
    expect(TelemetryLevel.verbose).toBe(2);
  });
});

describe('Events constants', () => {
  it('defines command events', () => {
    expect(Events.COMMAND_START).toBe('command.start');
    expect(Events.COMMAND_END).toBe('command.end');
    expect(Events.COMMAND_ERROR).toBe('command.error');
  });

  it('defines agent events', () => {
    expect(Events.AGENT_START).toBe('agent.start');
    expect(Events.AGENT_END).toBe('agent.end');
    expect(Events.AGENT_ERROR).toBe('agent.error');
    expect(Events.AGENT_TOOL_CALL).toBe('agent.tool_call');
  });

  it('defines LLM events', () => {
    expect(Events.LLM_REQUEST).toBe('llm.request');
    expect(Events.LLM_RESPONSE).toBe('llm.response');
    expect(Events.LLM_TOKEN_USAGE).toBe('llm.token_usage');
    expect(Events.LLM_ERROR).toBe('llm.error');
  });

  it('defines git events', () => {
    expect(Events.GIT_BRANCH_CREATE).toBe('git.branch_create');
    expect(Events.GIT_COMMIT).toBe('git.commit');
    expect(Events.GIT_PUSH).toBe('git.push');
    expect(Events.GIT_ERROR).toBe('git.error');
  });

  it('defines spec events', () => {
    expect(Events.SPEC_FETCH).toBe('spec.fetch');
    expect(Events.SPEC_PARSE).toBe('spec.parse');
    expect(Events.SPEC_ERROR).toBe('spec.error');
  });

  it('defines error events', () => {
    expect(Events.ERROR_UNHANDLED).toBe('error.unhandled');
    expect(Events.ERROR_VALIDATION).toBe('error.validation');
  });

  it('defines performance events', () => {
    expect(Events.PERF_METRIC).toBe('performance.metric');
    expect(Events.PERF_DURATION).toBe('performance.duration');
  });

  it('defines tool events', () => {
    expect(Events.TOOL_INVOKE).toBe('tool.invoke');
    expect(Events.TOOL_INVOKE_FULL).toBe('tool.invoke.full');
    expect(Events.TOOL_SUMMARY).toBe('tool.summary');
  });
});

describe('EVENT_LEVELS', () => {
  it('assigns minimal level to command events', () => {
    expect(EVENT_LEVELS[Events.COMMAND_START]).toBe(TelemetryLevel.minimal);
    expect(EVENT_LEVELS[Events.COMMAND_END]).toBe(TelemetryLevel.minimal);
    expect(EVENT_LEVELS[Events.COMMAND_ERROR]).toBe(TelemetryLevel.minimal);
  });

  it('assigns standard level to agent events', () => {
    expect(EVENT_LEVELS[Events.AGENT_START]).toBe(TelemetryLevel.standard);
    expect(EVENT_LEVELS[Events.AGENT_END]).toBe(TelemetryLevel.standard);
    expect(EVENT_LEVELS[Events.AGENT_ERROR]).toBe(TelemetryLevel.standard);
    expect(EVENT_LEVELS[Events.AGENT_TOOL_CALL]).toBe(TelemetryLevel.standard);
  });

  it('assigns verbose level to LLM events', () => {
    expect(EVENT_LEVELS[Events.LLM_REQUEST]).toBe(TelemetryLevel.verbose);
    expect(EVENT_LEVELS[Events.LLM_RESPONSE]).toBe(TelemetryLevel.verbose);
    expect(EVENT_LEVELS[Events.LLM_TOKEN_USAGE]).toBe(TelemetryLevel.verbose);
    expect(EVENT_LEVELS[Events.LLM_ERROR]).toBe(TelemetryLevel.verbose);
  });

  it('assigns standard level to git events', () => {
    expect(EVENT_LEVELS[Events.GIT_BRANCH_CREATE]).toBe(TelemetryLevel.standard);
    expect(EVENT_LEVELS[Events.GIT_COMMIT]).toBe(TelemetryLevel.standard);
    expect(EVENT_LEVELS[Events.GIT_PUSH]).toBe(TelemetryLevel.standard);
    expect(EVENT_LEVELS[Events.GIT_ERROR]).toBe(TelemetryLevel.standard);
  });

  it('assigns standard level to spec events', () => {
    expect(EVENT_LEVELS[Events.SPEC_FETCH]).toBe(TelemetryLevel.standard);
    expect(EVENT_LEVELS[Events.SPEC_PARSE]).toBe(TelemetryLevel.standard);
    expect(EVENT_LEVELS[Events.SPEC_ERROR]).toBe(TelemetryLevel.standard);
  });

  it('assigns minimal level to error events', () => {
    expect(EVENT_LEVELS[Events.ERROR_UNHANDLED]).toBe(TelemetryLevel.minimal);
    expect(EVENT_LEVELS[Events.ERROR_VALIDATION]).toBe(TelemetryLevel.minimal);
  });

  it('assigns verbose level to performance events', () => {
    expect(EVENT_LEVELS[Events.PERF_METRIC]).toBe(TelemetryLevel.verbose);
    expect(EVENT_LEVELS[Events.PERF_DURATION]).toBe(TelemetryLevel.verbose);
  });

  it('assigns correct levels to tool events', () => {
    expect(EVENT_LEVELS[Events.TOOL_INVOKE]).toBe(TelemetryLevel.standard);
    expect(EVENT_LEVELS[Events.TOOL_INVOKE_FULL]).toBe(TelemetryLevel.verbose);
    expect(EVENT_LEVELS[Events.TOOL_SUMMARY]).toBe(TelemetryLevel.minimal);
  });

  it('covers all event constants', () => {
    const eventValues = Object.values(Events);
    const levelKeys = Object.keys(EVENT_LEVELS);

    expect(levelKeys.length).toBe(eventValues.length);
    eventValues.forEach((event) => {
      expect(EVENT_LEVELS).toHaveProperty(event);
    });
  });
});

describe('categoryFromEvent', () => {
  it('extracts command category', () => {
    expect(categoryFromEvent('command.start')).toBe('command');
  });

  it('extracts agent category', () => {
    expect(categoryFromEvent('agent.start')).toBe('agent');
  });

  it('extracts llm category', () => {
    expect(categoryFromEvent('llm.request')).toBe('llm');
  });

  it('extracts git category', () => {
    expect(categoryFromEvent('git.branch_create')).toBe('git');
  });

  it('extracts spec category', () => {
    expect(categoryFromEvent('spec.fetch')).toBe('spec');
  });

  it('extracts error category', () => {
    expect(categoryFromEvent('error.unhandled')).toBe('error');
  });

  it('extracts performance category', () => {
    expect(categoryFromEvent('performance.metric')).toBe('performance');
  });

  it('extracts tool category', () => {
    expect(categoryFromEvent('tool.invoke')).toBe('tool');
  });

  it('throws on invalid category', () => {
    expect(() => categoryFromEvent('invalid.event')).toThrow('Invalid event category: invalid');
  });

  it('throws on malformed event name', () => {
    expect(() => categoryFromEvent('noDotHere')).toThrow('Invalid event category: noDotHere');
  });
});

describe('TelemetryEvent interface', () => {
  it('accepts valid event structure', () => {
    const event: TelemetryEvent = {
      id: 'evt_123',
      runId: 'run_456',
      timestamp: Date.now(),
      category: 'command',
      event: Events.COMMAND_START,
      minLevel: TelemetryLevel.minimal,
      data: { command: 'run', args: [] },
    };

    expect(event.id).toBe('evt_123');
    expect(event.runId).toBe('run_456');
    expect(event.category).toBe('command');
    expect(event.event).toBe('command.start');
    expect(event.minLevel).toBe(TelemetryLevel.minimal);
    expect(event.data).toEqual({ command: 'run', args: [] });
  });

  it('accepts empty data object', () => {
    const event: TelemetryEvent = {
      id: 'evt_789',
      runId: 'run_012',
      timestamp: Date.now(),
      category: 'git',
      event: Events.GIT_COMMIT,
      minLevel: TelemetryLevel.standard,
      data: {},
    };

    expect(event.data).toEqual({});
  });

  it('accepts nested data objects', () => {
    const event: TelemetryEvent = {
      id: 'evt_nested',
      runId: 'run_nested',
      timestamp: Date.now(),
      category: 'agent',
      event: Events.AGENT_TOOL_CALL,
      minLevel: TelemetryLevel.standard,
      data: {
        tool: 'read',
        args: { file: 'test.ts' },
        metadata: { duration: 120 },
      },
    };

    expect(event.data.tool).toBe('read');
    expect(event.data.args).toEqual({ file: 'test.ts' });
    expect(event.data.metadata).toEqual({ duration: 120 });
  });

  it('accepts arrays in data', () => {
    const event: TelemetryEvent = {
      id: 'evt_array',
      runId: 'run_array',
      timestamp: Date.now(),
      category: 'llm',
      event: Events.LLM_RESPONSE,
      minLevel: TelemetryLevel.verbose,
      data: {
        messages: ['msg1', 'msg2'],
        tokens: [10, 20, 30],
      },
    };

    expect(Array.isArray(event.data.messages)).toBe(true);
    expect(event.data.messages).toHaveLength(2);
    expect(Array.isArray(event.data.tokens)).toBe(true);
    expect(event.data.tokens).toHaveLength(3);
  });
});

describe('Type exports', () => {
  it('TelemetryCategory is a valid type', () => {
    const categories: TelemetryCategory[] = [
      'command',
      'agent',
      'llm',
      'git',
      'spec',
      'error',
      'performance',
      'tool',
    ];

    categories.forEach((cat) => {
      const typed: TelemetryCategory = cat;
      expect(typed).toBe(cat);
    });
  });

  it('TelemetryEvent type enforces required fields', () => {
    const event: TelemetryEvent = {
      id: 'test',
      runId: 'test-run',
      timestamp: Date.now(),
      category: 'agent',
      event: 'agent.start',
      minLevel: TelemetryLevel.standard,
      data: {},
    };

    expect(event).toHaveProperty('id');
    expect(event).toHaveProperty('runId');
    expect(event).toHaveProperty('timestamp');
    expect(event).toHaveProperty('category');
    expect(event).toHaveProperty('event');
    expect(event).toHaveProperty('minLevel');
    expect(event).toHaveProperty('data');
  });
});

describe('Edge cases and validation', () => {
  it('categoryFromEvent handles all Events constants', () => {
    Object.values(Events).forEach((eventName) => {
      expect(() => categoryFromEvent(eventName)).not.toThrow();
    });
  });

  it('EVENT_LEVELS has no extra keys', () => {
    const eventValues = Object.values(Events);
    const levelKeys = Object.keys(EVENT_LEVELS);

    levelKeys.forEach((key) => {
      expect(eventValues).toContain(key);
    });
  });

  it('EVENT_LEVELS has no missing keys', () => {
    const eventValues = Object.values(Events);

    eventValues.forEach((event) => {
      expect(EVENT_LEVELS).toHaveProperty(event);
      expect([0, 1, 2]).toContain(EVENT_LEVELS[event]);
    });
  });

  it('all event names follow dot notation', () => {
    Object.values(Events).forEach((eventName) => {
      // Allow single or multi-level event names (e.g., "tool.invoke" or "tool.invoke.full")
      expect(eventName).toMatch(/^[a-z]+\.[a-z_]+(\.[a-z_]+)?$/);
    });
  });

  it('TelemetryLevel values are sequential', () => {
    expect(TelemetryLevel.minimal).toBe(0);
    expect(TelemetryLevel.standard).toBe(TelemetryLevel.minimal + 1);
    expect(TelemetryLevel.verbose).toBe(TelemetryLevel.standard + 1);
  });
});
