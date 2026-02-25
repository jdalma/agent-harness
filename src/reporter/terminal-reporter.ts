import chalk from 'chalk';
import Table from 'cli-table3';
import { computeTotalTokens, Verdict, type ScenarioResult } from '../scenario/models.js';
import type { ContextReport } from '../analyzer/types.js';

function verdictLabel(v: string): string {
  if (v === Verdict.PASS) return chalk.bold.green('PASS');
  if (v === Verdict.FAIL) return chalk.bold.red('FAIL');
  return chalk.bold.yellow('ERROR');
}

export function printResult(
  result: ScenarioResult,
  ctxReport?: ContextReport,
): void {
  const header = `${chalk.bold(result.scenarioName)}  ${verdictLabel(result.verdict)}`;
  const lines: string[] = [];

  // 도구 호출 요약
  if (result.actualCalls.length > 0) {
    lines.push('[도구 호출]');
    for (const call of result.actualCalls) {
      lines.push(`  T${call.turn} ${call.callType}:${call.name}`);
    }
  }

  // 토큰 사용량
  const u = result.tokenUsage;
  const total = computeTotalTokens(u);
  lines.push(
    `\n[토큰] 입력=${u.inputTokens.toLocaleString()}  출력=${u.outputTokens.toLocaleString()}  합계=${total.toLocaleString()}  턴=${result.turns}`,
  );

  // 실패 상세
  if (result.failures.length > 0) {
    lines.push('\n[실패 상세]');
    for (const f of result.failures) {
      lines.push(`  [${f.rule}] ${f.message}`);
    }
  }

  if (result.error) {
    lines.push(`\n[오류] ${result.error}`);
  }

  // 컨텍스트 분석
  if (ctxReport) {
    lines.push(
      `\n[컨텍스트 효율] 점수=${ctxReport.efficiencyScore.toFixed(2)}  중복호출=${ctxReport.redundantCalls}  캐시적중=${(ctxReport.cacheHitRate * 100).toFixed(1)}%`,
    );
    for (const w of ctxReport.warnings) {
      lines.push(`  ! ${w}`);
    }
  }

  console.log(`\n┌─ ${header}`);
  console.log(`│ ${lines.join('\n│ ')}`);
  console.log('└───────────────────────────────────\n');
}

export function printSummary(
  results: Array<[ScenarioResult, ContextReport | null]>,
): void {
  const table = new Table({
    head: ['시나리오', '결과', '토큰(합계)', '턴', '도구호출', '효율점수', '실패'],
    colAligns: ['left', 'center', 'right', 'center', 'center', 'center', 'center'],
  });

  let passCount = 0;
  let failCount = 0;
  let errorCount = 0;

  for (const [result, ctxReport] of results) {
    if (result.verdict === Verdict.PASS) passCount++;
    else if (result.verdict === Verdict.FAIL) failCount++;
    else errorCount++;

    const eff = ctxReport ? ctxReport.efficiencyScore.toFixed(2) : '-';
    const total = computeTotalTokens(result.tokenUsage);

    table.push([
      result.scenarioName,
      verdictLabel(result.verdict),
      total.toLocaleString(),
      String(result.turns),
      String(result.actualCalls.length),
      eff,
      String(result.failures.length),
    ]);
  }

  console.log('\n' + table.toString());
  const total = passCount + failCount + errorCount;
  console.log(
    `\n총 ${total}건: ${chalk.green(`${passCount} PASS`)}  ${chalk.red(`${failCount} FAIL`)}  ${chalk.yellow(`${errorCount} ERROR`)}`,
  );
}
