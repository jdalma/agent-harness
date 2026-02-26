export interface MessageParams {
  model: string;
  max_tokens: number;
  messages: Record<string, unknown>[];
  system?: string;
  tools?: Record<string, unknown>[];
}

export interface ApiResponse {
  content: Array<{
    type: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
    text?: string;
  }>;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

export interface ApiClient {
  messages: {
    create(params: MessageParams): Promise<ApiResponse>;
  };
}

// ── 런너 추상화 ──

import type { Scenario, ScenarioResult } from '../scenario/models.js';

export interface IScenarioRunner {
  run(scenario: Scenario): Promise<ScenarioResult>;
}
