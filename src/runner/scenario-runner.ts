import {
  Verdict,
  type ActualCall,
  type Scenario,
  type ScenarioResult,
  type TokenUsage,
} from '../scenario/models.js';
import type { IToolExecutor } from '../executor/types.js';
import type { ApiClient, ApiResponse } from './types.js';
import { classifyCall } from './classify-call.js';

function buildTools(scenario: Scenario): Record<string, unknown>[] {
  return scenario.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }));
}

function accumulateUsage(total: TokenUsage, usage: ApiResponse['usage']): TokenUsage {
  return {
    inputTokens: total.inputTokens + (usage.input_tokens ?? 0),
    outputTokens: total.outputTokens + (usage.output_tokens ?? 0),
    cacheCreationInputTokens: total.cacheCreationInputTokens + (usage.cache_creation_input_tokens ?? 0),
    cacheReadInputTokens: total.cacheReadInputTokens + (usage.cache_read_input_tokens ?? 0),
  };
}

function extractToolCalls(
  response: ApiResponse,
  turn: number,
): { calls: ActualCall[]; toolResults: Record<string, unknown>[] } {
  const calls: ActualCall[] = [];
  const toolResults: Record<string, unknown>[] = [];

  for (const block of response.content) {
    if (block.type === 'tool_use') {
      const [callType, logicalName] = classifyCall(block.name!, block.input ?? {});
      calls.push({
        name: logicalName,
        callType,
        input: block.input ?? {},
        turn,
      });
      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: '[harness] simulated tool result',
      });
    }
  }

  return { calls, toolResults };
}

export class ScenarioRunner {
  private readonly client: ApiClient;
  private readonly toolResultsProvider: Record<string, string>;
  private toolExecutor: IToolExecutor | null;

  constructor(options?: {
    client?: ApiClient;
    toolResultsProvider?: Record<string, string>;
    toolExecutor?: IToolExecutor;
  }) {
    this.client = options?.client ?? this.createDefaultClient();
    this.toolResultsProvider = options?.toolResultsProvider ?? {};
    this.toolExecutor = options?.toolExecutor ?? null;
  }

  private createDefaultClient(): ApiClient {
    // Lazy import to avoid requiring @anthropic-ai/sdk at module load
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Anthropic = require('@anthropic-ai/sdk').default;
    return new Anthropic();
  }

  private getToolResult(toolName: string, toolInput: Record<string, unknown>): string {
    if (this.toolExecutor) {
      return this.toolExecutor.execute(toolName, toolInput);
    }
    if (toolName in this.toolResultsProvider) {
      return this.toolResultsProvider[toolName];
    }
    return '[harness] simulated tool result';
  }

  async run(scenario: Scenario): Promise<ScenarioResult> {
    const messages: Record<string, unknown>[] = [...scenario.messages];
    const tools = buildTools(scenario);
    let tokenUsage: TokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    };
    const maxTurns = scenario.contextBudget.maxTurns ?? 10;
    const allCalls: ActualCall[] = [];
    const rawResponses: Record<string, unknown>[] = [];
    let turns = 0;

    try {
      for (let turn = 0; turn < maxTurns; turn++) {
        const params: Record<string, unknown> = {
          model: scenario.model,
          max_tokens: scenario.maxTokens,
          messages,
        };
        if (scenario.systemPrompt) {
          params.system = scenario.systemPrompt;
        }
        if (tools.length > 0) {
          params.tools = tools;
        }

        const response = await this.client.messages.create(params as never);
        tokenUsage = accumulateUsage(tokenUsage, response.usage);
        rawResponses.push({
          turn,
          stop_reason: response.stop_reason,
          usage: {
            input_tokens: response.usage.input_tokens,
            output_tokens: response.usage.output_tokens,
          },
        });

        const { calls } = extractToolCalls(response, turn);
        allCalls.push(...calls);

        if (response.stop_reason !== 'tool_use') {
          turns = turn + 1;
          break;
        }

        // Add assistant response and tool results to conversation
        messages.push({ role: 'assistant', content: response.content });
        const toolResultContents: Record<string, unknown>[] = [];
        for (const block of response.content) {
          if (block.type === 'tool_use') {
            toolResultContents.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: this.getToolResult(block.name!, block.input ?? {}),
            });
          }
        }
        messages.push({ role: 'user', content: toolResultContents });

        // If this is the last iteration
        if (turn === maxTurns - 1) {
          turns = maxTurns;
        }
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
