import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadProjectContext, buildContextPrompt, injectContext } from '../../src/analyzer/context-loader.js';
import { ScenarioSchema } from '../../src/scenario/models.js';

function createTempProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-test-'));
  return dir;
}

describe('loadProjectContext', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = createTempProject();

    // CLAUDE.md
    fs.writeFileSync(
      path.join(projectDir, 'CLAUDE.md'),
      '# 프로젝트 지침\n이 프로젝트는 Python 기반입니다.\n',
    );

    // .claude/ directory
    const claudeDir = path.join(projectDir, '.claude');
    fs.mkdirSync(claudeDir);
    fs.writeFileSync(
      path.join(claudeDir, 'settings.json'),
      JSON.stringify({ model: 'claude-sonnet-4-20250514' }),
    );

    // pyproject.toml
    fs.writeFileSync(
      path.join(projectDir, 'pyproject.toml'),
      '[project]\nname = "test-project"\nversion = "1.0.0"\n',
    );

    // source files
    const srcDir = path.join(projectDir, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, 'main.py'), "def hello():\n    print('hello')\n");
    fs.writeFileSync(path.join(srcDir, 'utils.py'), "def add(a, b):\n    return a + b\n");

    // tests
    const testsDir = path.join(projectDir, 'tests');
    fs.mkdirSync(testsDir);
    fs.writeFileSync(path.join(testsDir, 'test_main.py'), "def test_hello():\n    pass\n");
  });

  it('loads CLAUDE.md', () => {
    const ctx = loadProjectContext(projectDir);
    expect(ctx.claudeMd).not.toBeNull();
    expect(ctx.claudeMd!).toContain('프로젝트 지침');
  });

  it('loads .claude/ config', () => {
    const ctx = loadProjectContext(projectDir);
    expect(ctx.claudeConfig['settings.json']).toBeDefined();
    expect((ctx.claudeConfig['settings.json'] as Record<string, unknown>).model).toBe('claude-sonnet-4-20250514');
  });

  it('detects python project', () => {
    const ctx = loadProjectContext(projectDir);
    expect(ctx.projectType).toBe('python');
  });

  it('detects node project', () => {
    const nodeDir = createTempProject();
    fs.writeFileSync(
      path.join(nodeDir, 'package.json'),
      JSON.stringify({
        name: 'test-app', version: '2.0.0',
        scripts: { test: 'jest' },
        dependencies: { express: '^4.18.0' },
        devDependencies: { jest: '^29.0.0' },
      }),
    );
    const ctx = loadProjectContext(nodeDir);
    expect(ctx.projectType).toBe('node');
  });

  it('file tree includes sources', () => {
    const ctx = loadProjectContext(projectDir);
    expect(ctx.fileTree).toContain('main.py');
    expect(ctx.fileTree).toContain('utils.py');
  });

  it('node project metadata', () => {
    const nodeDir = createTempProject();
    fs.writeFileSync(
      path.join(nodeDir, 'package.json'),
      JSON.stringify({
        name: 'test-app', version: '2.0.0',
        dependencies: { express: '^4.18.0' },
        devDependencies: { jest: '^29.0.0', typescript: '^5.0.0' },
      }),
    );
    const ctx = loadProjectContext(nodeDir);
    expect(ctx.projectMetadata.name).toBe('test-app');
    expect((ctx.projectMetadata.dependencies as string[])).toContain('express');
    expect((ctx.projectMetadata.devDependencies as string[])).toContain('jest');
  });

  it('throws for missing project', () => {
    expect(() => loadProjectContext('/nonexistent/path/to/project')).toThrow();
  });

  it('handles no CLAUDE.md', () => {
    const emptyDir = createTempProject();
    fs.writeFileSync(path.join(emptyDir, 'main.py'), 'pass\n');
    const ctx = loadProjectContext(emptyDir);
    expect(ctx.claudeMd).toBeNull();
    expect(ctx.projectType).toBe('unknown');
  });

  it('reads CLAUDE.md from .claude/ dir', () => {
    const dir = createTempProject();
    const claudeDir = path.join(dir, '.claude');
    fs.mkdirSync(claudeDir);
    fs.writeFileSync(path.join(claudeDir, 'CLAUDE.md'), '# 내부 지침\n');
    const ctx = loadProjectContext(dir);
    expect(ctx.claudeMd).not.toBeNull();
    expect(ctx.claudeMd!).toContain('내부 지침');
  });
});

describe('buildContextPrompt', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = createTempProject();
    fs.writeFileSync(path.join(projectDir, 'CLAUDE.md'), '# 프로젝트 지침\n');
    fs.writeFileSync(path.join(projectDir, 'pyproject.toml'), '[project]\nname = "test"\n');
    const srcDir = path.join(projectDir, 'src');
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, 'main.py'), "print('hello')\n");
  });

  it('includes project info', () => {
    const ctx = loadProjectContext(projectDir);
    const prompt = buildContextPrompt(ctx);
    expect(prompt).toContain('프로젝트 정보');
    expect(prompt).toContain('python');
  });

  it('includes CLAUDE.md', () => {
    const ctx = loadProjectContext(projectDir);
    const prompt = buildContextPrompt(ctx);
    expect(prompt).toContain('CLAUDE.md');
    expect(prompt).toContain('프로젝트 지침');
  });

  it('includes file tree', () => {
    const ctx = loadProjectContext(projectDir);
    const prompt = buildContextPrompt(ctx);
    expect(prompt).toContain('파일 구조');
    expect(prompt).toContain('main.py');
  });

  it('omits CLAUDE.md section when absent', () => {
    const emptyDir = createTempProject();
    fs.writeFileSync(path.join(emptyDir, 'main.py'), 'pass\n');
    const ctx = loadProjectContext(emptyDir);
    const prompt = buildContextPrompt(ctx);
    expect(prompt).not.toContain('CLAUDE.md');
  });
});

describe('injectContext', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = createTempProject();
    fs.writeFileSync(path.join(projectDir, 'CLAUDE.md'), '# 프로젝트 지침\n');
    fs.writeFileSync(path.join(projectDir, 'pyproject.toml'), '[project]\nname = "test"\n');
  });

  it('prepends to system prompt', () => {
    const ctx = loadProjectContext(projectDir);
    const scenario = ScenarioSchema.parse({
      name: 'test',
      system_prompt: '기존 프롬프트입니다.',
      messages: [{ role: 'user', content: 'hello' }],
    });
    const injected = injectContext(scenario, ctx);
    expect(injected.systemPrompt).toContain('프로젝트 정보');
    expect(injected.systemPrompt).toContain('기존 프롬프트입니다.');
    const ctxPos = injected.systemPrompt.indexOf('프로젝트 정보');
    const origPos = injected.systemPrompt.indexOf('기존 프롬프트입니다.');
    expect(ctxPos).toBeLessThan(origPos);
  });

  it('sets system prompt when empty', () => {
    const ctx = loadProjectContext(projectDir);
    const scenario = ScenarioSchema.parse({
      name: 'test',
      messages: [{ role: 'user', content: 'hello' }],
    });
    const injected = injectContext(scenario, ctx);
    expect(injected.systemPrompt).toContain('프로젝트 정보');
  });
});
