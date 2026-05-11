/**
 * Telemetry level enumeration
 */
export enum TelemetryLevel {
  minimal = 0,
  standard = 1,
  verbose = 2,
}

/**
 * Telemetry event categories
 */
export type TelemetryCategory =
  | 'command'
  | 'agent'
  | 'llm'
  | 'git'
  | 'spec'
  | 'error'
  | 'performance'
  | 'pipeline'
  | 'usage';
  | 'gate';

/**
 * Core telemetry event interface
 */
export interface TelemetryEvent {
  id: string;
  runId: string;
  timestamp: number;
  category: TelemetryCategory;
  event: string;
  minLevel: TelemetryLevel;
  data: Record<string, unknown>;
}

/**
 * Event name constants
 */
export const Events = {
  // Command events (minimal level)
  COMMAND_START: 'command.start',
  COMMAND_END: 'command.end',
  COMMAND_ERROR: 'command.error',

  // Agent events (standard level)
  AGENT_START: 'agent.start',
  AGENT_END: 'agent.end',
  AGENT_ERROR: 'agent.error',
  AGENT_TOOL_CALL: 'agent.tool_call',
  /** Emitted when agent spawn begins - { agent, provider, model, stage? } */
  AGENT_SPAWN: 'agent.spawn',
  /** Emitted when agent spawn completes or errors - { agent, stage?, exitCode, duration, success } */
  AGENT_COMPLETE: 'agent.complete',
  /** Emitted when agent spawn exceeds timeout - { agent, stage?, timeoutMs } */
  AGENT_TIMEOUT: 'agent.timeout',

  // LLM events (verbose level)
  LLM_REQUEST: 'llm.request',
  LLM_RESPONSE: 'llm.response',
  LLM_TOKEN_USAGE: 'llm.token_usage',
  LLM_ERROR: 'llm.error',

  // Git events (standard level)
  GIT_BRANCH_CREATE: 'git.branch_create',
  GIT_COMMIT: 'git.commit',
  GIT_PUSH: 'git.push',
  GIT_ERROR: 'git.error',

  // Spec events (standard level)
  SPEC_FETCH: 'spec.fetch',
  SPEC_PARSE: 'spec.parse',
  SPEC_ERROR: 'spec.error',

  // Error events (minimal level)
  ERROR_UNHANDLED: 'error.unhandled',
  ERROR_VALIDATION: 'error.validation',

  // Performance events (verbose level)
  PERF_METRIC: 'performance.metric',
  PERF_DURATION: 'performance.duration',

  // Pipeline events (standard level)
  PIPELINE_START: 'pipeline.start',
  PIPELINE_END: 'pipeline.end',
  PIPELINE_STAGE_START: 'pipeline.stage_start',
  PIPELINE_STAGE_END: 'pipeline.stage_end',

  // Usage events (verbose level)
  USAGE_TOKENS: 'usage.tokens',
  USAGE_COST: 'usage.cost',
  // Gate events (standard level)
  /** Emitted after each gate execution - { gateName, passed, attempt } */
  GATE_RESULT: 'gate.result',
  /** Emitted when gate retry triggered - { gateName, attempt, maxRetries, failureSnippet } */
  GATE_RETRY: 'gate.retry',
} as const;

/**
 * Mapping of event names to their minimum telemetry level
 */
export const EVENT_LEVELS: Record<string, TelemetryLevel> = {
  // Command events - minimal
  [Events.COMMAND_START]: TelemetryLevel.minimal,
  [Events.COMMAND_END]: TelemetryLevel.minimal,
  [Events.COMMAND_ERROR]: TelemetryLevel.minimal,

  // Agent events - standard
  [Events.AGENT_START]: TelemetryLevel.standard,
  [Events.AGENT_END]: TelemetryLevel.standard,
  [Events.AGENT_ERROR]: TelemetryLevel.standard,
  [Events.AGENT_TOOL_CALL]: TelemetryLevel.standard,
  [Events.AGENT_SPAWN]: TelemetryLevel.standard,
  [Events.AGENT_COMPLETE]: TelemetryLevel.standard,
  [Events.AGENT_TIMEOUT]: TelemetryLevel.standard,

  // LLM events - verbose
  [Events.LLM_REQUEST]: TelemetryLevel.verbose,
  [Events.LLM_RESPONSE]: TelemetryLevel.verbose,
  [Events.LLM_TOKEN_USAGE]: TelemetryLevel.verbose,
  [Events.LLM_ERROR]: TelemetryLevel.verbose,

  // Git events - standard
  [Events.GIT_BRANCH_CREATE]: TelemetryLevel.standard,
  [Events.GIT_COMMIT]: TelemetryLevel.standard,
  [Events.GIT_PUSH]: TelemetryLevel.standard,
  [Events.GIT_ERROR]: TelemetryLevel.standard,

  // Spec events - standard
  [Events.SPEC_FETCH]: TelemetryLevel.standard,
  [Events.SPEC_PARSE]: TelemetryLevel.standard,
  [Events.SPEC_ERROR]: TelemetryLevel.standard,

  // Error events - minimal
  [Events.ERROR_UNHANDLED]: TelemetryLevel.minimal,
  [Events.ERROR_VALIDATION]: TelemetryLevel.minimal,

  // Performance events - verbose
  [Events.PERF_METRIC]: TelemetryLevel.verbose,
  [Events.PERF_DURATION]: TelemetryLevel.verbose,

  // Pipeline events - standard
  [Events.PIPELINE_START]: TelemetryLevel.standard,
  [Events.PIPELINE_END]: TelemetryLevel.standard,
  [Events.PIPELINE_STAGE_START]: TelemetryLevel.standard,
  [Events.PIPELINE_STAGE_END]: TelemetryLevel.standard,

  // Usage events - verbose
  [Events.USAGE_TOKENS]: TelemetryLevel.verbose,
  [Events.USAGE_COST]: TelemetryLevel.verbose,
  // Gate events - standard
  [Events.GATE_RESULT]: TelemetryLevel.standard,
  [Events.GATE_RETRY]: TelemetryLevel.standard,
};

/**
 * Extract category from event name
 * @param event - Event name (e.g., "command.start")
 * @returns Category portion before the dot
 */
export function categoryFromEvent(event: string): TelemetryCategory {
  const category = event.split('.')[0];

  // Validate category is valid TelemetryCategory
  const validCategories: TelemetryCategory[] = [
    'command',
    'agent',
    'llm',
    'git',
    'spec',
    'error',
    'performance',
    'pipeline',
    'usage',
    'gate',
  ];

  if (validCategories.includes(category as TelemetryCategory)) {
    return category as TelemetryCategory;
  }

  throw new Error(`Invalid event category: ${category}`);
}
