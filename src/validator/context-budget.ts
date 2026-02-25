import { computeTotalTokens, type Scenario, type ScenarioResult, type ValidationFailure } from '../scenario/models.js';

export function validateContextBudget(scenario: Scenario, result: ScenarioResult): ValidationFailure[] {
  const failures: ValidationFailure[] = [];
  const budget = scenario.contextBudget;
  const usage = result.tokenUsage;

  if (budget.maxInputTokens && usage.inputTokens > budget.maxInputTokens) {
    failures.push({
      rule: 'context_budget_input',
      message: `입력 토큰 예산 초과: ${usage.inputTokens} > ${budget.maxInputTokens}`,
      expected: budget.maxInputTokens,
      actual: usage.inputTokens,
    });
  }

  if (budget.maxOutputTokens && usage.outputTokens > budget.maxOutputTokens) {
    failures.push({
      rule: 'context_budget_output',
      message: `출력 토큰 예산 초과: ${usage.outputTokens} > ${budget.maxOutputTokens}`,
      expected: budget.maxOutputTokens,
      actual: usage.outputTokens,
    });
  }

  const totalTokens = computeTotalTokens(usage);
  if (budget.maxTotalTokens && totalTokens > budget.maxTotalTokens) {
    failures.push({
      rule: 'context_budget_total',
      message: `총 토큰 예산 초과: ${totalTokens} > ${budget.maxTotalTokens}`,
      expected: budget.maxTotalTokens,
      actual: totalTokens,
    });
  }

  if (budget.maxTurns && result.turns > budget.maxTurns) {
    failures.push({
      rule: 'context_budget_turns',
      message: `턴 수 예산 초과: ${result.turns} > ${budget.maxTurns}`,
      expected: budget.maxTurns,
      actual: result.turns,
    });
  }

  return failures;
}
