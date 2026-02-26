import { describe, it, expect, vi } from 'vitest';
import { AgentSdkRunner } from '../../src/runner/agent-sdk-runner.js';
import { ScenarioSchema, Verdict } from '../../src/scenario/models.js';

// Mock SDKMessage helpers
function makeAssistantMessage(
  content: Array<{
    type: string;
    name?: string;
    id?: string;
    input?: Record<string, unknown>;
    text?: string;
  }>,
  parentToolUseId: string | null = null,
) {
  return {
    type: 'assistant' as const,
    uuid: 'uuid-1',
    session_id: 'session-1',
    parent_tool_use_id: parentToolUseId,
    message: {
      id: 'msg_1',
      content,
      model: 'claude-sonnet-4-20250514',
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 50 },
    },
  };
}

function makeResultMessage(overrides: Record<string, unknown> = {}) {
  return {
    type: 'result' as const,
    subtype: 'success' as const,
    uuid: 'uuid-r',
    session_id: 'session-1',
    duration_ms: 1000,
    duration_api_ms: 800,
    is_error: false,
    num_turns: 1,
    result: 'done',
    stop_reason: 'end_turn',
    total_cost_usd: 0.01,
    usage: {
      input_tokens: 200,
      output_tokens: 100,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    modelUsage: {},
    permission_denials: [],
    ...overrides,
  };
}

const baseScenario = () =>
  ScenarioSchema.parse({
    name: 'sdk-test',
    messages: [{ role: 'user', content: 'hello' }],
    tools: [],
    context_budget: { max_turns: 5 },
  });

describe('AgentSdkRunner', () => {
  it('collects tool calls from assistant messages', async () => {
    const messages = [
      makeAssistantMessage([
        {
          type: 'tool_use',
          id: 'tu_1',
          name: 'Skill',
          input: { skill: 'domain-ask', args: 'test' },
        },
      ]),
      makeAssistantMessage([{ type: 'text', text: 'Done' }]),
      makeResultMessage({
        num_turns: 2,
        usage: {
          input_tokens: 500,
          output_tokens: 200,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      }),
    ];

    const mockQuery = vi.fn().mockReturnValue(
      (async function* () {
        for (const m of messages) yield m;
      })(),
    );

    const runner = new AgentSdkRunner({ queryFn: mockQuery });
    const result = await runner.run(baseScenario());

    expect(result.verdict).toBe(Verdict.PASS);
    expect(result.actualCalls).toHaveLength(1);
    expect(result.actualCalls[0].callType).toBe('skill');
    expect(result.actualCalls[0].name).toBe('domain-ask');
    expect(result.actualCalls[0].parentToolUseId).toBeNull();
  });

  it('tracks nested calls via parentToolUseId', async () => {
    const messages = [
      makeAssistantMessage([
        {
          type: 'tool_use',
          id: 'tu_1',
          name: 'Task',
          input: {
            subagent_type: 'domain-orchestrator',
            prompt: 'multi',
            description: 'multi',
          },
        },
      ]),
      // 서브에이전트 내부 호출 — parent_tool_use_id 가 tu_1
      makeAssistantMessage(
        [
          {
            type: 'tool_use',
            id: 'tu_2',
            name: 'Task',
            input: {
              subagent_type: 'order',
              prompt: 'check',
              description: 'check',
            },
          },
        ],
        'tu_1',
      ),
      makeResultMessage({ num_turns: 2 }),
    ];

    const mockQuery = vi.fn().mockReturnValue(
      (async function* () {
        for (const m of messages) yield m;
      })(),
    );

    const runner = new AgentSdkRunner({ queryFn: mockQuery });
    const result = await runner.run(baseScenario());

    expect(result.actualCalls).toHaveLength(2);
    expect(result.actualCalls[0].name).toBe('domain-orchestrator');
    expect(result.actualCalls[0].callType).toBe('agent');
    expect(result.actualCalls[0].parentToolUseId).toBeNull();
    expect(result.actualCalls[1].name).toBe('order');
    expect(result.actualCalls[1].callType).toBe('agent');
    expect(result.actualCalls[1].parentToolUseId).toBe('tu_1');
  });

  it('handles error results', async () => {
    const messages = [
      {
        type: 'result' as const,
        subtype: 'error_during_execution' as const,
        uuid: 'uuid-r',
        session_id: 'session-1',
        duration_ms: 500,
        duration_api_ms: 400,
        is_error: true,
        num_turns: 0,
        stop_reason: null,
        total_cost_usd: 0.001,
        usage: {
          input_tokens: 50,
          output_tokens: 10,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
        modelUsage: {},
        permission_denials: [],
        errors: ['Authentication failed'],
      },
    ];

    const mockQuery = vi.fn().mockReturnValue(
      (async function* () {
        for (const m of messages) yield m;
      })(),
    );

    const runner = new AgentSdkRunner({ queryFn: mockQuery });
    const result = await runner.run(baseScenario());

    expect(result.verdict).toBe(Verdict.ERROR);
    expect(result.error).toContain('Authentication failed');
  });

  it('extracts token usage from result message', async () => {
    const messages = [
      makeAssistantMessage([{ type: 'text', text: 'Hi' }]),
      makeResultMessage({
        num_turns: 1,
        usage: {
          input_tokens: 1000,
          output_tokens: 300,
          cache_creation_input_tokens: 50,
          cache_read_input_tokens: 200,
        },
      }),
    ];

    const mockQuery = vi.fn().mockReturnValue(
      (async function* () {
        for (const m of messages) yield m;
      })(),
    );

    const runner = new AgentSdkRunner({ queryFn: mockQuery });
    const result = await runner.run(baseScenario());

    expect(result.tokenUsage.inputTokens).toBe(1000);
    expect(result.tokenUsage.outputTokens).toBe(300);
    expect(result.tokenUsage.cacheCreationInputTokens).toBe(50);
    expect(result.tokenUsage.cacheReadInputTokens).toBe(200);
    expect(result.turns).toBe(1);
  });

  it('handles exceptions from query function', async () => {
    const mockQuery = vi.fn().mockReturnValue(
      (async function* () {
        throw new Error('Connection refused');
      })(),
    );

    const runner = new AgentSdkRunner({ queryFn: mockQuery });
    const result = await runner.run(baseScenario());

    expect(result.verdict).toBe(Verdict.ERROR);
    expect(result.error).toContain('Connection refused');
  });

  it('handles multiple tool calls in single assistant message', async () => {
    const messages = [
      makeAssistantMessage([
        {
          type: 'tool_use',
          id: 'tu_1',
          name: 'Skill',
          input: { skill: 'domain-ask', args: 'order query' },
        },
        {
          type: 'tool_use',
          id: 'tu_2',
          name: 'Read',
          input: { file_path: 'README.md' },
        },
      ]),
      makeResultMessage({ num_turns: 1 }),
    ];

    const mockQuery = vi.fn().mockReturnValue(
      (async function* () {
        for (const m of messages) yield m;
      })(),
    );

    const runner = new AgentSdkRunner({ queryFn: mockQuery });
    const result = await runner.run(baseScenario());

    expect(result.actualCalls).toHaveLength(2);
    expect(result.actualCalls[0].callType).toBe('skill');
    expect(result.actualCalls[0].name).toBe('domain-ask');
    expect(result.actualCalls[1].callType).toBe('tool');
    expect(result.actualCalls[1].name).toBe('Read');
  });

  it('passes scenario options to queryFn', async () => {
    const mockQuery = vi.fn().mockReturnValue(
      (async function* () {
        yield makeResultMessage();
      })(),
    );

    const runner = new AgentSdkRunner({
      queryFn: mockQuery,
      sdkOptions: { cwd: '/tmp/project', permissionMode: 'bypassPermissions' },
    });

    const scenario = ScenarioSchema.parse({
      name: 'opts-test',
      messages: [{ role: 'user', content: 'test prompt' }],
      system_prompt: 'You are a helper.',
      model: 'claude-sonnet-4-20250514',
      context_budget: { max_turns: 3 },
    });

    await runner.run(scenario);

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const callArgs = mockQuery.mock.calls[0][0];
    expect(callArgs.prompt).toBe('test prompt');
    expect(callArgs.options.cwd).toBe('/tmp/project');
    expect(callArgs.options.permissionMode).toBe('bypassPermissions');
    expect(callArgs.options.systemPrompt).toBe('You are a helper.');
    expect(callArgs.options.model).toBe('claude-sonnet-4-20250514');
    expect(callArgs.options.maxTurns).toBe(3);
  });

  it('ignores non-assistant non-result messages', async () => {
    const messages = [
      { type: 'system', subtype: 'init', uuid: 'u1', session_id: 's1', tools: [] },
      makeAssistantMessage([{ type: 'text', text: 'Hi' }]),
      { type: 'stream_event', event: {}, uuid: 'u2', session_id: 's1' },
      makeResultMessage({ num_turns: 1 }),
    ];

    const mockQuery = vi.fn().mockReturnValue(
      (async function* () {
        for (const m of messages) yield m;
      })(),
    );

    const runner = new AgentSdkRunner({ queryFn: mockQuery });
    const result = await runner.run(baseScenario());

    expect(result.verdict).toBe(Verdict.PASS);
    expect(result.actualCalls).toHaveLength(0);
    expect(result.turns).toBe(1);
  });
});
