import { describe, it, expect } from 'vitest';
import { analyze } from '../../src/analyzer/context-analyzer.js';
import { ScenarioResultSchema } from '../../src/scenario/models.js';

const makeResult = (overrides = {}) =>
  ScenarioResultSchema.parse({ scenarioName: 'test', ...overrides });

describe('analyze', () => {
  it('computes basic analysis', () => {
    const result = makeResult({
      tokenUsage: { inputTokens: 1000, outputTokens: 500 },
      turns: 2,
      actualCalls: [
        { name: 'Read', callType: 'tool', input: { file_path: 'a.py' } },
        { name: 'Grep', callType: 'tool', input: { pattern: 'def' } },
      ],
    });
    const report = analyze(result);
    expect(report.totalTokens).toBe(1500);
    expect(report.turns).toBe(2);
    expect(report.tokensPerTurn).toBe(750);
    expect(report.uniqueToolsUsed).toBe(2);
    expect(report.totalToolCalls).toBe(2);
    expect(report.redundantCalls).toBe(0);
  });

  it('detects redundant calls', () => {
    const result = makeResult({
      tokenUsage: { inputTokens: 2000, outputTokens: 1000 },
      turns: 3,
      actualCalls: [
        { name: 'Read', callType: 'tool', input: { file_path: 'a.py' } },
        { name: 'Read', callType: 'tool', input: { file_path: 'a.py' } },
        { name: 'Read', callType: 'tool', input: { file_path: 'b.py' } },
      ],
    });
    const report = analyze(result);
    expect(report.redundantCalls).toBe(1);
    expect(report.warnings.some((w) => w.includes('중복'))).toBe(true);
  });

  it('warns on high token usage', () => {
    const result = makeResult({
      tokenUsage: { inputTokens: 50000, outputTokens: 10000 },
      turns: 3,
      actualCalls: [],
    });
    const report = analyze(result);
    expect(report.tokensPerTurn).toBe(20000);
    expect(report.warnings.some((w) => w.includes('토큰'))).toBe(true);
  });

  it('efficiency score in range', () => {
    const result = makeResult({
      tokenUsage: { inputTokens: 1000, outputTokens: 500 },
      turns: 1,
      actualCalls: [{ name: 'Read', callType: 'tool', input: { file_path: 'a.py' } }],
    });
    const report = analyze(result);
    expect(report.efficiencyScore).toBeGreaterThanOrEqual(0);
    expect(report.efficiencyScore).toBeLessThanOrEqual(1);
  });

  it('computes cache hit rate', () => {
    const result = makeResult({
      tokenUsage: { inputTokens: 1000, outputTokens: 500, cacheReadInputTokens: 800 },
      turns: 1,
      actualCalls: [],
    });
    const report = analyze(result);
    expect(report.cacheHitRate).toBeGreaterThan(0.4);
  });
});
