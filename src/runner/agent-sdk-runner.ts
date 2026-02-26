import {
  Verdict,
  type ActualCall,
  type Scenario,
  type ScenarioResult,
  type TokenUsage,
} from '../scenario/models.js';
import type { IScenarioRunner } from './types.js';
import { classifyCall } from './classify-call.js';

// ── Agent SDK 메시지 타입 (외부 의존성 없이 최소 정의) ──

interface SDKAssistantMessage {
  type: 'assistant';
  uuid: string;
  session_id: string;
  parent_tool_use_id: string | null;
  message: {
    id: string;
    content: Array<{
      type: string;
      id?: string;
      name?: string;
      input?: Record<string, unknown>;
      text?: string;
    }>;
    model: string;
    stop_reason: string;
    usage: {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
}

interface SDKResultMessageSuccess {
  type: 'result';
  subtype: 'success';
  num_turns: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  total_cost_usd: number;
  duration_ms: number;
  [key: string]: unknown;
}

interface SDKResultMessageError {
  type: 'result';
  subtype:
    | 'error_max_turns'
    | 'error_during_execution'
    | 'error_max_budget_usd'
    | 'error_max_structured_output_retries';
  num_turns: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  errors: string[];
  [key: string]: unknown;
}

type SDKResultMessage = SDKResultMessageSuccess | SDKResultMessageError;

type SDKMessage =
  | SDKAssistantMessage
  | SDKResultMessage
  | { type: string; [key: string]: unknown };

export type QueryFn = (options: {
  prompt: string;
  options?: Record<string, unknown>;
}) => AsyncIterable<SDKMessage>;

export interface AgentSdkRunnerOptions {
  queryFn?: QueryFn;
  sdkOptions?: Record<string, unknown>;
}

export class AgentSdkRunner implements IScenarioRunner {
  private queryFn: QueryFn | null;
  private sdkOptions: Record<string, unknown>;

  constructor(options?: AgentSdkRunnerOptions) {
    this.queryFn = options?.queryFn ?? null;
    this.sdkOptions = options?.sdkOptions ?? {};
  }

  private async ensureQueryFn(): Promise<QueryFn> {
    if (this.queryFn) return this.queryFn;
    // Dynamic import — @anthropic-ai/claude-agent-sdk is an optional peer dependency
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = await (import(
      /* webpackIgnore: true */ '@anthropic-ai/claude-agent-sdk'
    ) as Promise<{ query: unknown }>);
    this.queryFn = mod.query as unknown as QueryFn;
    return this.queryFn;
  }

  async run(scenario: Scenario): Promise<ScenarioResult> {
    const allCalls: ActualCall[] = [];
    const rawResponses: Record<string, unknown>[] = [];
    let tokenUsage: TokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    };
    let turns = 0;
    let turnCounter = 0;

    try {
      const queryFn = await this.ensureQueryFn();

      const userMessage = scenario.messages[0] as { content: string };
      const prompt =
        typeof userMessage.content === 'string'
          ? userMessage.content
          : JSON.stringify(userMessage.content);

      const queryOptions: Record<string, unknown> = {
        ...this.sdkOptions,
        maxTurns: scenario.contextBudget.maxTurns ?? 10,
      };

      if (scenario.systemPrompt) {
        queryOptions.systemPrompt = scenario.systemPrompt;
      }
      if (scenario.model) {
        queryOptions.model = scenario.model;
      }

      const stream = queryFn({ prompt, options: queryOptions });

      for await (const message of stream) {
        if (message.type === 'assistant') {
          const assistantMsg = message as SDKAssistantMessage;
          const parentId = assistantMsg.parent_tool_use_id;

          for (const block of assistantMsg.message.content) {
            if (block.type === 'tool_use') {
              const [callType, logicalName] = classifyCall(
                block.name!,
                block.input ?? {},
              );
              allCalls.push({
                name: logicalName,
                callType,
                input: block.input ?? {},
                turn: turnCounter,
                parentToolUseId: parentId,
              });
            }
          }

          rawResponses.push({
            turn: turnCounter,
            type: 'assistant',
            stop_reason: assistantMsg.message.stop_reason,
            parent_tool_use_id: parentId,
            usage: {
              input_tokens: assistantMsg.message.usage.input_tokens,
              output_tokens: assistantMsg.message.usage.output_tokens,
            },
          });

          if (!parentId) {
            turnCounter++;
          }
        } else if (message.type === 'result') {
          const resultMsg = message as SDKResultMessage;

          tokenUsage = {
            inputTokens: resultMsg.usage.input_tokens,
            outputTokens: resultMsg.usage.output_tokens,
            cacheCreationInputTokens:
              resultMsg.usage.cache_creation_input_tokens ?? 0,
            cacheReadInputTokens:
              resultMsg.usage.cache_read_input_tokens ?? 0,
          };
          turns = resultMsg.num_turns;

          if (resultMsg.subtype !== 'success') {
            const errorMsg = resultMsg as SDKResultMessageError;
            return {
              scenarioName: scenario.name,
              verdict: Verdict.ERROR,
              actualCalls: allCalls,
              tokenUsage,
              turns,
              failures: [],
              error:
                errorMsg.errors?.join('; ') ??
                `Agent SDK error: ${resultMsg.subtype}`,
              rawResponses,
            };
          }
        }
        // system, stream_event 등 다른 메시지 타입은 무시
      }

      return {
        scenarioName: scenario.name,
        verdict: Verdict.PASS,
        actualCalls: allCalls,
        tokenUsage,
        turns,
        failures: [],
        error: null,
        rawResponses,
      };
    } catch (e) {
      return {
        scenarioName: scenario.name,
        verdict: Verdict.ERROR,
        actualCalls: allCalls,
        tokenUsage,
        turns,
        failures: [],
        error: e instanceof Error ? e.message : String(e),
        rawResponses,
      };
    }
  }
}
