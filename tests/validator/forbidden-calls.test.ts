import { describe, it, expect } from 'vitest';
import { validateForbiddenCalls } from '../../src/validator/forbidden-calls.js';
import { ScenarioSchema, ScenarioResultSchema } from '../../src/scenario/models.js';

const makeScenario = (overrides = {}) =>
  ScenarioSchema.parse({ name: 'test', messages: [{ role: 'user', content: 'hello' }], ...overrides });
const makeResult = (overrides = {}) =>
  ScenarioResultSchema.parse({ scenarioName: 'test', ...overrides });

describe('validateForbiddenCalls', () => {
  it('passes when forbidden not called', () => {
    const scenario = makeScenario({
      forbidden_calls: [{ name: 'Write', call_type: 'tool', reason: '읽기 전용' }],
    });
    const result = makeResult({
      actualCalls: [{ name: 'Read', callType: 'tool' }],
    });
    expect(validateForbiddenCalls(scenario, result)).toHaveLength(0);
  });

  it('fails when forbidden called', () => {
    const scenario = makeScenario({
      forbidden_calls: [{ name: 'Write', call_type: 'tool', reason: '읽기 전용' }],
    });
    const result = makeResult({
      actualCalls: [{ name: 'Write', callType: 'tool' }],
    });
    const failures = validateForbiddenCalls(scenario, result);
    expect(failures).toHaveLength(1);
    expect(failures[0].message).toContain('읽기 전용');
  });
});
