import { describe, it, expect } from 'vitest';
import { validateExpectedCalls } from '../../src/validator/expected-calls.js';
import { ScenarioSchema, ScenarioResultSchema } from '../../src/scenario/models.js';

const makeScenario = (overrides = {}) =>
  ScenarioSchema.parse({ name: 'test', messages: [{ role: 'user', content: 'hello' }], ...overrides });
const makeResult = (overrides = {}) =>
  ScenarioResultSchema.parse({ scenarioName: 'test', ...overrides });

describe('validateExpectedCalls', () => {
  it('passes when tool called', () => {
    const scenario = makeScenario({
      expected_calls: [{ name: 'Read', call_type: 'tool', required: true }],
    });
    const result = makeResult({
      actualCalls: [{ name: 'Read', callType: 'tool', input: { file_path: 'a.py' } }],
    });
    expect(validateExpectedCalls(scenario, result)).toHaveLength(0);
  });

  it('fails when required tool missing', () => {
    const scenario = makeScenario({
      expected_calls: [{ name: 'Read', call_type: 'tool', required: true }],
    });
    const result = makeResult({
      actualCalls: [{ name: 'Grep', callType: 'tool' }],
    });
    const failures = validateExpectedCalls(scenario, result);
    expect(failures).toHaveLength(1);
    expect(failures[0].message).toContain('Read');
  });

  it('passes when agent called', () => {
    const scenario = makeScenario({
      expected_calls: [{ name: 'Explore', call_type: 'agent', required: true }],
    });
    const result = makeResult({
      actualCalls: [{ name: 'Explore', callType: 'agent', input: { prompt: '...' } }],
    });
    expect(validateExpectedCalls(scenario, result)).toHaveLength(0);
  });

  it('passes when args_contain match', () => {
    const scenario = makeScenario({
      expected_calls: [{
        name: 'Read', call_type: 'tool', required: true,
        args_contain: { file_path: 'src/main.py' },
      }],
    });
    const result = makeResult({
      actualCalls: [{ name: 'Read', callType: 'tool', input: { file_path: 'src/main.py', limit: 100 } }],
    });
    expect(validateExpectedCalls(scenario, result)).toHaveLength(0);
  });

  it('fails when args mismatch', () => {
    const scenario = makeScenario({
      expected_calls: [{
        name: 'Read', call_type: 'tool', required: true,
        args_contain: { file_path: 'src/main.py' },
      }],
    });
    const result = makeResult({
      actualCalls: [{ name: 'Read', callType: 'tool', input: { file_path: 'src/other.py' } }],
    });
    expect(validateExpectedCalls(scenario, result)).toHaveLength(1);
  });

  it('skips optional calls', () => {
    const scenario = makeScenario({
      expected_calls: [{ name: 'Grep', call_type: 'tool', required: false }],
    });
    const result = makeResult({ actualCalls: [] });
    expect(validateExpectedCalls(scenario, result)).toHaveLength(0);
  });
});
