import { describe, it, expect } from 'vitest';
import { validateCallOrder } from '../../src/validator/call-order.js';
import { ScenarioResultSchema } from '../../src/scenario/models.js';

const makeResult = (overrides = {}) =>
  ScenarioResultSchema.parse({ scenarioName: 'test', ...overrides });

describe('validateCallOrder', () => {
  it('passes with correct order', () => {
    const result = makeResult({
      actualCalls: [
        { name: 'Read', callType: 'tool', turn: 0 },
        { name: 'Grep', callType: 'tool', turn: 1 },
        { name: 'Edit', callType: 'tool', turn: 2 },
      ],
    });
    expect(validateCallOrder(['Read', 'Grep', 'Edit'], result)).toHaveLength(0);
  });

  it('fails with wrong order', () => {
    const result = makeResult({
      actualCalls: [
        { name: 'Edit', callType: 'tool', turn: 0 },
        { name: 'Read', callType: 'tool', turn: 1 },
      ],
    });
    expect(validateCallOrder(['Read', 'Edit'], result)).toHaveLength(1);
  });
});
