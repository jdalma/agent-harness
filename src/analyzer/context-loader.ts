import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import type { Scenario } from '../scenario/models.js';

const IGNORE_DIRS = new Set([
  '.git', 'node_modules', '__pycache__', '.venv', 'venv',
  '.mypy_cache', '.pytest_cache', '.tox', 'dist', 'build',
  '.egg-info', '.next', '.nuxt', 'target', 'out',
]);

const PROJECT_MARKERS: Record<string, string> = {
  'pyproject.toml': 'python',
  'setup.py': 'python',
  'package.json': 'node',
  'Cargo.toml': 'rust',
  'go.mod': 'go',
  'pom.xml': 'java',
  'build.gradle': 'java',
  'Gemfile': 'ruby',
};

export interface ProjectContext {
  root: string;
  claudeMd: string | null;
  claudeConfig: Record<string, unknown>;
  fileTree: string;
  projectType: string;
  projectMetadata: Record<string, unknown>;
}

function readTextSafe(filePath: string, maxBytes = 50_000): string | null {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return null;
    if (stat.size > maxBytes) return null;
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function buildFileTree(root: string, maxDepth = 3, maxEntries = 200): string {
  const lines: string[] = [];
  let count = 0;

  function walk(directory: string, prefix: string, depth: number): void {
    if (depth > maxDepth || count >= maxEntries) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }

    const dirs = entries.filter((e) => e.isDirectory() && !IGNORE_DIRS.has(e.name)).sort((a, b) => a.name.localeCompare(b.name));
    const files = entries.filter((e) => e.isFile()).sort((a, b) => a.name.localeCompare(b.name));

    for (const f of files) {
      if (count >= maxEntries) {
        lines.push(`${prefix}... (truncated)`);
        return;
      }
      lines.push(`${prefix}${f.name}`);
      count++;
    }

    for (const d of dirs) {
      if (count >= maxEntries) {
        lines.push(`${prefix}... (truncated)`);
        return;
      }
      lines.push(`${prefix}${d.name}/`);
      count++;
      walk(path.join(directory, d.name), prefix + '  ', depth + 1);
    }
  }

  walk(root, '', 0);
  return lines.join('\n');
}

function detectProjectType(root: string): string {
  for (const [marker, projectType] of Object.entries(PROJECT_MARKERS)) {
    try {
      if (fs.statSync(path.join(root, marker)).isFile()) return projectType;
    } catch {
      // file doesn't exist
    }
  }
  return 'unknown';
}

function loadProjectMetadata(root: string, projectType: string): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};

  if (projectType === 'python') {
    const pyprojectPath = path.join(root, 'pyproject.toml');
    try {
      const content = fs.readFileSync(pyprojectPath, 'utf-8');
      metadata.config_file = 'pyproject.toml';
      metadata.raw_preview = content.slice(0, 2000);
    } catch {
      // file not found
    }
  } else if (projectType === 'node') {
    const pkgPath = path.join(root, 'package.json');
    try {
      const data = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      metadata.name = data.name ?? '';
      metadata.version = data.version ?? '';
      metadata.scripts = data.scripts ?? {};
      metadata.dependencies = Object.keys(data.dependencies ?? {});
      metadata.devDependencies = Object.keys(data.devDependencies ?? {});
    } catch {
      // parse error or file not found
    }
  }

  return metadata;
}

function loadClaudeConfig(root: string): Record<string, unknown> {
  const claudeDir = path.join(root, '.claude');
  const config: Record<string, unknown> = {};

  try {
    if (!fs.statSync(claudeDir).isDirectory()) return config;
  } catch {
    return config;
  }

  for (const entry of fs.readdirSync(claudeDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const filePath = path.join(claudeDir, entry.name);
    const content = readTextSafe(filePath);
    if (content === null) continue;

    if (entry.name.endsWith('.json')) {
      try {
        config[entry.name] = JSON.parse(content);
      } catch {
        config[entry.name] = content;
      }
    } else if (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml')) {
      try {
        config[entry.name] = YAML.parse(content);
      } catch {
        config[entry.name] = content;
      }
    } else {
      config[entry.name] = content;
    }
  }

  return config;
}

export function loadProjectContext(
  projectPath: string,
  maxDepth = 3,
  maxEntries = 200,
): ProjectContext {
  const root = path.resolve(projectPath);
  try {
    if (!fs.statSync(root).isDirectory()) {
      throw new Error(`프로젝트 경로를 찾을 수 없습니다: ${root}`);
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('프로젝트')) throw e;
    throw new Error(`프로젝트 경로를 찾을 수 없습니다: ${root}`);
  }

  let claudeMd = readTextSafe(path.join(root, 'CLAUDE.md'));
  if (claudeMd === null) {
    claudeMd = readTextSafe(path.join(root, '.claude', 'CLAUDE.md'));
  }

  const projectType = detectProjectType(root);

  return {
    root,
    claudeMd,
    claudeConfig: loadClaudeConfig(root),
    fileTree: buildFileTree(root, maxDepth, maxEntries),
    projectType,
    projectMetadata: loadProjectMetadata(root, projectType),
  };
}

export function buildContextPrompt(context: ProjectContext): string {
  const sections: string[] = [];

  sections.push(`## 프로젝트 정보\n- 경로: ${context.root}\n- 타입: ${context.projectType}`);

  if (context.claudeMd) {
    sections.push(`## CLAUDE.md\n${context.claudeMd}`);
  }

  if (Object.keys(context.claudeConfig).length > 0) {
    const configSummary = Object.keys(context.claudeConfig).join(', ');
    sections.push(`## .claude/ 설정 파일\n포함 파일: ${configSummary}`);
  }

  if (context.fileTree) {
    sections.push(`## 파일 구조\n\`\`\`\n${context.fileTree}\n\`\`\``);
  }

  if (Object.keys(context.projectMetadata).length > 0) {
    const metaLines: string[] = [];
    for (const [k, v] of Object.entries(context.projectMetadata)) {
      if (k === 'raw_preview') continue;
      if (Array.isArray(v)) {
        metaLines.push(`- ${k}: ${v.join(', ')}`);
      } else if (typeof v === 'object' && v !== null) {
        metaLines.push(`- ${k}: ${JSON.stringify(v)}`);
      } else {
        metaLines.push(`- ${k}: ${v}`);
      }
    }
    if (metaLines.length > 0) {
      sections.push('## 프로젝트 메타데이터\n' + metaLines.join('\n'));
    }
  }

  return sections.join('\n\n');
}

export function injectContext(scenario: Scenario, context: ProjectContext): Scenario {
  const contextText = buildContextPrompt(context);
  const separator = '\n\n---\n\n';

  if (scenario.systemPrompt) {
    return { ...scenario, systemPrompt: contextText + separator + scenario.systemPrompt };
  }
  return { ...scenario, systemPrompt: contextText };
}
