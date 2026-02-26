# Hybrid Agent SDK Integration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Messages API (unit/fast tests) + Agent SDK (integration/full-chain tests) 하이브리드 아키텍처 구현, 그리고 프로젝트 README.md 작성.

**Architecture:** `IScenarioRunner` 인터페이스로 두 런너를 추상화. 기존 `ScenarioRunner`(Messages API)는 그대로 유지, 새 `AgentSdkRunner`를 추가. 시나리오 YAML에 `runner` 필드로 선택. CLI에 `--runner` 플래그 추가. 기존 validator/analyzer/reporter는 변경 없이 재사용.

**Tech Stack:** TypeScript, @anthropic-ai/claude-agent-sdk, Zod, Vitest, Commander

---

## Task 1: IScenarioRunner 인터페이스 + ActualCall 확장

기존 `ScenarioRunner`를 인터페이스 뒤로 추상화하고, `ActualCall`에 `parentToolUseId` 추가.

**Files:**
- Create: `src/runner/types.ts` (기존 파일 수정 — 인터페이스 추가)
- Modify: `src/scenario/models.ts:146-152` (ActualCall에 parentToolUseId 추가)
- Modify: `src/runner/scenario-runner.ts:56` (implements IScenarioRunner)
- Modify: `src/runner/index.ts` (export 추가)
- Test: `tests/runner/scenario-runner.test.ts` (기존 테스트 통과 확인)

**Step 1: ActualCall 스키마에 parentToolUseId 추가**

`src/scenario/models.ts:146-152`에서:

```typescript
export const ActualCallSchema = z.object({
  name: z.string(),
  callType: z.string().default('tool'),
  input: z.record(z.unknown()).default({}),
  turn: z.number().default(0),
  parentToolUseId: z.string().nullable().default(null),
});
```

**Step 2: IScenarioRunner 인터페이스를 runner/types.ts에 추가**

`src/runner/types.ts` 끝에 추가:

```typescript
import type { Scenario, ScenarioResult } from '../scenario/models.js';

export interface IScenarioRunner {
  run(scenario: Scenario): Promise<ScenarioResult>;
}
```

**Step 3: ScenarioRunner에 implements 추가**

`src/runner/scenario-runner.ts:56`:

```typescript
import type { IScenarioRunner } from './types.js';

export class ScenarioRunner implements IScenarioRunner {
```

**Step 4: runner/index.ts에 export 추가**

기존 export 유지, IScenarioRunner가 types.ts에서 이미 re-export됨.

**Step 5: 기존 테스트 실행해서 통과 확인**

Run: `pnpm test`
Expected: 모든 기존 테스트 PASS (96개)

**Step 6: Commit**

```bash
git add src/scenario/models.ts src/runner/types.ts src/runner/scenario-runner.ts
git commit -m "refactor: add IScenarioRunner interface and parentToolUseId to ActualCall"
```

---

## Task 2: AgentSdkRunner 구현

Agent SDK의 `query()`를 사용하여 전체 도구 체인을 관찰하는 새 러너.

**Files:**
- Create: `src/runner/agent-sdk-runner.ts`
- Create: `tests/runner/agent-sdk-runner.test.ts`
- Modify: `src/runner/index.ts` (export 추가)

**Step 1: 테스트 작성**

