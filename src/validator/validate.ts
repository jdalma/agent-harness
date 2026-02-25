import { Verdict, type Scenario, type ScenarioResult, type ValidationFailure } from '../scenario/models.js';
import { validateExpectedCalls } from './expected-calls.js';
import { validateForbiddenCalls } from './forbidden-calls.js';
import { validateContextBudget } from './context-budget.js';
import { validateNoRedundantCalls } from './redundant-calls.js';

export function validate(scenario: Scenario, result: ScenarioResult): ScenarioResult {
  if (result.verdict === Verdict.ERROR) return result;

  const allFailures: ValidationFailure[] = [
    ...validateExpectedCalls(scenario, result),
    ...validateForbiddenCalls(scenario, result),
    ...validateContextBudget(scenario, result),
    ...validateNoRedundantCalls(result),
  ];

  return {
    ...result,
    failures: allFailures,
    verdict: allFailures.length > 0 ? Verdict.FAIL : Verdict.PASS,
  };
}
