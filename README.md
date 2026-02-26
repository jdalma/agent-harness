# agent-harness

에이전트/스킬 호출 검증 및 컨텍스트 윈도우 효율성 테스트 하네스.

Claude 기반 에이전트가 도메인 라우팅 규칙을 올바르게 따르는지, 불필요한 도구 호출 없이 효율적으로 동작하는지를 YAML 시나리오로 정의하고 자동 검증합니다.

## 아키텍처

```
┌──────────────────────────────────────────────────────┐
│                    CLI (cli.ts)                       │
│  agent-harness <path> [--runner] [--model] [--verbose]│
└──────────────┬───────────────────────────────────────┘
               │
       ┌───────▼───────┐
       │ Scenario Loader│  YAML → Zod 파싱 → Scenario 객체
       └───────┬───────┘
               │
      ┌────────▼────────┐
      │  Runner 선택     │  시나리오의 runner 필드 기반
      ├─────────────────┤
      │ messages-api    │  Anthropic Messages API (단위 테스트용)
      │ agent-sdk       │  Claude Agent SDK (통합 테스트용)
      └────────┬────────┘
               │
       ┌───────▼───────┐
       │   Validator    │  expected/forbidden/budget/redundant 검증
       └───────┬───────┘
               │
       ┌───────▼───────┐
       │   Analyzer     │  효율성 점수, 캐시 적중률, 경고
       └───────┬───────┘
               │
       ┌───────▼───────┐
       │   Reporter     │  터미널 결과 출력 + 요약 테이블
       └───────────────┘
```

### 하이브리드 런너 구조

| 런너 | 용도 | API | 특성 |
|------|------|-----|------|
| `messages-api` | 단위 테스트 | Anthropic Messages API | 빠름, mock 가능, 첫 번째 hop만 관찰 |
| `agent-sdk` | 통합 테스트 | Claude Agent SDK | 전체 체인 관찰, 실제 실행, `parent_tool_use_id`로 중첩 추적 |

**왜 하이브리드인가?**

- **Messages API** (단위): "Claude가 첫 번째 도구를 올바르게 선택하는가?" → 빠르고 저렴하게 반복 검증
- **Agent SDK** (통합): "Skill → Orchestrator → Agent → Context Loading 전체 체인이 작동하는가?" → 실제 실행으로 정확한 검증

## 빠른 시작

### 설치

```bash
pnpm install
```

### 단위 테스트 실행 (Messages API)

```bash
# API 키 필요
export ANTHROPIC_API_KEY=your-key

# 단일 시나리오
pnpm agent-harness scenarios/domain/single_domain_order.yaml -v

# 디렉토리 내 모든 시나리오
pnpm agent-harness scenarios/domain/ -v
```

### 통합 테스트 실행 (Agent SDK)

```bash
# Agent SDK가 전체 도구 체인을 실제 실행
pnpm agent-harness scenarios/integration/ -v

# CLI에서 런너 오버라이드
pnpm agent-harness scenarios/domain/single_domain_order.yaml --runner agent-sdk -v
```

### 프로젝트 컨텍스트 주입

```bash
# 대상 프로젝트의 CLAUDE.md, 파일 트리, 메타데이터를 시스템 프롬프트에 자동 주입
pnpm agent-harness scenarios/domain/ --project /path/to/target-project -v
```

### 코드 테스트

```bash
pnpm test          # vitest 실행
pnpm build         # TypeScript 컴파일
```

## 시나리오 YAML 포맷