`tests/runner/agent-sdk-runner.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { AgentSdkRunner } from '../../src/runner/agent-sdk-runner.js';
import { ScenarioSchema, Verdict } from '../../src/scenario/models.js';

// Mock SDKMessage 생성 헬퍼
function makeAssistantMessage(content: Array<{ type: string; name?: string; id?: string; input?: Record<string, unknown>; text?: string }>, parentToolUseId: string | null = null) {
  return {
    type: 'assistant' as const,
    uuid: 'uuid-1',
    session_id: 'session-1',
    parent_tool_use_id: parentToolUseId,
    message: {
      id: 'msg_1',
      content,
      model: 'claude-sonnet-4-20250514',
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 50 },
    },
  };
}

function makeResultMessage(overrides: Record<string, unknown> = {}) {
  return {
    type: 'result' as const,
    subtype: 'success' as const,
    uuid: 'uuid-r',
    session_id: 'session-1',
    duration_ms: 1000,
    duration_api_ms: 800,
    is_error: false,
    num_turns: 1,
    result: 'done',
    stop_reason: 'end_turn',
    total_cost_usd: 0.01,
    usage: { input_tokens: 200, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    modelUsage: {},
    permission_denials: [],
    ...overrides,
  };
}

const baseScenario = () =>
  ScenarioSchema.parse({
    name: 'sdk-test',
    messages: [{ role: 'user', content: 'hello' }],
    tools: [],
    context_budget: { max_turns: 5 },
  });

describe('AgentSdkRunner', () => {
  it('collects tool calls from assistant messages', async () => {
    const messages = [
      makeAssistantMessage([
        { type: 'tool_use', id: 'tu_1', name: 'Skill', input: { skill: 'domain-ask', args: 'test' } },
      ]),
      makeAssistantMessage([
        { type: 'text', text: 'Done' },
      ]),
      makeResultMessage({ num_turns: 2, usage: { input_tokens: 500, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }),
    ];

    const mockQuery = vi.fn().mockReturnValue((async function* () {
      for (const m of messages) yield m;
    })());

    const runner = new AgentSdkRunner({ queryFn: mockQuery });
    const result = await runner.run(baseScenario());

    expect(result.verdict).toBe(Verdict.PASS);
    expect(result.actualCalls).toHaveLength(1);
    expect(result.actualCalls[0].callType).toBe('skill');
    expect(result.actualCalls[0].name).toBe('domain-ask');
    expect(result.actualCalls[0].parentToolUseId).toBeNull();
  });

  it('tracks nested calls via parentToolUseId', async () => {
    const messages = [
      makeAssistantMessage([
        { type: 'tool_use', id: 'tu_1', name: 'Task', input: { subagent_type: 'domain-orchestrator', prompt: 'multi', description: 'multi' } },
      ]),
      // 서브에이전트 내부 호출 — parent_tool_use_id가 tu_1
      makeAssistantMessage([
        { type: 'tool_use', id: 'tu_2', name: 'Task', input: { subagent_type: 'order', prompt: 'check', description: 'check' } },
      ], 'tu_1'),
      makeResultMessage({ num_turns: 2 }),
    ];

    const mockQuery = vi.fn().mockReturnValue((async function* () {
      for (const m of messages) yield m;
    })());

    const runner = new AgentSdkRunner({ queryFn: mockQuery });
    const result = await runner.run(baseScenario());

    expect(result.actualCalls).toHaveLength(2);
    expect(result.actualCalls[0].name).toBe('domain-orchestrator');
    expect(result.actualCalls[0].parentToolUseId).toBeNull();
    expect(result.actualCalls[1].name).toBe('order');
    expect(result.actualCalls[1].parentToolUseId).toBe('tu_1');
  });

  it('handles error results', async () => {
    const messages = [
      {
        type: 'result' as const,
        subtype: 'error_during_execution' as const,
        uuid: 'uuid-r',
        session_id: 'session-1',
        duration_ms: 500,
        duration_api_ms: 400,
        is_error: true,
        num_turns: 0,
        stop_reason: null,
        total_cost_usd: 0.001,
        usage: { input_tokens: 50, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        modelUsage: {},
        permission_denials: [],
        errors: ['Authentication failed'],
      },
    ];

    const mockQuery = vi.fn().mockReturnValue((async function* () {
      for (const m of messages) yield m;
    })());

    const runner = new AgentSdkRunner({ queryFn: mockQuery });
    const result = await runner.run(baseScenario());

    expect(result.verdict).toBe(Verdict.ERROR);
    expect(result.error).toContain('Authentication failed');
  });

  it('extracts token usage from result message', async () => {
    const messages = [
      makeAssistantMessage([{ type: 'text', text: 'Hi' }]),
      makeResultMessage({
        num_turns: 1,
        usage: { input_tokens: 1000, output_tokens: 300, cache_creation_input_tokens: 50, cache_read_input_tokens: 200 },
      }),
    ];

    const mockQuery = vi.fn().mockReturnValue((async function* () {
      for (const m of messages) yield m;
    })());

    const runner = new AgentSdkRunner({ queryFn: mockQuery });
    const result = await runner.run(baseScenario());

    expect(result.tokenUsage.inputTokens).toBe(1000);
    expect(result.tokenUsage.outputTokens).toBe(300);
    expect(result.tokenUsage.cacheCreationInputTokens).toBe(50);
    expect(result.tokenUsage.cacheReadInputTokens).toBe(200);
    expect(result.turns).toBe(1);
  });
});
```

