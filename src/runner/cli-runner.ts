import {
  Verdict,
  type ActualCall,
  type Scenario,
  type ScenarioResult,
  type TokenUsage,
} from '../scenario/models.js';
import type { IScenarioRunner } from './types.js';
import { classifyCall } from './classify-call.js';
import { Logger } from '../logger/logger.js';
import { execFileSync } from 'node:child_process';

// stream-json 메시지 타입
interface StreamAssistantMessage {
  type: 'assistant';
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

interface StreamResultSuccess {
  type: 'result';
  subtype: 'success';
  num_turns: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

interface StreamResultError {
  type: 'result';
  subtype: string; // 'error_during_execution' etc.
  num_turns: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  errors?: string[];
}

type StreamMessage =
  | StreamAssistantMessage
  | StreamResultSuccess
  | StreamResultError
  | { type: string; [key: string]: unknown };

export type SpawnFn = (args: string[]) => {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export interface CliRunnerOptions {
  spawnFn?: SpawnFn;
  logger?: Logger;
}

function defaultSpawn(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync('claude', args, {
      encoding: 'utf8',
      env: { ...process.env, CLAUDECODE: '' },
      timeout: 120_000,
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; status?: number; message?: string };
    return {
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? err.message ?? String(e),
      exitCode: err.status ?? 1,
    };
  }
}

export class CliRunner implements IScenarioRunner {
  private spawnFn: SpawnFn;
  private logger: Logger;

  constructor(options?: CliRunnerOptions) {
    this.spawnFn = options?.spawnFn ?? defaultSpawn;
    this.logger = options?.logger ?? new Logger('quiet');
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

    try {
      const args = this.buildArgs(scenario);
      const { stdout, stderr, exitCode } = this.spawnFn(args);

      // stdout가 비어있고 에러가 있으면 실패
      if (!stdout.trim() && (exitCode !== 0 || stderr)) {
        return {
          scenarioName: scenario.name,
          verdict: Verdict.ERROR,
          actualCalls: allCalls,
          tokenUsage,
          turns: 0,
          failures: [],
          error: stderr || `claude exited with code ${exitCode}`,
          rawResponses,
        };
      }

      // stream-json 파싱
      const lines = stdout.trim().split('\n').filter(Boolean);
      let turnCounter = 0;

      for (const line of lines) {
        let message: StreamMessage;
        try {
          message = JSON.parse(line) as StreamMessage;
        } catch {
          continue; // 파싱 불가한 줄은 무시
        }

        if (message.type === 'assistant') {
          const assistantMsg = message as StreamAssistantMessage;
          this.logger.turn(scenario.name, turnCounter);

          for (const block of assistantMsg.message.content) {
            if (block.type === 'tool_use') {
              const [callType, logicalName] = classifyCall(
                block.name!,
                block.input ?? {},
              );
              this.logger.toolCall(callType, logicalName, turnCounter);
              allCalls.push({
                name: logicalName,
                callType,
                input: block.input ?? {},
                turn: turnCounter,
                parentToolUseId: null,
              });
            }
          }

          rawResponses.push({
            turn: turnCounter,
            type: 'assistant',
            stop_reason: assistantMsg.message.stop_reason,
            usage: {
              input_tokens: assistantMsg.message.usage.input_tokens,
              output_tokens: assistantMsg.message.usage.output_tokens,
            },
          });

          turnCounter++;
        } else if (message.type === 'result') {
          const resultMsg = message as StreamResultSuccess | StreamResultError;

          tokenUsage = {
            inputTokens: resultMsg.usage.input_tokens,
            outputTokens: resultMsg.usage.output_tokens,
            cacheCreationInputTokens: resultMsg.usage.cache_creation_input_tokens ?? 0,
            cacheReadInputTokens: resultMsg.usage.cache_read_input_tokens ?? 0,
          };
          turns = resultMsg.num_turns;

          if (resultMsg.subtype !== 'success') {
            const errorMsg = resultMsg as StreamResultError;
            return {
              scenarioName: scenario.name,
              verdict: Verdict.ERROR,
              actualCalls: allCalls,
              tokenUsage,
              turns,
              failures: [],
              error: errorMsg.errors?.join('; ') ?? `CLI error: ${resultMsg.subtype}`,
              rawResponses,
            };
          }
        }
        // system, tool_result 등 다른 메시지 타입은 무시
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

  private buildArgs(scenario: Scenario): string[] {
    const userMessage = scenario.messages[0] as { content: string };
    const prompt =
      typeof userMessage.content === 'string'
        ? userMessage.content
        : JSON.stringify(userMessage.content);

    const args: string[] = [
      '-p', prompt,
      '--output-format', 'stream-json',
      '--no-session-persistence',
    ];

    if (scenario.model) {
      args.push('--model', scenario.model);
    }

    if (scenario.systemPrompt) {
      args.push('--append-system-prompt', scenario.systemPrompt);
    }

    return args;
  }
}