```yaml
name: scenario_name                    # 필수
description: 설명                      # 기본: ""
runner: messages-api                   # 'messages-api' | 'agent-sdk' (기본: messages-api)

# Messages API 런너용 설정
system_prompt: 시스템 프롬프트          # 기본: ""
model: claude-sonnet-4-20250514        # 기본값
max_tokens: 4096                       # 기본값

# Agent SDK 런너용 설정
agent_sdk_options:
  cwd: /path/to/project               # 작업 디렉토리
  setting_sources: [project]           # 설정 소스 (CLAUDE.md 로드)
  permission_mode: bypassPermissions   # 권한 모드
  allowed_tools: [Read, Grep, Skill]   # 허용 도구 (null = 전체)
  disallowed_tools: [Write]            # 차단 도구

# 도구 정의 (Messages API용)
tools:
  - name: Skill
    description: "스킬 호출"
    input_schema:
      type: object
      properties:
        skill: { type: string }
        args: { type: string }

# 대화 메시지
messages:
  - role: user
    content: "주문 취소 조건이 뭐야?"

# 검증 규칙
expected_calls:
  - name: domain-ask
    call_type: skill                   # 'tool' | 'skill' | 'agent'
    required: true
    args_contain:                      # 부분 인자 매칭 (선택)
      skill: domain-ask

forbidden_calls:
  - name: domain-orchestrator
    call_type: agent
    reason: "단일 도메인 질문에 오케스트레이터 불필요"

context_budget:
  max_input_tokens: 50000
  max_output_tokens: 5000
  max_total_tokens: 55000
  max_turns: 3

tags: [domain-routing, single-domain, order]
```

## 검증 규칙

| 규칙 | 모듈 | 설명 |
|------|------|------|
| `expected_call` | `expected-calls.ts` | 기대한 도구/스킬/에이전트가 호출되었는지 검증. `args_contain`으로 부분 인자 매칭 지원 |
| `forbidden_call` | `forbidden-calls.ts` | 금지된 호출이 발생하지 않았는지 검증 |
| `context_budget_*` | `context-budget.ts` | 입력/출력/합계 토큰 및 턴 수 예산 준수 검증 |
| `redundant_call` | `redundant-calls.ts` | 동일 입력으로 중복 호출 감지 |
| `call_order` | `call-order.ts` | 호출 순서 검증 (선택적) |

### 도구 호출 분류

`classifyCall()`이 API 응답의 원시 도구 호출을 논리적 타입으로 분류:

| 원시 도구명 | 분류 | 논리적 이름 |
|------------|------|------------|
| `Skill` | `skill` | `input.skill` (예: `domain-ask`) |
| `Task` | `agent` | `input.subagent_type` (예: `domain-orchestrator`) |
| 기타 | `tool` | 도구명 그대로 (예: `Read`, `Grep`) |

## 컨텍스트 효율성 분석

`analyze()`가 실행 결과로부터 효율성 리포트 생성:

| 메트릭 | 설명 |
|--------|------|
| `efficiencyScore` | 0.0~1.0 종합 효율 점수 |
| `redundantCalls` | 동일 입력 중복 호출 수 |
| `cacheHitRate` | 프롬프트 캐시 적중률 |
| `tokensPerTurn` | 턴당 평균 토큰 사용량 |
| `toolCallRatio` | 턴당 평균 도구 호출 수 |

경고 발생 조건:
- 중복 도구 호출 감지
- 턴당 10,000+ 토큰 사용
- 여러 턴 사용 but 도구 호출 < 2건
- 캐시 적중률 < 10% (입력 토큰 > 10,000)

## CLI 레퍼런스

```
Usage: agent-harness [options] <path>

Arguments:
  path               시나리오 YAML 파일 또는 디렉토리 경로

Options:
  --model <model>    모든 시나리오에 적용할 모델 오버라이드
  --runner <type>    런너 유형 오버라이드 (messages-api | agent-sdk)
  --project <dir>    프로젝트 디렉토리 (컨텍스트 자동 로드)
  --execute-tools    실제 도구 실행 모드 (Messages API 런너, --project 필요)
  -v, --verbose      시나리오별 상세 결과 출력
  -h, --help         도움말
```

## 디렉토리 구조

