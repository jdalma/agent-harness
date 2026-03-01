import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildReport, saveReport } from '../../src/reporter/json-reporter.js';
import { Verdict, type ScenarioResult } from '../../src/scenario/models.js';
import type { ContextReport } from '../../src/analyzer/types.js';

function makeResult(overrides: Partial<ScenarioResult> = {}): ScenarioResult {
  return {
    scenarioName: 'test-scenario',
    verdict: Verdict.PASS,
    actualCalls: [
      { name: 'Read', callType: 'tool', input: { file_path: 'a.ts' }, turn: 0, parentToolUseId: null },
    ],
    tokenUsage: {
      inputTokens: 1000,
      outputTokens: 500,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 100,
    },
    turns: 2,
    failures: [],
    error: null,
    rawResponses: [],
    ...overrides,
  };
}

function makeCtxReport(overrides: Partial<ContextReport> = {}): ContextReport {
  return {
    totalInputTokens: 1000,
    totalOutputTokens: 500,
    totalTokens: 1500,
    turns: 2,
    tokensPerTurn: 750,
    cacheHitRate: 0.09,
    redundantCalls: 0,
    uniqueToolsUsed: 1,
    totalToolCalls: 1,
    toolCallRatio: 0.5,
    efficiencyScore: 0.85,
    warnings: [],
    ...overrides,
  };
}

describe('buildReport', () => {
  it('meta에 올바른 집계를 포함한다', () => {
    const results: Array<[ScenarioResult, ContextReport | null]> = [
      [makeResult(), makeCtxReport()],
      [makeResult({ scenarioName: 'fail-scenario', verdict: Verdict.FAIL }), makeCtxReport()],
      [makeResult({ scenarioName: 'error-scenario', verdict: Verdict.ERROR }), null],
    ];

    const report = buildReport(results, Date.now() - 5000);

    expect(report.meta.totalScenarios).toBe(3);
    expect(report.meta.pass).toBe(1);
    expect(report.meta.fail).toBe(1);
    expect(report.meta.error).toBe(1);
    expect(report.meta.durationMs).toBeGreaterThanOrEqual(0);
    expect(report.meta.runAt).toBeTruthy();
  });

  it('results 배열에 시나리오 데이터를 포함한다', () => {
    const results: Array<[ScenarioResult, ContextReport | null]> = [
      [makeResult(), makeCtxReport()],
    ];

    const report = buildReport(results, Date.now());

    expect(report.results).toHaveLength(1);
    expect(report.results[0].scenario).toBe('test-scenario');
    expect(report.results[0].verdict).toBe('pass');
    expect(report.results[0].turns).toBe(2);
    expect(report.results[0].tokenUsage.inputTokens).toBe(1000);
    expect(report.results[0].actualCalls).toHaveLength(1);
    expect(report.results[0].contextReport).not.toBeNull();
    expect(report.results[0].contextReport!.efficiencyScore).toBe(0.85);
  });

  it('contextReport가 null인 경우도 처리한다', () => {
    const results: Array<[ScenarioResult, ContextReport | null]> = [
      [makeResult(), null],
    ];

    const report = buildReport(results, Date.now());

    expect(report.results[0].contextReport).toBeNull();
  });
});

describe('saveReport', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it('지정된 디렉토리에 JSON 파일을 생성한다', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-test-'));
    const outputDir = path.join(tmpDir, 'results');

    const report = buildReport(
      [[makeResult(), makeCtxReport()]],
      Date.now(),
    );

    const savedPath = saveReport(report, outputDir);

    expect(fs.existsSync(savedPath)).toBe(true);
    expect(savedPath).toContain(outputDir);
    expect(savedPath).toMatch(/\.json$/);

    const content = JSON.parse(fs.readFileSync(savedPath, 'utf8'));
    expect(content.meta.totalScenarios).toBe(1);
    expect(content.results).toHaveLength(1);
  });

  it('디렉토리가 없으면 자동 생성한다', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-test-'));
    const deepDir = path.join(tmpDir, 'nested', 'deep', 'results');

    const report = buildReport(
      [[makeResult(), makeCtxReport()]],
      Date.now(),
    );

    const savedPath = saveReport(report, deepDir);

    expect(fs.existsSync(savedPath)).toBe(true);
  });
});
