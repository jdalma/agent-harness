import { describe, it, expect } from 'vitest';
import { validateContextBudget } from '../../src/validator/context-budget.js';
import { ScenarioSchema, ScenarioResultSchema } from '../../src/scenario/models.js';

const makeScenario = (overrides = {}) =>
  ScenarioSchema.parse({ name: 'test', messages: [{ role: 'user', content: 'hello' }], ...overrides });
const makeResult = (overrides = {}) =>
  ScenarioResultSchema.parse({ scenarioName: 'test', ...overrides });

describe('validateContextBudget', () => {
  it('passes within budget', () => {
    const scenario = makeScenario({
      context_budget: { max_total_tokens: 10000, max_turns: 5 },
    });
    const result = makeResult({
      tokenUsage: { inputTokens: 3000, outputTokens: 1000 },
      turns: 2,
    });
    expect(validateContextBudget(scenario, result)).toHaveLength(0);
  });

  it('fails when tokens exceeded', () => {
    const scenario = makeScenario({
      context_budget: { max_total_tokens: 5000 },
    });
    const result = makeResult({
      tokenUsage: { inputTokens: 4000, outputTokens: 2000 },
    });
    const failures = validateContextBudget(scenario, result);
    expect(failures).toHaveLength(1);
    expect(failures[0].message).toContain('토큰 예산 초과');
  });

  it('fails when turns exceeded', () => {
    const scenario = makeScenario({ context_budget: { max_turns: 3 } });
    const result = makeResult({ turns: 5 });
    expect(validateContextBudget(scenario, result)).toHaveLength(1);
  });
});
