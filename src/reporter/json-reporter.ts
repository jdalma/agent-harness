import fs from 'node:fs';
import path from 'node:path';
import type { ScenarioResult, TokenUsage, ActualCall, ValidationFailure } from '../scenario/models.js';
import { Verdict } from '../scenario/models.js';
import type { ContextReport } from '../analyzer/types.js';

export interface RunReport {
  meta: {
    runAt: string;
    durationMs: number;
    totalScenarios: number;
    pass: number;
    fail: number;
    error: number;
  };
  results: Array<{
    scenario: string;
    verdict: string;
    turns: number;
    tokenUsage: TokenUsage;
    failures: ValidationFailure[];
    error: string | null;
    actualCalls: ActualCall[];
    contextReport: ContextReport | null;
  }>;
}

export function buildReport(
  results: Array<[ScenarioResult, ContextReport | null]>,
  startMs: number,
): RunReport {
  let pass = 0;
  let fail = 0;
  let error = 0;

  for (const [r] of results) {
    if (r.verdict === Verdict.PASS) pass++;
    else if (r.verdict === Verdict.FAIL) fail++;
    else error++;
  }

  return {
    meta: {
      runAt: new Date().toISOString(),
      durationMs: Date.now() - startMs,
      totalScenarios: results.length,
      pass,
      fail,
      error,
    },
    results: results.map(([r, ctx]) => ({
      scenario: r.scenarioName,
      verdict: r.verdict,
      turns: r.turns,
      tokenUsage: r.tokenUsage,
      failures: r.failures,
      error: r.error,
      actualCalls: r.actualCalls,
      contextReport: ctx,
    })),
  };
}

export function saveReport(report: RunReport, outputDir: string): string {
  fs.mkdirSync(outputDir, { recursive: true });
  const timestamp = report.meta.runAt.replace(/:/g, '-');
  const filename = `${timestamp}.json`;
  const filePath = path.join(outputDir, filename);
  fs.writeFileSync(filePath, JSON.stringify(report, null, 2), 'utf8');
  return filePath;
}