```
agent-harness/
├── src/
│   ├── cli.ts                    # CLI 진입점 (commander)
│   ├── index.ts                  # 패키지 export
│   ├── scenario/
│   │   ├── models.ts             # Zod 스키마 (Scenario, ActualCall, etc.)
│   │   └── loader.ts             # YAML → Scenario 파싱
│   ├── runner/
│   │   ├── types.ts              # IScenarioRunner, ApiClient, ApiResponse
│   │   ├── scenario-runner.ts    # Messages API 런너
│   │   ├── agent-sdk-runner.ts   # Agent SDK 런너
│   │   └── classify-call.ts      # tool_use → skill/agent/tool 분류
│   ├── validator/
│   │   ├── validate.ts           # 검증 오케스트레이터
│   │   ├── expected-calls.ts     # 기대 호출 검증
│   │   ├── forbidden-calls.ts    # 금지 호출 검증
│   │   ├── context-budget.ts     # 토큰/턴 예산 검증
│   │   ├── redundant-calls.ts    # 중복 호출 감지
│   │   └── call-order.ts         # 호출 순서 검증
│   ├── analyzer/
│   │   ├── context-analyzer.ts   # 효율성 분석
│   │   ├── context-loader.ts     # 프로젝트 컨텍스트 로드
│   │   └── types.ts              # ContextReport 타입
│   ├── executor/
│   │   ├── tool-executor.ts      # 실제 도구 실행 (보안 샌드박스)
│   │   └── types.ts              # IToolExecutor 인터페이스
│   └── reporter/
│       └── terminal-reporter.ts  # 터미널 결과 출력
├── tests/                        # Vitest 테스트
│   ├── scenario/                 # 스키마, 로더 테스트
│   ├── runner/                   # 런너, 분류, Agent SDK 런너 테스트
│   ├── validator/                # 각 검증 규칙 테스트
│   ├── analyzer/                 # 효율성 분석, 컨텍스트 로더 테스트
│   └── executor/                 # 도구 실행기 테스트
├── scenarios/
│   ├── domain/                   # 단위 테스트 시나리오 (Messages API)
│   └── integration/              # 통합 테스트 시나리오 (Agent SDK)
├── scripts/
│   └── dry-run.ts                # Mock client 파이프라인 시뮬레이션
└── docs/plans/                   # 설계/구현 문서
```

## 테스트

### 구조

| 테스트 디렉토리 | 범위 | 목적 |
|----------------|------|------|
| `tests/scenario/` | 스키마, 로더 | YAML 파싱, Zod 변환, snake_case↔camelCase |
| `tests/runner/` | 런너, 분류 | Messages API 턴 루프, Agent SDK 메시지 스트림, 도구 분류 |
| `tests/validator/` | 검증 규칙 | expected/forbidden/budget/redundant/order |
| `tests/analyzer/` | 분석 | 효율성 점수, 경고, 프로젝트 컨텍스트 로드 |
| `tests/executor/` | 도구 실행 | 보안 샌드박스, 경로 검증, 위험 명령어 차단 |

### 실행

```bash
pnpm test              # 전체 테스트
pnpm test:watch        # 감시 모드
pnpm exec tsc --noEmit # 타입 체크만
```

### 테스트 설계 원칙

- **Mock client** 사용: 실제 API 호출 없이 런너 로직 검증
- **Zod 파싱 테스트**: 모든 스키마의 기본값, snake_case/camelCase 양방향 지원 검증
- **경계값 테스트**: max_turns 초과, 토큰 예산 초과, 빈 호출 목록
- **보안 테스트**: 경로 탈출 시도, 위험 명령어 차단, 타임아웃

## 의존성

| 패키지 | 용도 |
|--------|------|
| `@anthropic-ai/sdk` | Anthropic Messages API 클라이언트 |
| `@anthropic-ai/claude-agent-sdk` | Claude Agent SDK (통합 테스트 런너) |
| `zod` | 스키마 정의 및 검증 |
| `yaml` | YAML 파싱 |
| `commander` | CLI 프레임워크 |
| `chalk` | 터미널 색상 |
| `cli-table3` | 결과 테이블 출력 |
