# Agent Harness: Python → TypeScript Migration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate agent-harness from Python to TypeScript with feature-based module structure and clean code principles.

**Architecture:** Feature-based modules (scenario, runner, validator, analyzer, executor, reporter) with interface-based DI, Zod schemas for runtime validation, and pure functions for all business logic.

**Tech Stack:** Node.js 20+, pnpm, TypeScript 5.x strict, Vitest, Zod, commander, chalk, cli-table3, @anthropic-ai/sdk, yaml

---

### Task 1: Project Initialization

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Modify: `.gitignore`

**Step 1: Initialize pnpm project**

Run: `cd /Users/hyunjunjeong/ideaProjects/agent-harness && pnpm init`

**Step 2: Install dependencies**

Run:
```bash
pnpm add @anthropic-ai/sdk zod yaml commander chalk cli-table3
pnpm add -D typescript vitest @types/node
```

**Step 3: Create tsconfig.json**

Create `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

**Step 4: Create vitest.config.ts**

Create `vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
  },
});
```

**Step 5: Update package.json scripts**

Add to `package.json`:
```json
{
  "type": "module",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "agent-harness": "node --import tsx src/cli.ts"
  },
  "bin": {
    "agent-harness": "dist/cli.js"
  }
}
```

Also `pnpm add -D tsx` for dev execution without build.

**Step 6: Update .gitignore**

Append to `.gitignore`:
```
node_modules/
dist/
*.tsbuildinfo
```

**Step 7: Verify setup compiles**

Create a minimal `src/index.ts`:
```typescript
export const VERSION = '0.1.0';
```

Run: `pnpm exec tsc --noEmit`
Expected: No errors

**Step 8: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts .gitignore src/index.ts pnpm-lock.yaml
git commit -m "chore: initialize TypeScript project with pnpm, vitest, zod"
```

---

### Task 2: Scenario Models (Zod Schemas)

**Files:**
- Create: `src/scenario/models.ts`
- Create: `src/scenario/index.ts`
- Test: `tests/scenario/models.test.ts`

**Reference:** `src/agent_harness/models.py`

**Step 1: Write failing test for models**

Create `tests/scenario/models.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import {
  ToolDefinitionSchema,
  ExpectedCallSchema,
  ForbiddenCallSchema,
  ContextBudgetSchema,
  ScenarioSchema,
  TokenUsageSchema,
  ActualCallSchema,
  Verdict,
  ValidationFailureSchema,
  ScenarioResultSchema,
  computeTotalTokens,
  computeCacheHitRate,
} from '../src/scenario/models.js';

describe('ToolDefinition', () => {
  it('parses with defaults', () => {
    const tool = ToolDefinitionSchema.parse({ name: 'Read', description: 'reads files' });
    expect(tool.name).toBe('Read');
    expect(tool.inputSchema).toEqual({ type: 'object', properties: {} });
  });
});

describe('ExpectedCall', () => {
  it('has default call_type and required', () => {
    const call = ExpectedCallSchema.parse({ name: 'Read' });
    expect(call.callType).toBe('tool');
    expect(call.required).toBe(true);
    expect(call.argsContain).toBeNull();
  });
});

describe('ForbiddenCall', () => {
  it('has default reason', () => {
    const call = ForbiddenCallSchema.parse({ name: 'Write' });
    expect(call.callType).toBe('tool');
    expect(call.reason).toBe('');
  });
});

describe('ContextBudget', () => {
  it('all fields optional', () => {
    const budget = ContextBudgetSchema.parse({});
    expect(budget.maxInputTokens).toBeNull();
    expect(budget.maxTurns).toBeNull();
  });
});

describe('Scenario', () => {
  it('parses minimal scenario', () => {
    const s = ScenarioSchema.parse({
      name: 'test',
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(s.name).toBe('test');
    expect(s.model).toBe('claude-sonnet-4-20250514');
    expect(s.maxTokens).toBe(4096);
    expect(s.tools).toEqual([]);
    expect(s.executeTools).toBe(false);
  });

  // YAML uses snake_case keys — Zod must accept both camelCase and snake_case
  it('parses snake_case keys from YAML', () => {
    const s = ScenarioSchema.parse({
      name: 'test',
      system_prompt: 'hello',
      expected_calls: [{ name: 'Read', call_type: 'tool' }],
      forbidden_calls: [{ name: 'Write', call_type: 'tool' }],
      context_budget: { max_turns: 5, max_total_tokens: 10000 },
      max_tokens: 2048,
      project_path: '/tmp/project',
      execute_tools: true,
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(s.systemPrompt).toBe('hello');
    expect(s.expectedCalls[0].callType).toBe('tool');
    expect(s.forbiddenCalls[0].name).toBe('Write');
    expect(s.contextBudget.maxTurns).toBe(5);
    expect(s.maxTokens).toBe(2048);
    expect(s.projectPath).toBe('/tmp/project');
    expect(s.executeTools).toBe(true);
  });
});

describe('TokenUsage', () => {
  it('has defaults of 0', () => {
    const u = TokenUsageSchema.parse({});
    expect(u.inputTokens).toBe(0);
    expect(u.outputTokens).toBe(0);
  });

  it('computes total tokens', () => {
    const u = TokenUsageSchema.parse({ inputTokens: 1000, outputTokens: 500 });
    expect(computeTotalTokens(u)).toBe(1500);
  });

  it('computes cache hit rate', () => {
    const u = TokenUsageSchema.parse({
      inputTokens: 1000,
      cacheReadInputTokens: 800,
    });
    // 800 / (1000 + 800) = 0.444...
    expect(computeCacheHitRate(u)).toBeGreaterThan(0.4);
  });

  it('returns 0 cache hit rate when no input', () => {
    const u = TokenUsageSchema.parse({});
    expect(computeCacheHitRate(u)).toBe(0);
  });
});

describe('ActualCall', () => {
  it('has defaults', () => {
    const call = ActualCallSchema.parse({ name: 'Read' });
    expect(call.callType).toBe('tool');
    expect(call.input).toEqual({});
    expect(call.turn).toBe(0);
  });
});

describe('Verdict', () => {
  it('has expected values', () => {
    expect(Verdict.PASS).toBe('pass');
    expect(Verdict.FAIL).toBe('fail');
    expect(Verdict.ERROR).toBe('error');
  });
});

describe('ValidationFailure', () => {
  it('parses with required fields', () => {
    const f = ValidationFailureSchema.parse({ rule: 'expected_call', message: 'missing' });
    expect(f.expected).toBeNull();
    expect(f.actual).toBeNull();
  });
});

describe('ScenarioResult', () => {
  it('has default verdict PASS', () => {
    const r = ScenarioResultSchema.parse({ scenarioName: 'test' });
    expect(r.verdict).toBe(Verdict.PASS);
    expect(r.actualCalls).toEqual([]);
    expect(r.turns).toBe(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/scenario/models.test.ts`
