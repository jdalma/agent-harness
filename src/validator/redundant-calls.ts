import type { ScenarioResult, ValidationFailure } from '../scenario/models.js';

export function validateNoRedundantCalls(
  result: ScenarioResult,
  dedupKeys?: string[],
): ValidationFailure[] {
  const failures: ValidationFailure[] = [];
  const seen = new Map<string, number[]>();

  for (let i = 0; i < result.actualCalls.length; i++) {
    const call = result.actualCalls[i];
    if (dedupKeys && !dedupKeys.includes(call.name)) continue;

    const sortedEntries = Object.entries(call.input).sort(([a], [b]) => a.localeCompare(b));
    const key = `${call.callType}:${call.name}:${JSON.stringify(sortedEntries)}`;

    const indices = seen.get(key);
    if (indices) {
      indices.push(i);
    } else {
      seen.set(key, [i]);
    }
  }

  for (const [key, indices] of seen) {
    if (indices.length > 1) {
      const toolName = key.split(':')[1];
      failures.push({
        rule: 'redundant_call',
        message: `중복 호출 감지: ${toolName}이(가) ${indices.length}회 동일 인자로 호출됨 (인덱스: ${JSON.stringify(indices)})`,
        expected: '1회 호출',
        actual: `${indices.length}회 호출`,
      });
    }
  }

  return failures;
}
