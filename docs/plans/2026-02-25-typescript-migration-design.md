# Agent Harness: Python → TypeScript Migration Design

## Summary

agent-harness를 Python에서 TypeScript로 마이그레이션한다.
Feature-based Modules 구조에 클린 코드 원칙(DI, 단일 책임, 불변성)을 적용한다.

## Tech Stack

| Category | Choice |
|----------|--------|
| Runtime | Node.js 20+ |
| Package Manager | pnpm |
| Language | TypeScript 5.x (strict mode) |
| Test Framework | Vitest |
| Schema Validation | Zod |
| CLI | commander |
| Terminal Output | chalk + cli-table3 |
| Claude API | @anthropic-ai/sdk |
| YAML | yaml |

## Module Mapping

| Python Source | TypeScript Target | Description |
|--------------|-------------------|-------------|
| `models.py` | `src/scenario/models.ts` | Zod 스키마 + readonly 타입 |
| `loader.py` | `src/scenario/loader.ts` | YAML 시나리오 로더 |
| `runner.py` | `src/runner/scenario-runner.ts` | Claude API 실행 + 호출 캡처 |
| `runner.py` (_classify_call) | `src/runner/classify-call.ts` | 호출 분류 로직 분리 |
| `validators.py` | `src/validator/*.ts` | 규칙별 개별 파일 분리 |
| `context_analyzer.py` | `src/analyzer/context-analyzer.ts` | 컨텍스트 효율성 분석 |
| `context_loader.py` | `src/analyzer/context-loader.ts` | 프로젝트 컨텍스트 로더 |
| `reporter.py` | `src/reporter/terminal-reporter.ts` | chalk 기반 터미널 출력 |
| `tool_executor.py` | `src/executor/tool-executor.ts` | 실제 도구 실행기 |
| `cli.py` | `src/cli.ts` | commander 기반 CLI |

## Directory Structure

```
src/
  scenario/
    models.ts           # Zod 스키마 + 타입 추출
    loader.ts           # YAML 로더
    index.ts
  runner/
    scenario-runner.ts  # API 실행 + 결과 수집
    classify-call.ts    # tool_use → call_type 분류
    types.ts            # ApiClient 인터페이스
    index.ts
  validator/
    expected-calls.ts   # 기대 호출 검증
    forbidden-calls.ts  # 금지 호출 검증
    call-order.ts       # 호출 순서 검증
    context-budget.ts   # 컨텍스트 예산 검증
    redundant-calls.ts  # 중복 호출 검증
    validate.ts         # 전체 검증 오케스트레이터
    index.ts
  analyzer/
    context-analyzer.ts # 효율성 점수 계산
    context-loader.ts   # 프로젝트 컨텍스트 추출
    types.ts            # ProjectContext, ContextReport 타입
    index.ts
  reporter/
    terminal-reporter.ts # chalk + cli-table3 출력
    index.ts
  executor/
    tool-executor.ts    # Read/Grep/Glob/Bash 실행
    types.ts            # ToolExecutor 인터페이스
    index.ts
  cli.ts                # commander 엔트리포인트
  index.ts              # public API barrel export
tests/
  scenario/
    models.test.ts
    loader.test.ts
  runner/
    classify-call.test.ts
    scenario-runner.test.ts
  validator/
    expected-calls.test.ts
    forbidden-calls.test.ts
    call-order.test.ts
    context-budget.test.ts
    redundant-calls.test.ts
    validate.test.ts
  analyzer/
    context-analyzer.test.ts
    context-loader.test.ts
  executor/
    tool-executor.test.ts
```

## Clean Code Principles Applied

### 1. Interface-based DI

```typescript
// runner/types.ts
interface ApiClient {
  createMessage(params: MessageParams): Promise<MessageResponse>;
}

// executor/types.ts
interface ToolExecutor {
  execute(toolName: string, input: Record<string, unknown>): string;
}
```

Runner, Reporter 등은 인터페이스에 의존하고, 구현체는 생성 시점에 주입된다.
테스트에서는 mock 구현체를 주입한다.

### 2. Immutable Data Models (Zod)

```typescript
const TokenUsageSchema = z.object({
  inputTokens: z.number().default(0),
  outputTokens: z.number().default(0),
  cacheCreationInputTokens: z.number().default(0),
  cacheReadInputTokens: z.number().default(0),
});
type TokenUsage = z.infer<typeof TokenUsageSchema>;
```

Pydantic BaseModel → Zod 스키마 + readonly 타입 추출.
런타임 검증과 타입 안전성을 동시에 확보.

### 3. Single Responsibility (Validator 분리)

현재 Python의 `validators.py`는 5개 검증 함수가 하나의 파일에 있다.
TypeScript에서는 각 검증 규칙을 개별 파일로 분리:

- `expected-calls.ts` — 기대 호출 존재 여부
- `forbidden-calls.ts` — 금지 호출 미발생 확인
- `call-order.ts` — 호출 순서 검증
- `context-budget.ts` — 토큰/턴 예산 검증
- `redundant-calls.ts` — 중복 호출 탐지
- `validate.ts` — 위 규칙들을 조합하는 오케스트레이터

### 4. Pure Functions First

분류, 검증, 분석 로직은 모두 순수 함수로 유지.
사이드이펙트(API 호출, 파일 I/O, 터미널 출력)는 어댑터 경계에만 존재.

### 5. Explicit Error Handling

```typescript
class ToolExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolExecutionError';
  }
}
```

## Naming Conventions

| Python | TypeScript |
|--------|-----------|
| `snake_case` (변수/함수) | `camelCase` |
| `PascalCase` (클래스) | `PascalCase` (type/interface) |
| `_private_method` | `private` keyword |
| `UPPER_CASE` (상수) | `UPPER_CASE` |
| `list[str]` | `string[]` 또는 `readonly string[]` |
| `dict[str, Any]` | `Record<string, unknown>` |

## Config Files

- `tsconfig.json` — strict mode, ESM target
- `vitest.config.ts` — test configuration
- `package.json` — scripts, dependencies
- `.gitignore` — dist/, node_modules/ 추가

## Migration Order

1. 프로젝트 초기화 (package.json, tsconfig, vitest)
2. `scenario/models.ts` — 핵심 타입 정의 (다른 모든 모듈이 의존)
3. `scenario/loader.ts` — YAML 로딩
4. `runner/classify-call.ts` — 순수 함수, 의존성 없음
5. `runner/scenario-runner.ts` — API 호출 + 도구 캡처
6. `validator/*.ts` — 각 검증 규칙 + 오케스트레이터
7. `analyzer/context-analyzer.ts` — 효율성 분석
8. `analyzer/context-loader.ts` — 프로젝트 컨텍스트
9. `executor/tool-executor.ts` — 도구 실행기
10. `reporter/terminal-reporter.ts` — 터미널 출력
11. `cli.ts` — CLI 엔트리포인트
12. 통합 테스트 + 기존 YAML 시나리오 호환성 확인

## Preserved

- YAML 시나리오 파일 형식 (scenarios/*.yaml) — 그대로 유지
- CLI 인터페이스 (`agent-harness <path>` 명령어)
- 기존 테스트 시나리오 전체 호환