Expected: FAIL — module not found

**Step 3: Implement models**

Create `src/scenario/models.ts`:
```typescript
import { z } from 'zod';

// ── Input Schema Definitions ──

export const ToolDefinitionSchema = z.object({
  name: z.string(),
  description: z.string(),
  input_schema: z.record(z.unknown()).default({ type: 'object', properties: {} }).optional(),
  inputSchema: z.record(z.unknown()).default({ type: 'object', properties: {} }).optional(),
}).transform((v) => ({
  name: v.name,
  description: v.description,
  inputSchema: v.input_schema ?? v.inputSchema ?? { type: 'object', properties: {} },
}));
export type ToolDefinition = z.output<typeof ToolDefinitionSchema>;

export const ExpectedCallSchema = z.object({
  name: z.string(),
  call_type: z.string().default('tool').optional(),
  callType: z.string().default('tool').optional(),
  required: z.boolean().default(true),
  args_contain: z.record(z.unknown()).nullable().default(null).optional(),
  argsContain: z.record(z.unknown()).nullable().default(null).optional(),
}).transform((v) => ({
  name: v.name,
  callType: v.call_type ?? v.callType ?? 'tool',
  required: v.required,
  argsContain: v.args_contain ?? v.argsContain ?? null,
}));
export type ExpectedCall = z.output<typeof ExpectedCallSchema>;

export const ForbiddenCallSchema = z.object({
  name: z.string(),
  call_type: z.string().default('tool').optional(),
  callType: z.string().default('tool').optional(),
  reason: z.string().default(''),
}).transform((v) => ({
  name: v.name,
  callType: v.call_type ?? v.callType ?? 'tool',
  reason: v.reason,
}));
export type ForbiddenCall = z.output<typeof ForbiddenCallSchema>;

export const ContextBudgetSchema = z.object({
  max_input_tokens: z.number().nullable().default(null).optional(),
  maxInputTokens: z.number().nullable().default(null).optional(),
  max_output_tokens: z.number().nullable().default(null).optional(),
  maxOutputTokens: z.number().nullable().default(null).optional(),
  max_total_tokens: z.number().nullable().default(null).optional(),
  maxTotalTokens: z.number().nullable().default(null).optional(),
  max_turns: z.number().nullable().default(null).optional(),
  maxTurns: z.number().nullable().default(null).optional(),
}).transform((v) => ({
  maxInputTokens: v.max_input_tokens ?? v.maxInputTokens ?? null,
  maxOutputTokens: v.max_output_tokens ?? v.maxOutputTokens ?? null,
  maxTotalTokens: v.max_total_tokens ?? v.maxTotalTokens ?? null,
  maxTurns: v.max_turns ?? v.maxTurns ?? null,
}));
export type ContextBudget = z.output<typeof ContextBudgetSchema>;

export const ScenarioSchema = z.object({
  name: z.string(),
  description: z.string().default(''),
  system_prompt: z.string().default('').optional(),
  systemPrompt: z.string().default('').optional(),
  tools: z.array(ToolDefinitionSchema).default([]),
  messages: z.array(z.record(z.unknown())),
  expected_calls: z.array(ExpectedCallSchema).default([]).optional(),
  expectedCalls: z.array(ExpectedCallSchema).default([]).optional(),
  forbidden_calls: z.array(ForbiddenCallSchema).default([]).optional(),
  forbiddenCalls: z.array(ForbiddenCallSchema).default([]).optional(),
  context_budget: ContextBudgetSchema.default({}).optional(),
  contextBudget: ContextBudgetSchema.default({}).optional(),
  model: z.string().default('claude-sonnet-4-20250514'),
  max_tokens: z.number().default(4096).optional(),
  maxTokens: z.number().default(4096).optional(),
  tags: z.array(z.string()).default([]),
  project_path: z.string().nullable().default(null).optional(),
  projectPath: z.string().nullable().default(null).optional(),
  execute_tools: z.boolean().default(false).optional(),
  executeTools: z.boolean().default(false).optional(),
}).transform((v) => ({
  name: v.name,
  description: v.description,
  systemPrompt: v.system_prompt ?? v.systemPrompt ?? '',
  tools: v.tools,
  messages: v.messages,
  expectedCalls: v.expected_calls ?? v.expectedCalls ?? [],
  forbiddenCalls: v.forbidden_calls ?? v.forbiddenCalls ?? [],
  contextBudget: v.context_budget ?? v.contextBudget ?? { maxInputTokens: null, maxOutputTokens: null, maxTotalTokens: null, maxTurns: null },
  model: v.model,
  maxTokens: v.max_tokens ?? v.maxTokens ?? 4096,
  tags: v.tags,
  projectPath: v.project_path ?? v.projectPath ?? null,
  executeTools: v.execute_tools ?? v.executeTools ?? false,
}));
export type Scenario = z.output<typeof ScenarioSchema>;

// ── Result Models ──

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

export const ActualCallSchema = z.object({
  name: z.string(),
  callType: z.string().default('tool'),
  input: z.record(z.unknown()).default({}),
  turn: z.number().default(0),
});
export type ActualCall = z.infer<typeof ActualCallSchema>;

export const Verdict = {
  PASS: 'pass',
  FAIL: 'fail',
  ERROR: 'error',
} as const;
export type Verdict = (typeof Verdict)[keyof typeof Verdict];

export const ValidationFailureSchema = z.object({
  rule: z.string(),
  message: z.string(),
  expected: z.unknown().nullable().default(null),
  actual: z.unknown().nullable().default(null),
});
export type ValidationFailure = z.infer<typeof ValidationFailureSchema>;

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
```