**Step 2: 테스트 실행해서 실패 확인**

Run: `pnpm test tests/runner/agent-sdk-runner.test.ts`
Expected: FAIL — AgentSdkRunner 모듈 없음

**Step 3: AgentSdkRunner 구현**

`src/runner/agent-sdk-runner.ts`:

```typescript
import {
  Verdict,
  type ActualCall,
  type Scenario,
  type ScenarioResult,
  type TokenUsage,
} from '../scenario/models.js';
import type { IScenarioRunner } from './types.js';
import { classifyCall } from './classify-call.js';

interface SDKAssistantMessage {
  type: 'assistant';
  uuid: string;
  session_id: string;
  parent_tool_use_id: string | null;
  message: {
    id: string;
    content: Array<{
      type: string;
      id?: string;
      name?: string;
      input?: Record<string, unknown>;
      text?: string;
    }>;
    model: string;
    stop_reason: string;
    usage: {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
}

interface SDKResultMessageSuccess {
  type: 'result';
  subtype: 'success';
  num_turns: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  total_cost_usd: number;
  duration_ms: number;
  [key: string]: unknown;
}

interface SDKResultMessageError {
  type: 'result';
  subtype: 'error_max_turns' | 'error_during_execution' | 'error_max_budget_usd' | 'error_max_structured_output_retries';
  num_turns: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  errors: string[];
  [key: string]: unknown;
}

type SDKResultMessage = SDKResultMessageSuccess | SDKResultMessageError;

type SDKMessage = SDKAssistantMessage | SDKResultMessage | { type: string; [key: string]: unknown };

export type QueryFn = (options: {
  prompt: string;
  options?: Record<string, unknown>;
}) => AsyncIterable<SDKMessage>;

export interface AgentSdkRunnerOptions {
  queryFn?: QueryFn;
  sdkOptions?: Record<string, unknown>;
}

export class AgentSdkRunner implements IScenarioRunner {
  private queryFn: QueryFn | null;
  private sdkOptions: Record<string, unknown>;

  constructor(options?: AgentSdkRunnerOptions) {
    this.queryFn = options?.queryFn ?? null;
    this.sdkOptions = options?.sdkOptions ?? {};
  }

  private async ensureQueryFn(): Promise<QueryFn> {
    if (this.queryFn) return this.queryFn;
    const mod = await import('@anthropic-ai/claude-agent-sdk');
    this.queryFn = mod.query as unknown as QueryFn;
    return this.queryFn;
  }

  async run(scenario: Scenario): Promise<ScenarioResult> {
    const allCalls: ActualCall[] = [];
    const rawResponses: Record<string, unknown>[] = [];
    let tokenUsage: TokenUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    };
    let turns = 0;
    let turnCounter = 0;

    try {
      const queryFn = await this.ensureQueryFn();

      const userMessage = scenario.messages[0] as { content: string };
      const prompt = typeof userMessage.content === 'string'
        ? userMessage.content
        : JSON.stringify(userMessage.content);

      const queryOptions: Record<string, unknown> = {
        ...this.sdkOptions,
        maxTurns: scenario.contextBudget.maxTurns ?? 10,
      };

      if (scenario.systemPrompt) {
        queryOptions.systemPrompt = scenario.systemPrompt;
      }
      if (scenario.model) {
        queryOptions.model = scenario.model;
      }

      const stream = queryFn({ prompt, options: queryOptions });

      for await (const message of stream) {
        if (message.type === 'assistant') {
          const assistantMsg = message as SDKAssistantMessage;
          const parentId = assistantMsg.parent_tool_use_id;

          for (const block of assistantMsg.message.content) {
            if (block.type === 'tool_use') {
              const [callType, logicalName] = classifyCall(
                block.name!,
                block.input ?? {},
              );
              allCalls.push({
                name: logicalName,
                callType,
                input: block.input ?? {},
                turn: turnCounter,
                parentToolUseId: parentId,
              });
            }
          }

          rawResponses.push({
            turn: turnCounter,
            type: 'assistant',
            stop_reason: assistantMsg.message.stop_reason,
            parent_tool_use_id: parentId,
            usage: {
              input_tokens: assistantMsg.message.usage.input_tokens,
              output_tokens: assistantMsg.message.usage.output_tokens,
            },
          });

          if (!parentId) {
            turnCounter++;
          }
        } else if (message.type === 'result') {
          const resultMsg = message as SDKResultMessage;

          tokenUsage = {
            inputTokens: resultMsg.usage.input_tokens,
            outputTokens: resultMsg.usage.output_tokens,
            cacheCreationInputTokens: resultMsg.usage.cache_creation_input_tokens ?? 0,
            cacheReadInputTokens: resultMsg.usage.cache_read_input_tokens ?? 0,
          };
          turns = resultMsg.num_turns;

          if (resultMsg.subtype !== 'success') {
            const errorMsg = resultMsg as SDKResultMessageError;
            return {
              scenarioName: scenario.name,
              verdict: Verdict.ERROR,
              actualCalls: allCalls,
              tokenUsage,
              turns,
              failures: [],
              error: errorMsg.errors?.join('; ') ?? `Agent SDK error: ${resultMsg.subtype}`,
              rawResponses,
            };
          }
        }
      }

      return {
        scenarioName: scenario.name,
        verdict: Verdict.PASS,
        actualCalls: allCalls,
        tokenUsage,
        turns,
        failures: [],
        error: null,
        rawResponses,
      };
    } catch (e) {
      return {
        scenarioName: scenario.name,
        verdict: Verdict.ERROR,
        actualCalls: allCalls,
        tokenUsage,
        turns,
        failures: [],
        error: e instanceof Error ? e.message : String(e),
        rawResponses,
      };
    }
  }
}
```

