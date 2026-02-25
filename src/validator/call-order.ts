import type { ScenarioResult, ValidationFailure } from '../scenario/models.js';

export function validateCallOrder(expectedOrder: string[], result: ScenarioResult): ValidationFailure[] {
  const failures: ValidationFailure[] = [];
  const actualNames = result.actualCalls.map((c) => c.name);
  let lastIdx = -1;

  for (const name of expectedOrder) {
    let found = false;
    for (let i = 0; i < actualNames.length; i++) {
      if (actualNames[i] === name && i > lastIdx) {
        lastIdx = i;
        found = true;
        break;
      }
    }
    if (!found) {
      failures.push({
        rule: 'call_order',
        message: `호출 순서 위반: '${name}'이(가) 기대한 순서에서 발견되지 않았습니다`,
        expected: expectedOrder,
        actual: actualNames,
      });
      break;
    }
  }

  return failures;
}
