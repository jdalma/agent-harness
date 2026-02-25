import { describe, it, expect } from 'vitest';
import { validate } from '../../src/validator/validate.js';
import { ScenarioSchema, ScenarioResultSchema, Verdict } from '../../src/scenario/models.js';

const makeScenario = (overrides = {}) =>
  ScenarioSchema.parse({ name: 'test', messages: [{ role: 'user', content: 'hello' }], ...overrides });
const makeResult = (overrides = {}) =>
  ScenarioResultSchema.parse({ scenarioName: 'test', ...overrides });

describe('validate', () => {
  it('passes valid scenario', () => {
    const scenario = makeScenario({
      expected_calls: [{ name: 'Read', call_type: 'tool' }],
      context_budget: { max_turns: 5 },
    });
    const result = makeResult({
      actualCalls: [{ name: 'Read', callType: 'tool' }],
      turns: 1,
    });
    const validated = validate(scenario, result);
    expect(validated.verdict).toBe(Verdict.PASS);
    expect(validated.failures).toHaveLength(0);
  });

  it('fails scenario with missing + forbidden', () => {
    const scenario = makeScenario({
      expected_calls: [{ name: 'Read', call_type: 'tool' }],
      forbidden_calls: [{ name: 'Write', call_type: 'tool' }],
    });
    const result = makeResult({
      actualCalls: [{ name: 'Write', callType: 'tool' }],
    });
    const validated = validate(scenario, result);
    expect(validated.verdict).toBe(Verdict.FAIL);
    expect(validated.failures).toHaveLength(2);
  });

  it('preserves ERROR verdict', () => {
    const scenario = makeScenario();
    const result = makeResult({ verdict: Verdict.ERROR, error: 'API error' });
    const validated = validate(scenario, result);
    expect(validated.verdict).toBe(Verdict.ERROR);
  });
});
