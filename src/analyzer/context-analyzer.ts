import { computeTotalTokens, computeCacheHitRate, type ActualCall, type ScenarioResult } from '../scenario/models.js';
import type { ContextReport } from './types.js';

function countRedundantCalls(calls: readonly ActualCall[]): number {
  const seen = new Set<string>();
  let duplicates = 0;
  for (const call of calls) {
    const sortedEntries = Object.entries(call.input).sort(([a], [b]) => a.localeCompare(b));
    const key = `${call.callType}:${call.name}:${JSON.stringify(sortedEntries)}`;
    if (seen.has(key)) {
      duplicates++;
    } else {
      seen.add(key);
    }
  }
  return duplicates;
}

function computeEfficiency(report: ContextReport): number {
  const scores: number[] = [];

  // 1) 중복 호출 페널티
  if (report.totalToolCalls > 0) {
    scores.push(1.0 - report.redundantCalls / report.totalToolCalls);
  } else {
    scores.push(1.0);
  }

  // 2) 캐시 적중률 보너스
  scores.push(Math.min(report.cacheHitRate + 0.5, 1.0));

  // 3) 턴당 토큰 효율
  if (report.turns > 0) {
    const tpt = report.tokensPerTurn;
    if (tpt <= 5000) scores.push(1.0);
    else if (tpt <= 20000) scores.push(1.0 - (tpt - 5000) / 15000);
    else scores.push(0.0);
  } else {
    scores.push(1.0);
  }

  return scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
}

export function analyze(result: ScenarioResult): ContextReport {
  const usage = result.tokenUsage;
  const totalTokens = computeTotalTokens(usage);
  const cacheHitRate = computeCacheHitRate(usage);

  const report: ContextReport = {
    totalInputTokens: usage.inputTokens,
    totalOutputTokens: usage.outputTokens,
    totalTokens,
    turns: result.turns,
    tokensPerTurn: result.turns > 0 ? totalTokens / result.turns : 0,
    cacheHitRate,
    redundantCalls: countRedundantCalls(result.actualCalls),
    uniqueToolsUsed: new Set(result.actualCalls.map((c) => c.name)).size,
    totalToolCalls: result.actualCalls.length,
    toolCallRatio: result.turns > 0 ? result.actualCalls.length / result.turns : 0,
    efficiencyScore: 0,
    warnings: [],
  };

  // 경고 생성
  if (report.redundantCalls > 0) {
    report.warnings.push(
      `중복 도구 호출 ${report.redundantCalls}건 감지 - 컨텍스트 윈도우 낭비 가능`,
    );
  }
  if (report.tokensPerTurn > 10000) {
    report.warnings.push(
      `턴당 평균 ${Math.round(report.tokensPerTurn)} 토큰 사용 - 컨텍스트 윈도우 사용량이 높음`,
    );
  }
  if (report.turns > 5 && report.totalToolCalls < 2) {
    report.warnings.push('여러 턴을 사용했지만 도구 호출이 거의 없음 - 불필요한 대화 턴 가능');
  }
  if (report.cacheHitRate < 0.1 && usage.inputTokens > 10000) {
    report.warnings.push('캐시 적중률이 낮음 - 프롬프트 캐싱 활용 검토 필요');
  }

  report.efficiencyScore = computeEfficiency(report);
  return report;
}
