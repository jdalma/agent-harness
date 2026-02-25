import { describe, it, expect } from 'vitest';
import { validateNoRedundantCalls } from '../../src/validator/redundant-calls.js';
import { ScenarioResultSchema } from '../../src/scenario/models.js';

const makeResult = (overrides = {}) =>
  ScenarioResultSchema.parse({ scenarioName: 'test', ...overrides });

describe('validateNoRedundantCalls', () => {
  it('passes with no duplicates', () => {
    const result = makeResult({
      actualCalls: [
        { name: 'Read', callType: 'tool', input: { file_path: 'a.py' } },
        { name: 'Read', callType: 'tool', input: { file_path: 'b.py' } },
      ],
    });
    expect(validateNoRedundantCalls(result)).toHaveLength(0);
  });

  it('fails with duplicate call', () => {
    const result = makeResult({
      actualCalls: [
        { name: 'Read', callType: 'tool', input: { file_path: 'a.py' } },
        { name: 'Read', callType: 'tool', input: { file_path: 'a.py' } },
      ],
    });
    const failures = validateNoRedundantCalls(result);
    expect(failures).toHaveLength(1);
    expect(failures[0].message).toContain('중복');
  });
});
