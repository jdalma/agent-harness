import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import type { IToolExecutor } from './types.js';

const DANGEROUS_PATTERNS = [
  /\brm\s+-rf\b/,
  /\brm\s+-r\b/,
  /\bmkfs\b/,
  /\bdd\s+if=/,
  /\b:[(][)]\s*[{]/,           // fork bomb
  /\bshutdown\b/,
  /\breboot\b/,
  /\bsudo\b/,
  /\bchmod\s+777\b/,
  /\bcurl\b.*\|\s*bash/,
  /\bwget\b.*\|\s*bash/,
];

export class ToolExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolExecutionError';
  }
}

export class ToolExecutor implements IToolExecutor {
  private readonly root: string;
  private readonly allowed: Set<string>;
  private readonly bashTimeout: number;

  constructor(
    projectRoot: string,
    options?: { allowedTools?: Set<string>; bashTimeout?: number },
  ) {
    this.root = path.resolve(projectRoot);
    if (!fs.existsSync(this.root) || !fs.statSync(this.root).isDirectory()) {
      throw new Error(`프로젝트 경로가 존재하지 않습니다: ${this.root}`);
    }
    this.allowed = options?.allowedTools ?? new Set(['Read', 'Grep', 'Glob']);
    this.bashTimeout = options?.bashTimeout ?? 30;
  }

  get projectRoot(): string {
    return this.root;
  }

  private resolvePath(filePath: string): string {
    let p = path.isAbsolute(filePath) ? filePath : path.join(this.root, filePath);
    p = path.resolve(p);

    if (!p.startsWith(this.root)) {
      throw new ToolExecutionError(
        `프로젝트 루트 바깥 경로 접근 차단: ${filePath} → ${p}`,
      );
    }
    return p;
  }

  execute(toolName: string, toolInput: Record<string, unknown>): string {
    if (!this.allowed.has(toolName)) {
      return `[harness] ${toolName} 도구는 실제 실행이 허용되지 않음 (simulated)`;
    }

    const dispatch: Record<string, (input: Record<string, unknown>) => string> = {
      Read: (input) => this.executeRead(input),
      Grep: (input) => this.executeGrep(input),
      Glob: (input) => this.executeGlob(input),
      Bash: (input) => this.executeBash(input),
    };

    const handler = dispatch[toolName];
    if (!handler) {
      return `[harness] ${toolName} 도구는 실행기에 구현되지 않음 (simulated)`;
    }

    try {
      return handler(toolInput);
    } catch (e) {
      if (e instanceof ToolExecutionError) {
        return `[error] ${e.message}`;
      }
      return `[error] ${toolName} 실행 실패: ${e}`;
    }
  }

  private executeRead(toolInput: Record<string, unknown>): string {
    const filePath = (toolInput.file_path as string) ?? '';
    if (!filePath) return '[error] file_path가 지정되지 않음';

    const resolved = this.resolvePath(filePath);
    try {
      if (!fs.statSync(resolved).isFile()) {
        return `[error] 파일을 찾을 수 없음: ${filePath}`;
      }
    } catch {
      return `[error] 파일을 찾을 수 없음: ${filePath}`;
    }

    const offset = (toolInput.offset as number) ?? 0;
    const limit = (toolInput.limit as number) ?? 2000;

    let content: string;
    try {
      content = fs.readFileSync(resolved, 'utf-8');
    } catch {
      return `[error] 바이너리 파일은 읽을 수 없음: ${filePath}`;
    }

    const lines = content.split('\n');
    // Remove trailing empty string from split if file ends with newline
    if (lines[lines.length - 1] === '') lines.pop();
    const selected = lines.slice(offset, offset + limit);
    const numbered = selected.map(
      (line, i) => `${String(i + offset + 1).padStart(6)}\t${line}`,
    );
    return numbered.join('\n');
  }

