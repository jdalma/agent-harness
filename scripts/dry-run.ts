/**
 * dry-run.ts — API 키 없이 시나리오 실행 흐름을 시뮬레이션합니다.
 * mock client가 "올바르게 행동하는 에이전트"를 흉내 내어
 * 시나리오 로드 → 실행 → 분류 → 검증 → 리포트 전체 파이프라인을 확인합니다.
 */
import { loadScenario } from '../src/scenario/loader.js';
import { ScenarioRunner } from '../src/runner/scenario-runner.js';
import { validate } from '../src/validator/validate.js';
import { analyze } from '../src/analyzer/context-analyzer.js';
import { printResult, printSummary } from '../src/reporter/terminal-reporter.js';
import type { ScenarioResult } from '../src/scenario/models.js';
import type { ContextReport } from '../src/analyzer/types.js';

// ─── Mock API Client ───────────────────────────────────────
// Claude API를 흉내 내는 가짜 클라이언트.
// 시나리오별로 "올바른 응답" 또는 "잘못된 응답"을 반환합니다.

function createMockClient(behavior: 'correct' | 'wrong') {
  let callCount = 0;

  return {
    messages: {
      create: async (params: Record<string, unknown>) => {
        callCount++;
        const scenario = (params as { messages: Array<{ content: string }> }).messages[0]?.content ?? '';

        // "올바른 행동" 시뮬레이션
        if (behavior === 'correct') {
          // 단일 도메인 질문 → Skill 도구로 domain-ask 호출
          return {
            id: `msg_mock_${callCount}`,
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'text',
                text: '도메인 질문을 감지했습니다. domain-ask 스킬을 호출합니다.',
              },
              {
                type: 'tool_use',
                id: `tool_${callCount}`,
                name: 'Skill',  // Skill 도구 호출
                input: {
                  skill: 'domain-ask',    // domain-ask 스킬
                  args: scenario,
                },
              },
            ],
            stop_reason: 'tool_use',
            usage: { input_tokens: 1500, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          };
        }

        // "잘못된 행동" 시뮬레이션 — 직접 Read로 도메인 파일을 읽으려 함
        return {
          id: `msg_mock_${callCount}`,
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: '도메인 파일을 직접 읽어보겠습니다.',
            },
            {
              type: 'tool_use',
              id: `tool_${callCount}`,
              name: 'Read',  // 직접 Read — 금지된 행위!
              input: {
                file_path: '.claude/domain/order/policies.md',
              },
            },
          ],
          stop_reason: 'tool_use',
          usage: { input_tokens: 1500, output_tokens: 150, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        };
      },
    },
  };
}

// ─── 시나리오 실행 ─────────────────────────────────────────

async function main() {
  const scenarioFiles = [
    'scenarios/domain/single_domain_order.yaml',
    'scenarios/domain/single_domain_payment.yaml',
  ];

  console.log('=' .repeat(60));
  console.log('  agent-harness dry-run (mock client, API 키 불필요)');
  console.log('=' .repeat(60));

  const allResults: Array<[ScenarioResult, ContextReport | null]> = [];

  for (const file of scenarioFiles) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`📂 시나리오 로드: ${file}`);

    // Step 1: YAML 로드 + Zod 파싱
    const scenario = loadScenario(file);
    console.log(`   name: ${scenario.name}`);
    console.log(`   model: ${scenario.model}`);
    console.log(`   messages: "${(scenario.messages[0] as { content: string }).content.slice(0, 50)}..."`);
    console.log(`   expected_calls: ${scenario.expectedCalls.map(c => `${c.callType}:${c.name}`).join(', ')}`);
    console.log(`   forbidden_calls: ${scenario.forbiddenCalls.map(c => `${c.callType}:${c.name}`).join(', ')}`);
    console.log(`   context_budget: max_total=${scenario.contextBudget.maxTotalTokens}, max_turns=${scenario.contextBudget.maxTurns}`);

    // === 올바른 행동 테스트 ===
    console.log(`\n   ✅ [올바른 행동 시뮬레이션]`);
    const correctRunner = new ScenarioRunner({
      client: createMockClient('correct') as never,
    });
    let correctResult = await correctRunner.run(scenario);
    console.log(`   → 실행 완료: ${correctResult.actualCalls.length}개 호출 감지`);
    for (const call of correctResult.actualCalls) {
      console.log(`     T${call.turn} ${call.callType}:${call.name} input=${JSON.stringify(call.input).slice(0, 80)}`);
    }

    // Step 3: 검증
    correctResult = validate(scenario, correctResult);
    console.log(`   → 검증 결과: ${correctResult.verdict} (실패 ${correctResult.failures.length}건)`);
    for (const f of correctResult.failures) {
      console.log(`     [${f.rule}] ${f.message}`);
    }

    // Step 4: 컨텍스트 분석
    const correctCtx = analyze(correctResult);
    console.log(`   → 효율 점수: ${correctCtx.efficiencyScore.toFixed(2)}`);

    // Step 5: 리포트
    printResult(correctResult, correctCtx);
    allResults.push([correctResult, correctCtx]);

    // === 잘못된 행동 테스트 ===
    console.log(`   ❌ [잘못된 행동 시뮬레이션]`);
    const wrongRunner = new ScenarioRunner({
      client: createMockClient('wrong') as never,
    });
    let wrongResult = await wrongRunner.run(scenario);
    console.log(`   → 실행 완료: ${wrongResult.actualCalls.length}개 호출 감지`);
    for (const call of wrongResult.actualCalls) {
      console.log(`     T${call.turn} ${call.callType}:${call.name} input=${JSON.stringify(call.input).slice(0, 80)}`);
    }

    wrongResult = validate(scenario, wrongResult);
    console.log(`   → 검증 결과: ${wrongResult.verdict} (실패 ${wrongResult.failures.length}건)`);
    for (const f of wrongResult.failures) {
      console.log(`     [${f.rule}] ${f.message}`);
    }

    const wrongCtx = analyze(wrongResult);
    printResult(wrongResult, wrongCtx);
    allResults.push([wrongResult, wrongCtx]);
  }

  // 전체 요약
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  전체 요약');
  console.log('═'.repeat(60));
  printSummary(allResults);
}

main().catch(console.error);
