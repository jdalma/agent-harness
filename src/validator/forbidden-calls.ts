import type { Scenario, ScenarioResult, ValidationFailure } from '../scenario/models.js';

export function validateForbiddenCalls(scenario: Scenario, result: ScenarioResult): ValidationFailure[] {
  const failures: ValidationFailure[] = [];
  for (const forbidden of scenario.forbiddenCalls) {
    for (const call of result.actualCalls) {
      if (call.callType === forbidden.callType && call.name === forbidden.name) {
        failures.push({
          rule: 'forbidden_call',
          message: `금지된 ${forbidden.callType} '${forbidden.name}'이(가) 호출되었습니다. 사유: ${forbidden.reason}`,
          expected: forbidden,
          actual: call,
        });
      }
    }
  }
  return failures;
}
