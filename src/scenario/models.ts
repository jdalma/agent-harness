import { z } from 'zod';

// ── Helper: snake_case → camelCase 양방향 지원 ──

function pick<T>(a: T | undefined, b: T | undefined, fallback: T): T {
  return a !== undefined ? a : b !== undefined ? b : fallback;
}

// ── 도구 정의 ──

export const ToolDefinitionSchema = z
  .object({
    name: z.string(),
    description: z.string(),
    input_schema: z.record(z.unknown()).optional(),
    inputSchema: z.record(z.unknown()).optional(),
  })
  .transform((v) => ({
    name: v.name,
    description: v.description,
    inputSchema: v.input_schema ?? v.inputSchema ?? { type: 'object', properties: {} },
  }));
export type ToolDefinition = z.output<typeof ToolDefinitionSchema>;

// ── 기대 호출 ──

export const ExpectedCallSchema = z
  .object({
    name: z.string(),
    call_type: z.string().optional(),
    callType: z.string().optional(),
    required: z.boolean().default(true),
    args_contain: z.record(z.unknown()).nullable().optional(),
    argsContain: z.record(z.unknown()).nullable().optional(),
  })
  .transform((v) => ({
    name: v.name,
    callType: pick(v.call_type, v.callType, 'tool'),
    required: v.required,
    argsContain: v.args_contain ?? v.argsContain ?? null,
  }));
export type ExpectedCall = z.output<typeof ExpectedCallSchema>;

// ── 금지 호출 ──

export const ForbiddenCallSchema = z
  .object({
    name: z.string(),
    call_type: z.string().optional(),
    callType: z.string().optional(),
    reason: z.string().default(''),
  })
  .transform((v) => ({
    name: v.name,
    callType: pick(v.call_type, v.callType, 'tool'),
    reason: v.reason,
  }));
export type ForbiddenCall = z.output<typeof ForbiddenCallSchema>;

// ── 컨텍스트 예산 ──

export const ContextBudgetSchema = z
  .object({
    max_input_tokens: z.number().nullable().optional(),
    maxInputTokens: z.number().nullable().optional(),
    max_output_tokens: z.number().nullable().optional(),
    maxOutputTokens: z.number().nullable().optional(),
    max_total_tokens: z.number().nullable().optional(),
    maxTotalTokens: z.number().nullable().optional(),
    max_turns: z.number().nullable().optional(),
    maxTurns: z.number().nullable().optional(),
  })
  .transform((v) => ({
    maxInputTokens: v.max_input_tokens ?? v.maxInputTokens ?? null,
    maxOutputTokens: v.max_output_tokens ?? v.maxOutputTokens ?? null,
    maxTotalTokens: v.max_total_tokens ?? v.maxTotalTokens ?? null,
    maxTurns: v.max_turns ?? v.maxTurns ?? null,
  }));
export type ContextBudget = z.output<typeof ContextBudgetSchema>;

// ── 시나리오 ──

export const ScenarioSchema = z
  .object({
    name: z.string(),
    description: z.string().default(''),
    system_prompt: z.string().optional(),
    systemPrompt: z.string().optional(),
    tools: z.array(ToolDefinitionSchema).default([]),
    messages: z.array(z.record(z.unknown())),
    expected_calls: z.array(ExpectedCallSchema).optional(),
    expectedCalls: z.array(ExpectedCallSchema).optional(),
    forbidden_calls: z.array(ForbiddenCallSchema).optional(),
    forbiddenCalls: z.array(ForbiddenCallSchema).optional(),
    context_budget: ContextBudgetSchema.optional(),
    contextBudget: ContextBudgetSchema.optional(),
    model: z.string().default('claude-sonnet-4-20250514'),
    max_tokens: z.number().optional(),
    maxTokens: z.number().optional(),
    tags: z.array(z.string()).default([]),
    project_path: z.string().nullable().optional(),
    projectPath: z.string().nullable().optional(),
    execute_tools: z.boolean().optional(),
    executeTools: z.boolean().optional(),
  })
  .transform((v) => ({
    name: v.name,
    description: v.description,
    systemPrompt: pick(v.system_prompt, v.systemPrompt, ''),
    tools: v.tools,
    messages: v.messages,
    expectedCalls: v.expected_calls ?? v.expectedCalls ?? [],
    forbiddenCalls: v.forbidden_calls ?? v.forbiddenCalls ?? [],
    contextBudget: v.context_budget ??
      v.contextBudget ?? { maxInputTokens: null, maxOutputTokens: null, maxTotalTokens: null, maxTurns: null },
    model: v.model,
    maxTokens: pick(v.max_tokens, v.maxTokens, 4096),
    tags: v.tags,
    projectPath: v.project_path ?? v.projectPath ?? null,
    executeTools: v.execute_tools ?? v.executeTools ?? false,
  }));
export type Scenario = z.output<typeof ScenarioSchema>;

// ── 토큰 사용량 ──

export const TokenUsageSchema = z.object({
  inputTokens: z.number().default(0),
  outputTokens: z.number().default(0),
  cacheCreationInputTokens: z.number().default(0),
  cacheReadInputTokens: z.number().default(0),
});
export type TokenUsage = z.infer<typeof TokenUsageSchema>;

export function computeTotalTokens(u: TokenUsage): number {
  return u.inputTokens + u.outputTokens;
}

export function computeCacheHitRate(u: TokenUsage): number {
  const totalInput = u.inputTokens + u.cacheReadInputTokens;
  if (totalInput === 0) return 0;
  return u.cacheReadInputTokens / totalInput;
}

// ── 실제 호출 ──

export const ActualCallSchema = z.object({
  name: z.string(),
  callType: z.string().default('tool'),
  input: z.record(z.unknown()).default({}),
  turn: z.number().default(0),
});
export type ActualCall = z.infer<typeof ActualCallSchema>;

// ── 판정 ──

export const Verdict = {
  PASS: 'pass',
  FAIL: 'fail',
  ERROR: 'error',
} as const;
export type Verdict = (typeof Verdict)[keyof typeof Verdict];

// ── 검증 실패 ──

export const ValidationFailureSchema = z.object({
  rule: z.string(),
  message: z.string(),
  expected: z.unknown().nullable().default(null),
  actual: z.unknown().nullable().default(null),
});
export type ValidationFailure = z.infer<typeof ValidationFailureSchema>;

// ── 시나리오 결과 ──

export const ScenarioResultSchema = z.object({
  scenarioName: z.string(),
  verdict: z.string().default(Verdict.PASS) as z.ZodType<Verdict>,
  actualCalls: z.array(ActualCallSchema).default([]),
  tokenUsage: TokenUsageSchema.default({}),
  turns: z.number().default(0),
  failures: z.array(ValidationFailureSchema).default([]),
  error: z.string().nullable().default(null),
  rawResponses: z.array(z.record(z.unknown())).default([]),
});
export type ScenarioResult = z.infer<typeof ScenarioResultSchema>;