  private executeGrep(toolInput: Record<string, unknown>): string {
    const patternStr = (toolInput.pattern as string) ?? '';
    if (!patternStr) return '[error] pattern이 지정되지 않음';

    const searchPath = (toolInput.path as string) ?? this.root;
    const resolved = this.resolvePath(searchPath);

    let regex: RegExp;
    try {
      const flags = toolInput['-i'] ? 'i' : '';
      regex = new RegExp(patternStr, flags);
    } catch (e) {
      return `[error] 잘못된 정규식: ${e}`;
    }

    const globFilter = toolInput.glob as string | undefined;
    const outputMode = (toolInput.output_mode as string) ?? 'files_with_matches';

    const matches: string[] = [];
    const maxResults = 100;

    const files = this.collectFiles(resolved, globFilter);

    for (const file of files) {
      if (matches.length >= maxResults) break;

      let content: string;
      try {
        content = fs.readFileSync(file, 'utf-8');
      } catch {
        continue;
      }

      const fileMatches: [number, string][] = [];
      const contentLines = content.split('\n');
      for (let i = 0; i < contentLines.length; i++) {
        if (regex.test(contentLines[i])) {
          fileMatches.push([i + 1, contentLines[i]]);
        }
      }

      if (fileMatches.length > 0) {
        const rel = path.relative(this.root, file);
        if (outputMode === 'files_with_matches') {
          matches.push(rel);
        } else if (outputMode === 'content') {
          for (const [lineNo, line] of fileMatches) {
            matches.push(`${rel}:${lineNo}:${line}`);
          }
        } else if (outputMode === 'count') {
          matches.push(`${rel}:${fileMatches.length}`);
        }
      }
    }

    if (matches.length === 0) {
      return `[no matches for pattern: ${patternStr}]`;
    }
    return matches.join('\n');
  }

  private executeGlob(toolInput: Record<string, unknown>): string {
    const pattern = (toolInput.pattern as string) ?? '';
    if (!pattern) return '[error] pattern이 지정되지 않음';

    const searchPath = (toolInput.path as string) ?? this.root;
    const resolved = this.resolvePath(searchPath);

    const matched: string[] = [];
    const maxResults = 200;

    const allFiles = this.collectAllFiles(resolved);
    for (const file of allFiles) {
      if (matched.length >= maxResults) break;
      const rel = path.relative(this.root, file);
      const basename = path.basename(file);
      if (this.matchGlob(rel, pattern) || this.matchGlob(basename, pattern)) {
        matched.push(rel);
      }
    }

    if (matched.length === 0) {
      return `[no files matching: ${pattern}]`;
    }
    return matched.join('\n');
  }

  private executeBash(toolInput: Record<string, unknown>): string {
    const command = (toolInput.command as string) ?? '';
    if (!command) return '[error] command가 지정되지 않음';

    for (const dangerous of DANGEROUS_PATTERNS) {
      if (dangerous.test(command)) {
        return `[blocked] 위험한 명령이 감지됨: ${command}`;
      }
    }

    try {
      const result = execSync(command, {
        cwd: this.root,
        timeout: this.bashTimeout * 1000,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return result.trim() || '[no output]';
    } catch (e: unknown) {
      const err = e as { killed?: boolean; stdout?: string; stderr?: string; status?: number };
      if (err.killed) {
        return `[timeout] 명령이 ${this.bashTimeout}초 내에 완료되지 않음`;
      }
      let output = err.stdout ?? '';
      if (err.stderr) output += `\n[stderr]\n${err.stderr}`;
      if (err.status != null) output += `\n[exit code: ${err.status}]`;
      return output.trim() || '[no output]';
    }
  }

  private collectFiles(dirPath: string, globFilter?: string): string[] {
    const stat = fs.statSync(dirPath);
    if (stat.isFile()) return [dirPath];

    const files: string[] = [];
    const maxFiles = 1000;

    const walk = (dir: string): void => {
      if (files.length >= maxFiles) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));

      for (const entry of entries) {
        if (files.length >= maxFiles) return;
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          // Skip hidden directories
          if (entry.name.startsWith('.') && entry.name !== '.') continue;
          walk(fullPath);
        } else if (entry.isFile()) {
          const rel = path.relative(this.root, fullPath);
          const parts = rel.split(path.sep);
          if (parts.some((p) => p.startsWith('.') && p !== '.')) continue;
          if (globFilter && !this.matchGlob(entry.name, globFilter)) continue;
          files.push(fullPath);
        }
      }
    };

    walk(dirPath);
    return files;
  }

  private collectAllFiles(dirPath: string): string[] {
    const files: string[] = [];
    const maxFiles = 200;

    const walk = (dir: string): void => {
      if (files.length >= maxFiles) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));

      for (const entry of entries) {
        if (files.length >= maxFiles) return;
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile()) {
          files.push(fullPath);
        }
      }
    };

    walk(dirPath);
    return files;
  }

  private matchGlob(str: string, pattern: string): boolean {
    // Convert glob pattern to regex
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '<<<GLOBSTAR>>>')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]')
      .replace(/<<<GLOBSTAR>>>/g, '.*');
    return new RegExp(`^${escaped}$`).test(str);
  }
}