Create `src/scenario/index.ts`:
```typescript
export * from './models.js';
```

**Step 4: Run tests**

Run: `pnpm test -- tests/scenario/models.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/scenario/ tests/scenario/
git commit -m "feat: add scenario models with Zod schemas"
```

---

### Task 3: Scenario Loader

**Files:**
- Create: `src/scenario/loader.ts`
- Test: `tests/scenario/loader.test.ts`

**Reference:** `src/agent_harness/loader.py`

**Step 1: Write failing test**

Create `tests/scenario/loader.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { loadScenario, loadScenarios } from '../src/scenario/loader.js';

const SCENARIOS_DIR = path.resolve(import.meta.dirname, '..', 'scenarios');

describe('loadScenario', () => {
  it('loads a single YAML scenario', () => {
    const scenario = loadScenario(path.join(SCENARIOS_DIR, 'example_code_review.yaml'));
    expect(scenario.name).toBe('code_review_routing');
    expect(scenario.tools.length).toBeGreaterThan(0);
    expect(scenario.expectedCalls.length).toBeGreaterThan(0);
    expect(scenario.messages.length).toBe(1);
  });

  it('has context budget', () => {
    const scenario = loadScenario(path.join(SCENARIOS_DIR, 'example_code_review.yaml'));
    expect(scenario.contextBudget.maxInputTokens).toBe(50000);
    expect(scenario.contextBudget.maxTurns).toBe(5);
  });

  it('has forbidden calls', () => {
    const scenario = loadScenario(path.join(SCENARIOS_DIR, 'example_code_review.yaml'));
    expect(scenario.forbiddenCalls.length).toBe(1);
    expect(scenario.forbiddenCalls[0].name).toBe('Write');
  });
});

describe('loadScenarios', () => {
  it('loads all scenarios from directory', () => {
    const scenarios = loadScenarios(SCENARIOS_DIR);
    expect(scenarios.length).toBeGreaterThanOrEqual(3);
    const names = new Set(scenarios.map((s) => s.name));
    expect(names.has('code_review_routing')).toBe(true);
    expect(names.has('agent_delegation_explore')).toBe(true);
    expect(names.has('skill_invocation_commit')).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/scenario/loader.test.ts`
Expected: FAIL — module not found

**Step 3: Implement loader**

Create `src/scenario/loader.ts`:
```typescript
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { ScenarioSchema, type Scenario } from './models.js';

export function loadScenario(filePath: string): Scenario {
  const content = fs.readFileSync(filePath, 'utf-8');
  const data = YAML.parse(content);
  return ScenarioSchema.parse(data);
}

export function loadScenarios(directory: string): Scenario[] {
  const entries = fs.readdirSync(directory).sort();
  const scenarios: Scenario[] = [];

  for (const entry of entries) {
    if (entry.endsWith('.yaml') || entry.endsWith('.yml')) {
      scenarios.push(loadScenario(path.join(directory, entry)));
    }
  }

  return scenarios;
}
```

Update `src/scenario/index.ts` to also export loader:
```typescript
export * from './models.js';
export * from './loader.js';
```

**Step 4: Run tests**

Run: `pnpm test -- tests/scenario/loader.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/scenario/loader.ts src/scenario/index.ts tests/scenario/loader.test.ts
git commit -m "feat: add YAML scenario loader"
```

---

### Task 4: Call Classifier (Pure Function)

**Files:**
- Create: `src/runner/classify-call.ts`
- Create: `src/runner/index.ts`
- Test: `tests/runner/classify-call.test.ts`

**Reference:** `src/agent_harness/runner.py:_classify_call`

**Step 1: Write failing test**

Create `tests/runner/classify-call.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { classifyCall } from '../src/runner/classify-call.js';

describe('classifyCall', () => {
  it('classifies regular tool', () => {
    const [callType, name] = classifyCall('Read', { file_path: 'a.py' });
    expect(callType).toBe('tool');
    expect(name).toBe('Read');
  });

  it('classifies Task as agent', () => {
    const [callType, name] = classifyCall('Task', {
      subagent_type: 'Explore',
      prompt: 'find files',
    });
    expect(callType).toBe('agent');
    expect(name).toBe('Explore');
  });

  it('classifies Skill call', () => {
    const [callType, name] = classifyCall('Skill', { skill: 'commit' });
    expect(callType).toBe('skill');
    expect(name).toBe('commit');
  });

  it('handles Task without subagent_type', () => {
    const [callType, name] = classifyCall('Task', { prompt: 'do something' });
    expect(callType).toBe('agent');
    expect(name).toBe('unknown');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/runner/classify-call.test.ts`
Expected: FAIL

**Step 3: Implement classify-call**

