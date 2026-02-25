import { describe, it, expect } from 'vitest';
import { ScenarioRunner } from '../../src/runner/scenario-runner.js';
import { ScenarioSchema, Verdict } from '../../src/scenario/models.js';
import type { ApiClient, ApiResponse } from '../../src/runner/types.js';

function createMockClient(responses: ApiResponse[]): ApiClient {
  let callIndex = 0;
  return {
    messages: {
      create: async () => {
        const response = responses[callIndex];
        callIndex++;
        return response;
      },
    },
  };
}

const baseScenario = () =>
  ScenarioSchema.parse({
    name: 'test-scenario',
    messages: [{ role: 'user', content: 'hello' }],
    tools: [
      { name: 'Read', description: 'reads files' },
      { name: 'Grep', description: 'searches content' },
    ],
    context_budget: { max_turns: 5 },
  });

describe('ScenarioRunner', () => {
  it('runs scenario with no tool use', async () => {
    const mockClient = createMockClient([
      {
        content: [{ type: 'text', text: 'Hello there!' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    ]);

    const runner = new ScenarioRunner({ client: mockClient });
    const result = await runner.run(baseScenario());

    expect(result.scenarioName).toBe('test-scenario');
    expect(result.verdict).toBe(Verdict.PASS);
    expect(result.actualCalls).toHaveLength(0);
    expect(result.turns).toBe(1);
    expect(result.tokenUsage.inputTokens).toBe(100);
    expect(result.tokenUsage.outputTokens).toBe(50);
  });

  it('captures tool calls', async () => {
    const mockClient = createMockClient([
      {
        content: [
          { type: 'tool_use', id: 'call_1', name: 'Read', input: { file_path: 'src/main.py' } },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 200, output_tokens: 100 },
      },
      {
        content: [{ type: 'text', text: 'I read the file.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 300, output_tokens: 150 },
      },
    ]);

    const runner = new ScenarioRunner({ client: mockClient });
    const result = await runner.run(baseScenario());

    expect(result.actualCalls).toHaveLength(1);
    expect(result.actualCalls[0].name).toBe('Read');
    expect(result.actualCalls[0].callType).toBe('tool');
    expect(result.actualCalls[0].input).toEqual({ file_path: 'src/main.py' });
    expect(result.turns).toBe(2);
    expect(result.tokenUsage.inputTokens).toBe(500);
  });

  it('classifies Task as agent', async () => {
    const mockClient = createMockClient([
      {
        content: [
          { type: 'tool_use', id: 'call_1', name: 'Task', input: { subagent_type: 'Explore', prompt: 'find files' } },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 200, output_tokens: 100 },
      },
      {
        content: [{ type: 'text', text: 'Done.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 300, output_tokens: 50 },
      },
    ]);

    const runner = new ScenarioRunner({ client: mockClient });
    const result = await runner.run(baseScenario());

    expect(result.actualCalls[0].callType).toBe('agent');
    expect(result.actualCalls[0].name).toBe('Explore');
  });

  it('handles API errors gracefully', async () => {
    const mockClient = createMockClient([]);
    mockClient.messages.create = async () => {
      throw new Error('API rate limit exceeded');
    };

    const runner = new ScenarioRunner({ client: mockClient });
    const result = await runner.run(baseScenario());

    expect(result.verdict).toBe(Verdict.ERROR);
    expect(result.error).toContain('API rate limit exceeded');
  });

  it('uses custom tool results provider', async () => {
    const mockClient = createMockClient([
      {
        content: [
          { type: 'tool_use', id: 'call_1', name: 'Read', input: { file_path: 'a.py' } },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 100, output_tokens: 50 },
      },
      {
        content: [{ type: 'text', text: 'Done' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 200, output_tokens: 100 },
      },
    ]);

    const runner = new ScenarioRunner({
      client: mockClient,
      toolResultsProvider: { Read: 'custom file content' },
    });
    const result = await runner.run(baseScenario());

    expect(result.verdict).toBe(Verdict.PASS);
    expect(result.actualCalls).toHaveLength(1);
  });

  it('respects max turns', async () => {
    // All responses trigger tool_use, so it should stop at max_turns
    const repeatingResponses: ApiResponse[] = Array.from({ length: 10 }, (_, i) => ({
      content: [
        { type: 'tool_use', id: `call_${i}`, name: 'Read', input: { file_path: `file${i}.py` } },
      ],
      stop_reason: 'tool_use' as const,
      usage: { input_tokens: 100, output_tokens: 50 },
    }));

    const mockClient = createMockClient(repeatingResponses);
    const scenario = ScenarioSchema.parse({
      name: 'test',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [{ name: 'Read', description: 'reads files' }],
      context_budget: { max_turns: 3 },
    });

    const runner = new ScenarioRunner({ client: mockClient });
    const result = await runner.run(scenario);

    expect(result.turns).toBe(3);
    expect(result.actualCalls.length).toBe(3);
  });
});