**Step 4: runner/index.ts에 export 추가**

```typescript
export * from './classify-call.js';
export * from './scenario-runner.js';
export * from './agent-sdk-runner.js';
export type * from './types.js';
```

**Step 5: 테스트 실행**

Run: `pnpm test tests/runner/agent-sdk-runner.test.ts`
Expected: ALL PASS

**Step 6: 전체 테스트 실행**

Run: `pnpm test`
Expected: ALL PASS (기존 96개 + 새 4개 = 100개)

**Step 7: Commit**

```bash
git add src/runner/agent-sdk-runner.ts tests/runner/agent-sdk-runner.test.ts src/runner/index.ts
git commit -m "feat: add AgentSdkRunner for integration testing with Claude Agent SDK"
```

---

## Task 3: 시나리오 스키마 확장

시나리오 YAML에 `runner`와 `agent_sdk_options` 필드 추가.

**Files:**
- Modify: `src/scenario/models.ts:83-121` (ScenarioSchema에 runner + agent_sdk_options 추가)
- Test: `tests/scenario/models.test.ts` (새 필드 파싱 테스트 추가)

**Step 1: 테스트 추가**

`tests/scenario/models.test.ts`에 추가:

```typescript
it('parses runner field with default messages-api', () => {
  const s = ScenarioSchema.parse({
    name: 'test',
    messages: [{ role: 'user', content: 'hello' }],
  });
  expect(s.runner).toBe('messages-api');
});

it('parses runner field as agent-sdk', () => {
  const s = ScenarioSchema.parse({
    name: 'test',
    runner: 'agent-sdk',
    messages: [{ role: 'user', content: 'hello' }],
    agent_sdk_options: {
      cwd: '/tmp/project',
      setting_sources: ['project'],
      permission_mode: 'bypassPermissions',
    },
  });
  expect(s.runner).toBe('agent-sdk');
  expect(s.agentSdkOptions).toEqual({
    cwd: '/tmp/project',
    settingSources: ['project'],
    permissionMode: 'bypassPermissions',
    allowedTools: null,
    disallowedTools: null,
  });
});

it('defaults agentSdkOptions to null when runner is messages-api', () => {
  const s = ScenarioSchema.parse({
    name: 'test',
    messages: [{ role: 'user', content: 'hello' }],
  });
  expect(s.agentSdkOptions).toBeNull();
});
```

