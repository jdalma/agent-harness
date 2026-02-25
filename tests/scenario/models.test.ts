import { describe, it, expect } from 'vitest';
import {
  ToolDefinitionSchema,
  ExpectedCallSchema,
  ForbiddenCallSchema,
  ContextBudgetSchema,
  ScenarioSchema,
  TokenUsageSchema,
  ActualCallSchema,
  Verdict,
  ValidationFailureSchema,
  ScenarioResultSchema,
  computeTotalTokens,
  computeCacheHitRate,
} from '../../src/scenario/models.js';

describe('ToolDefinition', () => {
  it('parses with defaults', () => {
    const tool = ToolDefinitionSchema.parse({ name: 'Read', description: 'reads files' });
    expect(tool.name).toBe('Read');
    expect(tool.inputSchema).toEqual({ type: 'object', properties: {} });
  });
});

describe('ExpectedCall', () => {
  it('has default call_type and required', () => {
    const call = ExpectedCallSchema.parse({ name: 'Read' });
    expect(call.callType).toBe('tool');
    expect(call.required).toBe(true);
    expect(call.argsContain).toBeNull();
  });
});

describe('ForbiddenCall', () => {
  it('has default reason', () => {
    const call = ForbiddenCallSchema.parse({ name: 'Write' });
    expect(call.callType).toBe('tool');
    expect(call.reason).toBe('');
  });
});

describe('ContextBudget', () => {
  it('all fields optional', () => {
    const budget = ContextBudgetSchema.parse({});
    expect(budget.maxInputTokens).toBeNull();
    expect(budget.maxTurns).toBeNull();
  });
});

describe('Scenario', () => {
  it('parses minimal scenario', () => {
    const s = ScenarioSchema.parse({
      name: 'test',
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(s.name).toBe('test');
    expect(s.model).toBe('claude-sonnet-4-20250514');
    expect(s.maxTokens).toBe(4096);
    expect(s.tools).toEqual([]);
    expect(s.executeTools).toBe(false);
  });

  // YAML uses snake_case keys — Zod must accept both camelCase and snake_case
  it('parses snake_case keys from YAML', () => {
    const s = ScenarioSchema.parse({
      name: 'test',
      system_prompt: 'hello',
      expected_calls: [{ name: 'Read', call_type: 'tool' }],
      forbidden_calls: [{ name: 'Write', call_type: 'tool' }],
      context_budget: { max_turns: 5, max_total_tokens: 10000 },
      max_tokens: 2048,
      project_path: '/tmp/project',
      execute_tools: true,
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(s.systemPrompt).toBe('hello');
    expect(s.expectedCalls[0].callType).toBe('tool');
    expect(s.forbiddenCalls[0].name).toBe('Write');
    expect(s.contextBudget.maxTurns).toBe(5);
    expect(s.maxTokens).toBe(2048);
    expect(s.projectPath).toBe('/tmp/project');
    expect(s.executeTools).toBe(true);
  });
});

describe('TokenUsage', () => {
  it('has defaults of 0', () => {
    const u = TokenUsageSchema.parse({});
    expect(u.inputTokens).toBe(0);
    expect(u.outputTokens).toBe(0);
  });

  it('computes total tokens', () => {
    const u = TokenUsageSchema.parse({ inputTokens: 1000, outputTokens: 500 });
    expect(computeTotalTokens(u)).toBe(1500);
  });

  it('computes cache hit rate', () => {
    const u = TokenUsageSchema.parse({
      inputTokens: 1000,
      cacheReadInputTokens: 800,
    });
    // 800 / (1000 + 800) = 0.444...
    expect(computeCacheHitRate(u)).toBeGreaterThan(0.4);
  });

  it('returns 0 cache hit rate when no input', () => {
    const u = TokenUsageSchema.parse({});
    expect(computeCacheHitRate(u)).toBe(0);
  });
});

describe('ActualCall', () => {
  it('has defaults', () => {
    const call = ActualCallSchema.parse({ name: 'Read' });
    expect(call.callType).toBe('tool');
    expect(call.input).toEqual({});
    expect(call.turn).toBe(0);
  });
});

describe('Verdict', () => {
  it('has expected values', () => {
    expect(Verdict.PASS).toBe('pass');
    expect(Verdict.FAIL).toBe('fail');
    expect(Verdict.ERROR).toBe('error');
  });
});

describe('ValidationFailure', () => {
  it('parses with required fields', () => {
    const f = ValidationFailureSchema.parse({ rule: 'expected_call', message: 'missing' });
    expect(f.expected).toBeNull();
    expect(f.actual).toBeNull();
  });
});

describe('ScenarioResult', () => {
  it('has default verdict PASS', () => {
    const r = ScenarioResultSchema.parse({ scenarioName: 'test' });
    expect(r.verdict).toBe(Verdict.PASS);
    expect(r.actualCalls).toEqual([]);
    expect(r.turns).toBe(0);
  });
});
