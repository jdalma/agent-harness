import { describe, it, expect, vi } from 'vitest';
import { CliRunner } from '../../src/runner/cli-runner.js';
import { ScenarioSchema, Verdict } from '../../src/scenario/models.js';
import { Logger } from '../../src/logger/logger.js';

// stream-json 출력을 시뮬레이션하는 헬퍼
function makeStreamLines(lines: Record<string, unknown>[]): string {
  return lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
}

const baseScenario = () =>
  ScenarioSchema.parse({
    name: 'cli-test',
    system_prompt: 'You are a routing assistant.',
    messages: [{ role: 'user', content: '주문 취소 조건이 뭐야?' }],
    tools: [],
    context_budget: { max_turns: 5 },
    model: 'haiku',
  });

describe('CliRunner', () => {
  it('parses tool_use from stream-json assistant messages', async () => {
    const streamOutput = makeStreamLines([
      {
        type: 'assistant',
        message: {
          id: 'msg_1',
          content: [
            {
              type: 'tool_use',
              id: 'tu_1',
              name: 'Skill',
              input: { skill: 'domain-ask', args: '주문 취소' },
            },
          ],
          model: 'claude-haiku-4-5-20251001',
          stop_reason: 'tool_use',
          usage: { input_tokens: 500, output_tokens: 100 },
        },
      },
      {
        type: 'assistant',
        message: {
          id: 'msg_2',
          content: [{ type: 'text', text: '주문 취소 조건은...' }],
          model: 'claude-haiku-4-5-20251001',
          stop_reason: 'end_turn',
          usage: { input_tokens: 800, output_tokens: 200 },
        },
      },
      {
        type: 'result',
        subtype: 'success',
        cost_usd: 0.002,
        duration_ms: 3000,
        num_turns: 2,
        usage: {
          input_tokens: 1300,
          output_tokens: 300,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
    ]);

    const mockSpawn = vi.fn().mockReturnValue({
      stdout: streamOutput,
      stderr: '',
      exitCode: 0,
    });

    const runner = new CliRunner({ spawnFn: mockSpawn });
    const result = await runner.run(baseScenario());

    expect(result.verdict).toBe(Verdict.PASS);
    expect(result.actualCalls).toHaveLength(1);
    expect(result.actualCalls[0].callType).toBe('skill');
    expect(result.actualCalls[0].name).toBe('domain-ask');
    expect(result.tokenUsage.inputTokens).toBe(1300);
    expect(result.tokenUsage.outputTokens).toBe(300);
    expect(result.turns).toBe(2);
  });

  it('classifies Task subagent_type as agent call', async () => {
    const streamOutput = makeStreamLines([
      {
        type: 'assistant',
        message: {
          id: 'msg_1',
          content: [
            {
              type: 'tool_use',
              id: 'tu_1',
              name: 'Task',
              input: {
                subagent_type: 'domain-orchestrator',
                prompt: '복합 도메인 분석',
                description: '분석',
              },
            },
          ],
          model: 'claude-haiku-4-5-20251001',
          stop_reason: 'tool_use',
          usage: { input_tokens: 500, output_tokens: 100 },
        },
      },
      {
        type: 'result',
        subtype: 'success',
        num_turns: 1,
        usage: { input_tokens: 500, output_tokens: 100 },
      },
    ]);

    const mockSpawn = vi.fn().mockReturnValue({
      stdout: streamOutput,
      stderr: '',
      exitCode: 0,
    });

    const runner = new CliRunner({ spawnFn: mockSpawn });
    const result = await runner.run(baseScenario());

    expect(result.actualCalls).toHaveLength(1);
    expect(result.actualCalls[0].callType).toBe('agent');
    expect(result.actualCalls[0].name).toBe('domain-orchestrator');
  });

  it('handles error results', async () => {
    const streamOutput = makeStreamLines([
      {
        type: 'result',
        subtype: 'error_during_execution',
        num_turns: 0,
        usage: { input_tokens: 50, output_tokens: 10 },
        errors: ['Connection timeout'],
      },
    ]);

    const mockSpawn = vi.fn().mockReturnValue({
      stdout: streamOutput,
      stderr: '',
      exitCode: 1,
    });

    const runner = new CliRunner({ spawnFn: mockSpawn });
    const result = await runner.run(baseScenario());

    expect(result.verdict).toBe(Verdict.ERROR);
    expect(result.error).toContain('Connection timeout');
  });

  it('handles spawn failure', async () => {
    const mockSpawn = vi.fn().mockReturnValue({
      stdout: '',
      stderr: 'claude: command not found',
      exitCode: 127,
    });

    const runner = new CliRunner({ spawnFn: mockSpawn });
    const result = await runner.run(baseScenario());

    expect(result.verdict).toBe(Verdict.ERROR);
    expect(result.error).toContain('claude: command not found');
  });

  it('passes correct CLI arguments', async () => {
    const mockSpawn = vi.fn().mockReturnValue({
      stdout: makeStreamLines([
        {
          type: 'result',
          subtype: 'success',
          num_turns: 1,
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      ]),
      stderr: '',
      exitCode: 0,
    });

    const runner = new CliRunner({ spawnFn: mockSpawn });
    await runner.run(baseScenario());

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const args = mockSpawn.mock.calls[0][0] as string[];
    expect(args).toContain('-p');
    expect(args).toContain('--output-format');
    expect(args).toContain('stream-json');
    expect(args).toContain('--no-session-persistence');
    expect(args).toContain('--model');
    expect(args).toContain('haiku');
    // 프롬프트가 포함되어야 함
    expect(args.some((a: string) => a.includes('주문 취소'))).toBe(true);
  });

  it('passes system prompt via --append-system-prompt', async () => {
    const mockSpawn = vi.fn().mockReturnValue({
      stdout: makeStreamLines([
        {
          type: 'result',
          subtype: 'success',
          num_turns: 1,
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      ]),
      stderr: '',
      exitCode: 0,
    });

    const runner = new CliRunner({ spawnFn: mockSpawn });
    await runner.run(baseScenario());

    const args = mockSpawn.mock.calls[0][0] as string[];
    const sysIdx = args.indexOf('--append-system-prompt');
    expect(sysIdx).toBeGreaterThan(-1);
    expect(args[sysIdx + 1]).toContain('routing assistant');
  });

  it('calls logger during execution', async () => {
    const streamOutput = makeStreamLines([
      {
        type: 'assistant',
        message: {
          id: 'msg_1',
          content: [
            {
              type: 'tool_use',
              id: 'tu_1',
              name: 'Skill',
              input: { skill: 'domain-ask' },
            },
          ],
          model: 'claude-haiku-4-5-20251001',
          stop_reason: 'tool_use',
          usage: { input_tokens: 500, output_tokens: 100 },
        },
      },
      {
        type: 'result',
        subtype: 'success',
        num_turns: 1,
        usage: { input_tokens: 500, output_tokens: 100 },
      },
    ]);

    const mockSpawn = vi.fn().mockReturnValue({
      stdout: streamOutput,
      stderr: '',
      exitCode: 0,
    });

    const logger = new Logger('verbose');
    const turnSpy = vi.spyOn(logger, 'turn');
    const toolCallSpy = vi.spyOn(logger, 'toolCall');

    const runner = new CliRunner({ spawnFn: mockSpawn, logger });
    await runner.run(baseScenario());

    expect(turnSpy).toHaveBeenCalled();
    expect(toolCallSpy).toHaveBeenCalledWith('skill', 'domain-ask', 0);
  });

  it('ignores non-assistant non-result messages', async () => {
    const streamOutput = makeStreamLines([
      { type: 'system', subtype: 'init', tools: [] },
      {
        type: 'assistant',
        message: {
          id: 'msg_1',
          content: [{ type: 'text', text: 'Hello' }],
          model: 'claude-haiku-4-5-20251001',
          stop_reason: 'end_turn',
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      },
      {
        type: 'result',
        subtype: 'success',
        num_turns: 1,
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    ]);

    const mockSpawn = vi.fn().mockReturnValue({
      stdout: streamOutput,
      stderr: '',
      exitCode: 0,
    });

    const runner = new CliRunner({ spawnFn: mockSpawn });
    const result = await runner.run(baseScenario());

    expect(result.verdict).toBe(Verdict.PASS);
    expect(result.actualCalls).toHaveLength(0);
  });
});