**Step 2: 테스트 실패 확인**

Run: `pnpm test tests/scenario/models.test.ts`
Expected: FAIL

**Step 3: 스키마 수정**

`src/scenario/models.ts`에 AgentSdkOptionsSchema 추가 (ScenarioSchema 앞에):

```typescript
export const AgentSdkOptionsSchema = z
  .object({
    cwd: z.string().optional(),
    setting_sources: z.array(z.string()).optional(),
    settingSources: z.array(z.string()).optional(),
    permission_mode: z.string().optional(),
    permissionMode: z.string().optional(),
    allowed_tools: z.array(z.string()).nullable().optional(),
    allowedTools: z.array(z.string()).nullable().optional(),
    disallowed_tools: z.array(z.string()).nullable().optional(),
    disallowedTools: z.array(z.string()).nullable().optional(),
  })
  .transform((v) => ({
    cwd: v.cwd ?? null,
    settingSources: v.setting_sources ?? v.settingSources ?? ['project'],
    permissionMode: v.permission_mode ?? v.permissionMode ?? 'bypassPermissions',
    allowedTools: v.allowed_tools ?? v.allowedTools ?? null,
    disallowedTools: v.disallowed_tools ?? v.disallowedTools ?? null,
  }));
export type AgentSdkOptions = z.output<typeof AgentSdkOptionsSchema>;
```

ScenarioSchema의 `.object({...})`에 추가:

```typescript
runner: z.enum(['messages-api', 'agent-sdk']).default('messages-api'),
agent_sdk_options: AgentSdkOptionsSchema.optional(),
agentSdkOptions: AgentSdkOptionsSchema.optional(),
```

`.transform((v) => ({...}))`에 추가:

```typescript
runner: v.runner,
agentSdkOptions: v.runner === 'agent-sdk'
  ? (v.agent_sdk_options ?? v.agentSdkOptions ?? { cwd: null, settingSources: ['project'], permissionMode: 'bypassPermissions', allowedTools: null, disallowedTools: null })
  : null,
```

**Step 4: 테스트 통과 확인**

Run: `pnpm test tests/scenario/models.test.ts`
Expected: ALL PASS

**Step 5: 전체 테스트**

Run: `pnpm test`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add src/scenario/models.ts tests/scenario/models.test.ts
git commit -m "feat: add runner and agentSdkOptions fields to Scenario schema"
```

---

## Task 4: CLI --runner 플래그 + 런너 선택 로직

CLI에서 런너를 선택하고, 시나리오별 runner 필드에 따라 적절한 러너를 사용.

**Files:**
- Modify: `src/cli.ts` (--runner 옵션 추가, 런너 선택 로직)
- Test: 수동 테스트 (CLI 도움말 확인)

**Step 1: cli.ts 수정**

`src/cli.ts`에서 program 옵션에 추가:

```typescript
.option('--runner <type>', '런너 유형 오버라이드 (messages-api | agent-sdk)')
```

action 함수 내부에서 runner 생성 로직 수정:

```typescript
import { AgentSdkRunner } from './runner/agent-sdk-runner.js';
import type { IScenarioRunner } from './runner/types.js';

// 기존 runner 생성 부분을 교체:
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
```

for loop 내부 수정:

```typescript
for (const scenario of scenarios) {
  const runner = createRunner(scenario, options.runner as string | undefined, toolExecutor);
  let result = await runner.run(scenario);
  // ... validate, analyze, report (기존 로직 그대로)
}
```

**Step 2: 도움말 확인**

Run: `node --import tsx src/cli.ts --help`
Expected: `--runner <type>` 옵션 표시

**Step 3: Commit**

```bash
git add src/cli.ts
git commit -m "feat: add --runner CLI flag for selecting messages-api or agent-sdk runner"
```

---

## Task 5: Integration 시나리오 YAML 예제

Agent SDK 런너를 사용하는 시나리오 예제 작성.

**Files:**
- Create: `scenarios/integration/single_domain_order_e2e.yaml`
- Create: `scenarios/integration/multi_domain_order_payment_e2e.yaml`

**Step 1: 단일 도메인 E2E 시나리오**

`scenarios/integration/single_domain_order_e2e.yaml`:

```yaml
name: single_domain_order_e2e
description: |
  [Integration] Agent SDK로 실제 실행하여 단일 주문 도메인 질문이
  domain-ask 스킬 → order 에이전트로 라우팅되는 전체 체인을 검증합니다.