Create `src/runner/classify-call.ts`:
```typescript
const AGENT_TOOL = 'Task';
const SKILL_TOOL = 'Skill';

export function classifyCall(
  toolName: string,
  toolInput: Record<string, unknown>,
): [callType: string, logicalName: string] {
  if (toolName === AGENT_TOOL) {
    const agentType = (toolInput.subagent_type as string) ?? 'unknown';
    return ['agent', agentType];
  }
  if (toolName === SKILL_TOOL) {
    const skillName = (toolInput.skill as string) ?? 'unknown';
    return ['skill', skillName];
  }
  return ['tool', toolName];
}
```

Create `src/runner/index.ts`:
```typescript
export * from './classify-call.js';
```

**Step 4: Run tests**

Run: `pnpm test -- tests/runner/classify-call.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/runner/ tests/runner/
git commit -m "feat: add call classifier"
```

---

### Task 5: Validators

**Files:**
- Create: `src/validator/expected-calls.ts`
- Create: `src/validator/forbidden-calls.ts`
- Create: `src/validator/call-order.ts`
- Create: `src/validator/context-budget.ts`
- Create: `src/validator/redundant-calls.ts`
- Create: `src/validator/validate.ts`
- Create: `src/validator/index.ts`
- Test: `tests/validator/expected-calls.test.ts`
- Test: `tests/validator/forbidden-calls.test.ts`
- Test: `tests/validator/call-order.test.ts`
- Test: `tests/validator/context-budget.test.ts`
- Test: `tests/validator/redundant-calls.test.ts`
- Test: `tests/validator/validate.test.ts`

**Reference:** `src/agent_harness/validators.py`, `tests/test_validators.py`

This task is large — implement each validator file in TDD order. The test code mirrors `tests/test_validators.py` exactly.

**Step 1: Write all validator tests**

Create `tests/validator/expected-calls.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { validateExpectedCalls } from '../src/validator/expected-calls.js';
import { ScenarioSchema, ScenarioResultSchema } from '../src/scenario/models.js';

const makeScenario = (overrides = {}) =>
  ScenarioSchema.parse({ name: 'test', messages: [{ role: 'user', content: 'hello' }], ...overrides });
const makeResult = (overrides = {}) =>
  ScenarioResultSchema.parse({ scenarioName: 'test', ...overrides });

describe('validateExpectedCalls', () => {
  it('passes when tool called', () => {
    const scenario = makeScenario({
      expected_calls: [{ name: 'Read', call_type: 'tool', required: true }],
    });
    const result = makeResult({
      actualCalls: [{ name: 'Read', callType: 'tool', input: { file_path: 'a.py' } }],
    });
    expect(validateExpectedCalls(scenario, result)).toHaveLength(0);
  });

  it('fails when required tool missing', () => {
    const scenario = makeScenario({
      expected_calls: [{ name: 'Read', call_type: 'tool', required: true }],
    });
    const result = makeResult({
      actualCalls: [{ name: 'Grep', callType: 'tool' }],
    });
    const failures = validateExpectedCalls(scenario, result);
    expect(failures).toHaveLength(1);
    expect(failures[0].message).toContain('Read');
  });

  it('passes when agent called', () => {
    const scenario = makeScenario({
      expected_calls: [{ name: 'Explore', call_type: 'agent', required: true }],
    });
    const result = makeResult({
      actualCalls: [{ name: 'Explore', callType: 'agent', input: { prompt: '...' } }],
    });
    expect(validateExpectedCalls(scenario, result)).toHaveLength(0);
  });

  it('passes when args_contain match', () => {
    const scenario = makeScenario({
      expected_calls: [{
        name: 'Read', call_type: 'tool', required: true,
        args_contain: { file_path: 'src/main.py' },
      }],
    });
    const result = makeResult({
      actualCalls: [{ name: 'Read', callType: 'tool', input: { file_path: 'src/main.py', limit: 100 } }],
    });
    expect(validateExpectedCalls(scenario, result)).toHaveLength(0);
  });

  it('fails when args mismatch', () => {
    const scenario = makeScenario({
      expected_calls: [{
        name: 'Read', call_type: 'tool', required: true,
        args_contain: { file_path: 'src/main.py' },
      }],
    });
    const result = makeResult({
      actualCalls: [{ name: 'Read', callType: 'tool', input: { file_path: 'src/other.py' } }],
    });
    expect(validateExpectedCalls(scenario, result)).toHaveLength(1);
  });

  it('skips optional calls', () => {
    const scenario = makeScenario({
      expected_calls: [{ name: 'Grep', call_type: 'tool', required: false }],
    });
    const result = makeResult({ actualCalls: [] });
    expect(validateExpectedCalls(scenario, result)).toHaveLength(0);
  });
});
```

Create `tests/validator/forbidden-calls.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { validateForbiddenCalls } from '../src/validator/forbidden-calls.js';
import { ScenarioSchema, ScenarioResultSchema } from '../src/scenario/models.js';

const makeScenario = (overrides = {}) =>
  ScenarioSchema.parse({ name: 'test', messages: [{ role: 'user', content: 'hello' }], ...overrides });
const makeResult = (overrides = {}) =>
  ScenarioResultSchema.parse({ scenarioName: 'test', ...overrides });

describe('validateForbiddenCalls', () => {
  it('passes when forbidden not called', () => {
    const scenario = makeScenario({
      forbidden_calls: [{ name: 'Write', call_type: 'tool', reason: '읽기 전용' }],
    });
    const result = makeResult({
      actualCalls: [{ name: 'Read', callType: 'tool' }],
    });
    expect(validateForbiddenCalls(scenario, result)).toHaveLength(0);
  });

  it('fails when forbidden called', () => {
    const scenario = makeScenario({
      forbidden_calls: [{ name: 'Write', call_type: 'tool', reason: '읽기 전용' }],
    });
    const result = makeResult({
      actualCalls: [{ name: 'Write', callType: 'tool' }],
    });
    const failures = validateForbiddenCalls(scenario, result);
    expect(failures).toHaveLength(1);
    expect(failures[0].message).toContain('읽기 전용');
  });
});
```

