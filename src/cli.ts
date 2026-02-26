import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';

import { loadScenario, loadScenarios } from './scenario/loader.js';
import { Verdict, type Scenario, type ScenarioResult } from './scenario/models.js';
import { ScenarioRunner } from './runner/scenario-runner.js';
import { AgentSdkRunner } from './runner/agent-sdk-runner.js';
import type { IScenarioRunner } from './runner/types.js';
import { validate } from './validator/validate.js';
import { analyze } from './analyzer/context-analyzer.js';
import { loadProjectContext, injectContext } from './analyzer/context-loader.js';
import { ToolExecutor } from './executor/tool-executor.js';
import { printResult, printSummary } from './reporter/terminal-reporter.js';
import type { ContextReport } from './analyzer/types.js';

function createRunner(
  scenario: Scenario,
  cliRunnerOverride: string | undefined,
  toolExecutor: ToolExecutor | null,
): IScenarioRunner {
  const runnerType = cliRunnerOverride ?? scenario.runner ?? 'messages-api';

  if (runnerType === 'agent-sdk') {
    const sdkOpts: Record<string, unknown> = {};
    if (scenario.agentSdkOptions) {
      if (scenario.agentSdkOptions.cwd) sdkOpts.cwd = scenario.agentSdkOptions.cwd;
      if (scenario.agentSdkOptions.settingSources) sdkOpts.settingSources = scenario.agentSdkOptions.settingSources;
      if (scenario.agentSdkOptions.permissionMode) sdkOpts.permissionMode = scenario.agentSdkOptions.permissionMode;
      if (scenario.agentSdkOptions.allowedTools) sdkOpts.allowedTools = scenario.agentSdkOptions.allowedTools;
      if (scenario.agentSdkOptions.disallowedTools) sdkOpts.disallowedTools = scenario.agentSdkOptions.disallowedTools;
    }
    if (scenario.systemPrompt) sdkOpts.systemPrompt = scenario.systemPrompt;
    return new AgentSdkRunner({ sdkOptions: sdkOpts });
  }

  return new ScenarioRunner({
    toolExecutor: toolExecutor ?? undefined,
  });
}

const program = new Command();

program
  .name('agent-harness')
  .description('에이전트/스킬 호출 검증 및 컨텍스트 윈도우 효율성 테스트')
  .argument('<path>', '시나리오 YAML 파일 또는 디렉토리 경로')
  .option('--model <model>', '모든 시나리오에 적용할 모델 (시나리오 설정 오버라이드)')
  .option('--runner <type>', '런너 유형 오버라이드 (messages-api | agent-sdk)')
  .option('--project <dir>', '프로젝트 디렉토리 경로 (자동 컨텍스트 로드 및 실제 도구 실행)')
  .option('--execute-tools', '실제 도구 실행 모드 활성화 (--project 필요)')
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

    // Project context
    if (options.project) {
      const projectDir = path.resolve(options.project as string);
      if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
        console.error(`오류: 프로젝트 경로를 찾을 수 없습니다: '${options.project}'`);
        process.exit(1);
      }
      const projectContext = loadProjectContext(projectDir);
      scenarios = scenarios.map((s) => {
        const injected = injectContext(s, projectContext);
        if (!injected.projectPath) {
          return { ...injected, projectPath: projectDir };
        }
        return injected;
      });
    }

    // Tool executor (Messages API runner only)
    let toolExecutor: ToolExecutor | null = null;
    if (options.executeTools) {
      const projectForExec = options.project as string | undefined ??
        scenarios.find((s) => s.projectPath)?.projectPath ?? null;
      if (projectForExec) {
        toolExecutor = new ToolExecutor(projectForExec);
      } else {
        console.error(
          '경고: --execute-tools를 사용하려면 --project 또는 시나리오에 project_path를 지정해야 합니다',
        );
      }
    }

    const allResults: Array<[ScenarioResult, ContextReport | null]> = [];

    for (const scenario of scenarios) {
      const runner = createRunner(
        scenario,
        options.runner as string | undefined,
        toolExecutor,
      );
      let result = await runner.run(scenario);
      result = validate(scenario, result);
      const ctxReport = analyze(result);
      allResults.push([result, ctxReport]);

      if (options.verbose) {
        printResult(result, ctxReport);
      }
    }

    printSummary(allResults);

    const hasFailure = allResults.some(([r]) => r.verdict !== Verdict.PASS);
    process.exit(hasFailure ? 1 : 0);
  });

program.parse();
