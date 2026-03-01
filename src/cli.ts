import 'dotenv/config';
import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';

import { loadScenario, loadScenarios } from './scenario/loader.js';
import { Verdict, type Scenario, type ScenarioResult } from './scenario/models.js';
import { CliRunner } from './runner/cli-runner.js';
import { validate } from './validator/validate.js';
import { analyze } from './analyzer/context-analyzer.js';
import { printResult, printSummary } from './reporter/terminal-reporter.js';
import { buildReport, saveReport } from './reporter/json-reporter.js';
import { Logger } from './logger/logger.js';
import type { ContextReport } from './analyzer/types.js';

const program = new Command();

program
  .name('agent-harness')
  .description('에이전트/스킬 호출 검증 및 컨텍스트 윈도우 효율성 테스트')
  .argument('<path>', '시나리오 YAML 파일 또는 디렉토리 경로')
  .option('--model <model>', '모든 시나리오에 적용할 모델 (시나리오 설정 오버라이드)')
  .option('-v, --verbose', '각 시나리오 상세 결과 출력')
  .action(async (scenarioPath: string, options: Record<string, unknown>) => {
    const p = path.resolve(scenarioPath);

    let scenarios;
    try {
      const stat = fs.statSync(p);
      if (stat.isFile()) {
        scenarios = [loadScenario(p)];
      } else if (stat.isDirectory()) {
        scenarios = loadScenarios(p);
      } else {
        console.error(`오류: '${scenarioPath}'을(를) 찾을 수 없습니다`);
        process.exit(1);
      }
    } catch {
      console.error(`오류: '${scenarioPath}'을(를) 찾을 수 없습니다`);
      process.exit(1);
    }

    if (scenarios.length === 0) {
      console.error('로드된 시나리오가 없습니다');
      process.exit(1);
    }

    // Model override
    if (options.model) {
      scenarios = scenarios.map((s) => ({ ...s, model: options.model as string }));
    }

    const logger = new Logger(options.verbose ? 'verbose' : 'normal');
    const runStartMs = Date.now();
    const allResults: Array<[ScenarioResult, ContextReport | null]> = [];

    for (let i = 0; i < scenarios.length; i++) {
      const scenario = scenarios[i];
      logger.scenarioStart(scenario.name, i + 1, scenarios.length);
      const scenarioStartMs = Date.now();

      const runner = new CliRunner({ logger });
      let result = await runner.run(scenario);
      result = validate(scenario, result);
      const ctxReport = analyze(result);
      allResults.push([result, ctxReport]);

      logger.scenarioEnd(scenario.name, result.verdict, Date.now() - scenarioStartMs);

      if (options.verbose) {
        printResult(result, ctxReport);
      }
    }

    printSummary(allResults);

    // JSON 결과 저장
    const report = buildReport(allResults, runStartMs);
    const savedPath = saveReport(report, 'results');
    logger.info(`결과 저장: ${savedPath}`);

    const hasFailure = allResults.some(([r]) => r.verdict !== Verdict.PASS);
    process.exit(hasFailure ? 1 : 0);
  });

program.parse();