Create `tests/validator/call-order.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { validateCallOrder } from '../src/validator/call-order.js';
import { ScenarioResultSchema } from '../src/scenario/models.js';

const makeResult = (overrides = {}) =>
  ScenarioResultSchema.parse({ scenarioName: 'test', ...overrides });

describe('validateCallOrder', () => {
  it('passes with correct order', () => {
    const result = makeResult({
      actualCalls: [
        { name: 'Read', callType: 'tool', turn: 0 },
        { name: 'Grep', callType: 'tool', turn: 1 },
        { name: 'Edit', callType: 'tool', turn: 2 },
      ],
    });
    expect(validateCallOrder(['Read', 'Grep', 'Edit'], result)).toHaveLength(0);
  });

  it('fails with wrong order', () => {
    const result = makeResult({
      actualCalls: [
        { name: 'Edit', callType: 'tool', turn: 0 },
        { name: 'Read', callType: 'tool', turn: 1 },
      ],
    });
    expect(validateCallOrder(['Read', 'Edit'], result)).toHaveLength(1);
  });
});
```

Create `tests/validator/context-budget.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { validateContextBudget } from '../src/validator/context-budget.js';
import { ScenarioSchema, ScenarioResultSchema } from '../src/scenario/models.js';

const makeScenario = (overrides = {}) =>
  ScenarioSchema.parse({ name: 'test', messages: [{ role: 'user', content: 'hello' }], ...overrides });
const makeResult = (overrides = {}) =>
  ScenarioResultSchema.parse({ scenarioName: 'test', ...overrides });

describe('validateContextBudget', () => {
  it('passes within budget', () => {
    const scenario = makeScenario({
      context_budget: { max_total_tokens: 10000, max_turns: 5 },
    });
    const result = makeResult({
      tokenUsage: { inputTokens: 3000, outputTokens: 1000 },
      turns: 2,
    });
    expect(validateContextBudget(scenario, result)).toHaveLength(0);
  });

  it('fails when tokens exceeded', () => {
    const scenario = makeScenario({
      context_budget: { max_total_tokens: 5000 },
    });
    const result = makeResult({
      tokenUsage: { inputTokens: 4000, outputTokens: 2000 },
    });
    const failures = validateContextBudget(scenario, result);
    expect(failures).toHaveLength(1);
    expect(failures[0].message).toContain('토큰 예산 초과');
  });

  it('fails when turns exceeded', () => {
    const scenario = makeScenario({ context_budget: { max_turns: 3 } });
    const result = makeResult({ turns: 5 });
    expect(validateContextBudget(scenario, result)).toHaveLength(1);
  });
});
```

Create `tests/validator/redundant-calls.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { validateNoRedundantCalls } from '../src/validator/redundant-calls.js';
import { ScenarioResultSchema } from '../src/scenario/models.js';

const makeResult = (overrides = {}) =>
  ScenarioResultSchema.parse({ scenarioName: 'test', ...overrides });

describe('validateNoRedundantCalls', () => {
  it('passes with no duplicates', () => {
    const result = makeResult({
      actualCalls: [
        { name: 'Read', callType: 'tool', input: { file_path: 'a.py' } },
        { name: 'Read', callType: 'tool', input: { file_path: 'b.py' } },
      ],
    });
    expect(validateNoRedundantCalls(result)).toHaveLength(0);
  });

  it('fails with duplicate call', () => {
    const result = makeResult({
      actualCalls: [
        { name: 'Read', callType: 'tool', input: { file_path: 'a.py' } },
        { name: 'Read', callType: 'tool', input: { file_path: 'a.py' } },
      ],
    });
    const failures = validateNoRedundantCalls(result);
    expect(failures).toHaveLength(1);
    expect(failures[0].message).toContain('중복');
  });
});
```

Create `tests/validator/validate.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { validate } from '../src/validator/validate.js';
import { ScenarioSchema, ScenarioResultSchema, Verdict } from '../src/scenario/models.js';

const makeScenario = (overrides = {}) =>
  ScenarioSchema.parse({ name: 'test', messages: [{ role: 'user', content: 'hello' }], ...overrides });
const makeResult = (overrides = {}) =>
  ScenarioResultSchema.parse({ scenarioName: 'test', ...overrides });

describe('validate', () => {
  it('passes valid scenario', () => {
    const scenario = makeScenario({
      expected_calls: [{ name: 'Read', call_type: 'tool' }],
      context_budget: { max_turns: 5 },
    });
    const result = makeResult({
      actualCalls: [{ name: 'Read', callType: 'tool' }],
      turns: 1,
    });
    const validated = validate(scenario, result);
    expect(validated.verdict).toBe(Verdict.PASS);
    expect(validated.failures).toHaveLength(0);
  });

  it('fails scenario with missing + forbidden', () => {
    const scenario = makeScenario({
      expected_calls: [{ name: 'Read', call_type: 'tool' }],
      forbidden_calls: [{ name: 'Write', call_type: 'tool' }],
    });
    const result = makeResult({
      actualCalls: [{ name: 'Write', callType: 'tool' }],
    });
    const validated = validate(scenario, result);
    expect(validated.verdict).toBe(Verdict.FAIL);
    expect(validated.failures).toHaveLength(2);
  });

  it('preserves ERROR verdict', () => {
    const scenario = makeScenario();
    const result = makeResult({ verdict: Verdict.ERROR, error: 'API error' });
    const validated = validate(scenario, result);
    expect(validated.verdict).toBe(Verdict.ERROR);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/validator/`
Expected: ALL FAIL — modules not found

**Step 3: Implement all validators**

