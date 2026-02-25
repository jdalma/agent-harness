import type { ActualCall, ExpectedCall, Scenario, ScenarioResult, ValidationFailure } from '../scenario/models.js';

function matchCall(expected: ExpectedCall, actualCalls: readonly ActualCall[]): ActualCall | null {
  for (const call of actualCalls) {
    if (call.callType !== expected.callType) continue;
    if (call.name !== expected.name) continue;
    if (expected.argsContain) {
      const allMatch = Object.entries(expected.argsContain).every(
        ([k, v]) => call.input[k] === v,
      );
      if (!allMatch) continue;
    }
    return call;
  }
  return null;
}

export function validateExpectedCalls(scenario: Scenario, result: ScenarioResult): ValidationFailure[] {
  const failures: ValidationFailure[] = [];
  for (const expected of scenario.expectedCalls) {
    const matched = matchCall(expected, result.actualCalls);
    if (matched === null && expected.required) {
      failures.push({
        rule: 'expected_call',
        message: `기대한 ${expected.callType} '${expected.name}'이(가) 호출되지 않았습니다`,
        expected,
        actual: result.actualCalls,
      });
    }
  }
  return failures;
}