runner: agent-sdk

agent_sdk_options:
  setting_sources: [project]
  permission_mode: bypassPermissions

model: claude-sonnet-4-20250514
max_tokens: 4096

messages:
  - role: user
    content: "주문 취소 조건이 뭐야? 어떤 상태에서 취소가 가능한지 알려줘."

expected_calls:
  - name: domain-ask
    call_type: skill
    required: true

forbidden_calls:
  - name: domain-orchestrator
    call_type: agent
    reason: "단일 도메인 질문에 오케스트레이터 위임은 불필요"

context_budget:
  max_total_tokens: 100000
  max_turns: 10

tags:
  - integration
  - domain-routing
  - single-domain
  - order
  - e2e
```

**Step 2: 복수 도메인 E2E 시나리오**

`scenarios/integration/multi_domain_order_payment_e2e.yaml`:

```yaml
name: multi_domain_order_payment_e2e
description: |
  [Integration] Agent SDK로 실제 실행하여 주문+결제 복수 도메인 질문이
  domain-orchestrator → 개별 도메인 에이전트로 위임되는 전체 체인을 검증합니다.
runner: agent-sdk

agent_sdk_options:
  setting_sources: [project]
  permission_mode: bypassPermissions

model: claude-sonnet-4-20250514
max_tokens: 4096

messages:
  - role: user
    content: "주문에서 결제까지의 전체 플로우를 설명해줘. 결제 실패 시 주문은 어떻게 되는지도 포함해서."

expected_calls:
  - name: domain-orchestrator
    call_type: agent
    required: true

forbidden_calls:
  - name: domain-ask
    call_type: skill
    reason: "복수 도메인은 스킬이 아닌 오케스트레이터 경유 필수"

context_budget:
  max_total_tokens: 200000
  max_turns: 15

tags:
  - integration
  - domain-routing
  - multi-domain
  - order
  - payment
  - e2e
```

**Step 3: Commit**

```bash
git add scenarios/integration/
git commit -m "feat: add integration test scenarios using Agent SDK runner"
```

---

## Task 6: README.md 작성

프로젝트 아키텍처, 기술 구현, 테스트 범위/목적 문서화.

**Files:**
- Create: `README.md`

**Step 1: README.md 작성**

프로젝트 개요, 아키텍처 다이어그램, 모듈 설명, 시나리오 포맷, CLI 사용법, 테스트 구조를 포함하는 README.md를 작성.

내용 구성:
1. 프로젝트 개요 — 무엇을, 왜
2. 아키텍처 — 하이브리드 구조 다이어그램, 모듈별 역할
3. 빠른 시작 — 설치, unit 테스트, integration 테스트
4. 시나리오 YAML 포맷 — 필드 레퍼런스
5. 런너 — Messages API vs Agent SDK
6. 검증 규칙 — expected/forbidden/budget/redundant
7. 컨텍스트 분석 — 효율 점수, 경고
8. CLI 레퍼런스
9. 테스트 — 구조, 실행, 범위
10. 디렉토리 구조

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add comprehensive README with architecture, usage, and test documentation"
```

---

## Task 7: 최종 검증

**Step 1: TypeScript 컴파일**

Run: `pnpm exec tsc --noEmit`
Expected: 0 errors

**Step 2: 전체 테스트**

Run: `pnpm test`
Expected: ALL PASS (100+개)

**Step 3: 빌드**

Run: `pnpm build`
Expected: 성공, dist/ 생성

**Step 4: CLI 도움말**

Run: `node --import tsx src/cli.ts --help`
Expected: --runner 옵션 포함된 도움말 출력