Create `src/validator/expected-calls.ts`:
```typescript
import type { ActualCall, ExpectedCall, Scenario, ScenarioResult, ValidationFailure } from '../scenario/models.js';

function matchCall(expected: ExpectedCall, actualCalls: readonly ActualCall[]): ActualCall | null {
  for (const call of actualCalls) {
    if (call.callType !== expected.callType) continue;
    if (call.name !== expected.name) continue;
    if (expected.argsContain) {
      const allMatch = Object.entries(expected.argsContain).every(
        ([k, v]) => call.input[k] === v,
      );
      if (!allMatch) continue;
    }
    return call;
  }
  return null;
}

export function validateExpectedCalls(scenario: Scenario, result: ScenarioResult): ValidationFailure[] {
  const failures: ValidationFailure[] = [];
  for (const expected of scenario.expectedCalls) {
    const matched = matchCall(expected, result.actualCalls);
    if (matched === null && expected.required) {
      failures.push({
        rule: 'expected_call',
        message: `기대한 ${expected.callType} '${expected.name}'이(가) 호출되지 않았습니다`,
        expected,
        actual: result.actualCalls,
      });
    }
  }
  return failures;
}
```

Create `src/validator/forbidden-calls.ts`:
```typescript
import type { Scenario, ScenarioResult, ValidationFailure } from '../scenario/models.js';

export function validateForbiddenCalls(scenario: Scenario, result: ScenarioResult): ValidationFailure[] {
  const failures: ValidationFailure[] = [];
  for (const forbidden of scenario.forbiddenCalls) {
    for (const call of result.actualCalls) {
      if (call.callType === forbidden.callType && call.name === forbidden.name) {
        failures.push({
          rule: 'forbidden_call',
          message: `금지된 ${forbidden.callType} '${forbidden.name}'이(가) 호출되었습니다. 사유: ${forbidden.reason}`,
          expected: forbidden,
          actual: call,
        });
      }
    }
  }
  return failures;
}
```

Create `src/validator/call-order.ts`:
```typescript
import type { ScenarioResult, ValidationFailure } from '../scenario/models.js';

export function validateCallOrder(expectedOrder: string[], result: ScenarioResult): ValidationFailure[] {
  const failures: ValidationFailure[] = [];
  const actualNames = result.actualCalls.map((c) => c.name);
  let lastIdx = -1;

  for (const name of expectedOrder) {
    let found = false;
    for (let i = 0; i < actualNames.length; i++) {
      if (actualNames[i] === name && i > lastIdx) {
        lastIdx = i;
        found = true;
        break;
      }
    }
    if (!found) {
      failures.push({
        rule: 'call_order',
        message: `호출 순서 위반: '${name}'이(가) 기대한 순서에서 발견되지 않았습니다`,
        expected: expectedOrder,
        actual: actualNames,
      });
      break;
    }
  }

  return failures;
}
```

Create `src/validator/context-budget.ts`:
```typescript
import { computeTotalTokens, type Scenario, type ScenarioResult, type ValidationFailure } from '../scenario/models.js';

export function validateContextBudget(scenario: Scenario, result: ScenarioResult): ValidationFailure[] {
  const failures: ValidationFailure[] = [];
  const budget = scenario.contextBudget;
  const usage = result.tokenUsage;

  if (budget.maxInputTokens && usage.inputTokens > budget.maxInputTokens) {
    failures.push({
      rule: 'context_budget_input',
      message: `입력 토큰 예산 초과: ${usage.inputTokens} > ${budget.maxInputTokens}`,
      expected: budget.maxInputTokens,
      actual: usage.inputTokens,
    });
  }

  if (budget.maxOutputTokens && usage.outputTokens > budget.maxOutputTokens) {
    failures.push({
      rule: 'context_budget_output',
      message: `출력 토큰 예산 초과: ${usage.outputTokens} > ${budget.maxOutputTokens}`,
      expected: budget.maxOutputTokens,
      actual: usage.outputTokens,
    });
  }

  const totalTokens = computeTotalTokens(usage);
  if (budget.maxTotalTokens && totalTokens > budget.maxTotalTokens) {
    failures.push({
      rule: 'context_budget_total',
      message: `총 토큰 예산 초과: ${totalTokens} > ${budget.maxTotalTokens}`,
      expected: budget.maxTotalTokens,
      actual: totalTokens,
    });
  }

  if (budget.maxTurns && result.turns > budget.maxTurns) {
    failures.push({
      rule: 'context_budget_turns',
      message: `턴 수 예산 초과: ${result.turns} > ${budget.maxTurns}`,
      expected: budget.maxTurns,
      actual: result.turns,
    });
  }

  return failures;
}
```

Create `src/validator/redundant-calls.ts`:
```typescript
import type { ScenarioResult, ValidationFailure } from '../scenario/models.js';

export function validateNoRedundantCalls(
  result: ScenarioResult,
  dedupKeys?: string[],
): ValidationFailure[] {
  const failures: ValidationFailure[] = [];
  const seen = new Map<string, number[]>();

  for (let i = 0; i < result.actualCalls.length; i++) {
    const call = result.actualCalls[i];
    if (dedupKeys && !dedupKeys.includes(call.name)) continue;

    const sortedEntries = Object.entries(call.input).sort(([a], [b]) => a.localeCompare(b));
    const key = `${call.callType}:${call.name}:${JSON.stringify(sortedEntries)}`;

    const indices = seen.get(key);
    if (indices) {
      indices.push(i);
    } else {
      seen.set(key, [i]);
    }
  }

  for (const [key, indices] of seen) {
    if (indices.length > 1) {
      const toolName = key.split(':')[1];
      failures.push({
        rule: 'redundant_call',
        message: `중복 호출 감지: ${toolName}이(가) ${indices.length}회 동일 인자로 호출됨 (인덱스: ${JSON.stringify(indices)})`,
        expected: '1회 호출',
        actual: `${indices.length}회 호출`,
      });
    }
  }

  return failures;
}
```

Create `src/validator/validate.ts`:
```typescript
import { Verdict, type Scenario, type ScenarioResult, type ValidationFailure } from '../scenario/models.js';
import { validateExpectedCalls } from './expected-calls.js';
import { validateForbiddenCalls } from './forbidden-calls.js';
import { validateContextBudget } from './context-budget.js';
import { validateNoRedundantCalls } from './redundant-calls.js';

export function validate(scenario: Scenario, result: ScenarioResult): ScenarioResult {
  if (result.verdict === Verdict.ERROR) return result;

  const allFailures: ValidationFailure[] = [
    ...validateExpectedCalls(scenario, result),
    ...validateForbiddenCalls(scenario, result),
    ...validateContextBudget(scenario, result),
    ...validateNoRedundantCalls(result),
  ];

  return {
    ...result,
    failures: allFailures,
    verdict: allFailures.length > 0 ? Verdict.FAIL : Verdict.PASS,
  };
}
```

Create `src/validator/index.ts`:
```typescript
export { validateExpectedCalls } from './expected-calls.js';
export { validateForbiddenCalls } from './forbidden-calls.js';
export { validateCallOrder } from './call-order.js';
export { validateContextBudget } from './context-budget.js';
export { validateNoRedundantCalls } from './redundant-calls.js';
export { validate } from './validate.js';
```

**Step 4: Run all validator tests**

Run: `pnpm test -- tests/validator/`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/validator/ tests/validator/
git commit -m "feat: add validators (expected, forbidden, order, budget, redundant)"
```

---

### Task 6: Context Analyzer

**Files:**
- Create: `src/analyzer/context-analyzer.ts`
- Create: `src/analyzer/types.ts`
- Create: `src/analyzer/index.ts`
- Test: `tests/analyzer/context-analyzer.test.ts`

**Reference:** `src/agent_harness/context_analyzer.py`, `tests/test_context_analyzer.py`

**Step 1: Write failing test**

Create `tests/analyzer/context-analyzer.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { analyze } from '../src/analyzer/context-analyzer.js';
import { ScenarioResultSchema } from '../src/scenario/models.js';

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
```

**Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/analyzer/context-analyzer.test.ts`
Expected: FAIL

**Step 3: Implement**

Create `src/analyzer/types.ts`:
```typescript
export interface ContextReport {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  turns: number;
  tokensPerTurn: number;
  cacheHitRate: number;
  redundantCalls: number;
  uniqueToolsUsed: number;
  totalToolCalls: number;
  toolCallRatio: number;
  efficiencyScore: number;
  warnings: string[];
}
```

Create `src/analyzer/context-analyzer.ts`:
```typescript
import { computeTotalTokens, computeCacheHitRate, type ActualCall, type ScenarioResult } from '../scenario/models.js';
import type { ContextReport } from './types.js';

function countRedundantCalls(calls: readonly ActualCall[]): number {
  const seen = new Set<string>();
  let duplicates = 0;
  for (const call of calls) {
    const sortedEntries = Object.entries(call.input).sort(([a], [b]) => a.localeCompare(b));
    const key = `${call.callType}:${call.name}:${JSON.stringify(sortedEntries)}`;
    if (seen.has(key)) {
      duplicates++;
    } else {
      seen.add(key);
    }
  }
  return duplicates;
}

function computeEfficiency(report: ContextReport): number {
  const scores: number[] = [];

  // 1) 중복 호출 페널티
  if (report.totalToolCalls > 0) {
    scores.push(1.0 - report.redundantCalls / report.totalToolCalls);
  } else {
    scores.push(1.0);
  }

  // 2) 캐시 적중률 보너스
  scores.push(Math.min(report.cacheHitRate + 0.5, 1.0));

  // 3) 턴당 토큰 효율
  if (report.turns > 0) {
    const tpt = report.tokensPerTurn;
    if (tpt <= 5000) scores.push(1.0);
    else if (tpt <= 20000) scores.push(1.0 - (tpt - 5000) / 15000);
    else scores.push(0.0);
  } else {
    scores.push(1.0);
  }

  return scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
}

export function analyze(result: ScenarioResult): ContextReport {
  const usage = result.tokenUsage;
  const totalTokens = computeTotalTokens(usage);
  const cacheHitRate = computeCacheHitRate(usage);

  const report: ContextReport = {
    totalInputTokens: usage.inputTokens,
    totalOutputTokens: usage.outputTokens,
    totalTokens,
    turns: result.turns,
    tokensPerTurn: result.turns > 0 ? totalTokens / result.turns : 0,
    cacheHitRate,
    redundantCalls: countRedundantCalls(result.actualCalls),
    uniqueToolsUsed: new Set(result.actualCalls.map((c) => c.name)).size,
    totalToolCalls: result.actualCalls.length,
    toolCallRatio: result.turns > 0 ? result.actualCalls.length / result.turns : 0,
    efficiencyScore: 0,
    warnings: [],
  };

  // 경고 생성
  if (report.redundantCalls > 0) {
    report.warnings.push(
      `중복 도구 호출 ${report.redundantCalls}건 감지 - 컨텍스트 윈도우 낭비 가능`,
    );
  }
  if (report.tokensPerTurn > 10000) {
    report.warnings.push(
      `턴당 평균 ${Math.round(report.tokensPerTurn)} 토큰 사용 - 컨텍스트 윈도우 사용량이 높음`,
    );
  }
  if (report.turns > 5 && report.totalToolCalls < 2) {
    report.warnings.push('여러 턴을 사용했지만 도구 호출이 거의 없음 - 불필요한 대화 턴 가능');
  }
  if (report.cacheHitRate < 0.1 && usage.inputTokens > 10000) {
    report.warnings.push('캐시 적중률이 낮음 - 프롬프트 캐싱 활용 검토 필요');
  }

  report.efficiencyScore = computeEfficiency(report);
  return report;
}
```

Create `src/analyzer/index.ts`:
```typescript
export * from './context-analyzer.js';
export type * from './types.js';
```

**Step 4: Run tests**

Run: `pnpm test -- tests/analyzer/context-analyzer.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/analyzer/ tests/analyzer/
git commit -m "feat: add context analyzer"
```

---

### Task 7: Context Loader

**Files:**
- Create: `src/analyzer/context-loader.ts`
- Test: `tests/analyzer/context-loader.test.ts`

**Reference:** `src/agent_harness/context_loader.py`, `tests/test_context_loader.py`

This task implements the project context loader that reads CLAUDE.md, .claude/ config, file tree, and project metadata. Tests create temp directories with fixtures.

**Step 1: Write failing test**

Create `tests/analyzer/context-loader.test.ts` — mirrors `tests/test_context_loader.py` using `fs.mkdtempSync` + `fs.mkdirSync`/`fs.writeFileSync` for temp directories.

**Step 2: Implement**

Create `src/analyzer/context-loader.ts` — translates all functions from `context_loader.py` to TypeScript using `node:fs` and `node:path`.

Update `src/analyzer/index.ts` to also export context-loader.

**Step 3: Run tests and commit**

```bash
git add src/analyzer/ tests/analyzer/
git commit -m "feat: add context loader"
```

---

### Task 8: Tool Executor

**Files:**
- Create: `src/executor/tool-executor.ts`
- Create: `src/executor/types.ts`
- Create: `src/executor/index.ts`
- Test: `tests/executor/tool-executor.test.ts`

**Reference:** `src/agent_harness/tool_executor.py`, `tests/test_tool_executor.py`

This task implements the tool executor that runs Read/Grep/Glob/Bash with path sandboxing and dangerous command blocking.

**Step 1: Write failing test**

Create `tests/executor/tool-executor.test.ts` — mirrors `tests/test_tool_executor.py` using temp directories.

**Step 2: Implement**

Create `src/executor/types.ts`:
```typescript
export interface IToolExecutor {
  execute(toolName: string, toolInput: Record<string, unknown>): string;
}
```

Create `src/executor/tool-executor.ts` — translates `ToolExecutor` class, `_DANGEROUS_PATTERNS`, and all `_execute_*` methods.

**Step 3: Run tests and commit**

```bash
git add src/executor/ tests/executor/
git commit -m "feat: add tool executor"
```

---

### Task 9: Scenario Runner

**Files:**
- Create: `src/runner/types.ts`
- Modify: `src/runner/scenario-runner.ts`
- Modify: `src/runner/index.ts`
- Test: `tests/runner/scenario-runner.test.ts`

**Reference:** `src/agent_harness/runner.py`

This task implements the ScenarioRunner that calls the Anthropic API with DI for the API client and tool executor.

**Step 1: Create types**

Create `src/runner/types.ts`:
```typescript
export interface MessageParams {
  model: string;
  max_tokens: number;
  messages: Record<string, unknown>[];
  system?: string;
  tools?: Record<string, unknown>[];
}

export interface ApiClient {
  messages: {
    create(params: MessageParams): Promise<{
      content: Array<{ type: string; id?: string; name?: string; input?: Record<string, unknown>; text?: string }>;
      stop_reason: string;
      usage: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
    }>;
  };
}
```

**Step 2: Implement ScenarioRunner**

Create `src/runner/scenario-runner.ts` — translates `ScenarioRunner.run()` method, uses `classifyCall`, accepts `ApiClient` and `IToolExecutor` via constructor DI.

**Step 3: Write test with mocked API client**

Create `tests/runner/scenario-runner.test.ts` — test the runner with a mock API client that returns predefined responses.

**Step 4: Run tests and commit**

```bash
git add src/runner/ tests/runner/
git commit -m "feat: add scenario runner with DI"
```

---

### Task 10: Terminal Reporter

**Files:**
- Create: `src/reporter/terminal-reporter.ts`
- Create: `src/reporter/index.ts`

**Reference:** `src/agent_harness/reporter.py`

**Step 1: Implement reporter**

Create `src/reporter/terminal-reporter.ts` — uses `chalk` for colors and `cli-table3` for tables. Translates `print_result` and `print_summary`.

Create `src/reporter/index.ts`.

**Step 2: Verify compiles**

Run: `pnpm exec tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/reporter/
git commit -m "feat: add terminal reporter"
```

---

### Task 11: CLI Entry Point

**Files:**
- Create: `src/cli.ts`
- Modify: `src/index.ts`

**Reference:** `src/agent_harness/cli.py`

**Step 1: Implement CLI**

Create `src/cli.ts` — uses `commander` to define CLI. Translates `main()` from `cli.py`.

Update `src/index.ts` — barrel export public API.

**Step 2: Verify CLI works**

Run: `pnpm agent-harness scenarios/example_code_review.yaml --help`
Expected: Help text displayed

**Step 3: Verify build compiles**

Run: `pnpm build`
Expected: No errors

**Step 4: Commit**

```bash
git add src/cli.ts src/index.ts
git commit -m "feat: add CLI entry point"
```

---

### Task 12: Integration Verification

**Files:**
- All files

**Step 1: Run all tests**

Run: `pnpm test`
Expected: ALL PASS

**Step 2: Verify build**

Run: `pnpm build`
Expected: No errors, `dist/` populated

**Step 3: Verify YAML scenario compatibility**

Run: `pnpm agent-harness scenarios/ --help`
Expected: CLI runs, shows help

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete Python to TypeScript migration"
```
