import chalk from 'chalk';

export type LogLevel = 'quiet' | 'normal' | 'verbose';

export class Logger {
  private readonly level: LogLevel;

  constructor(level: LogLevel = 'normal') {
    this.level = level;
  }

  scenarioStart(name: string, index: number, total: number): void {
    if (this.level === 'quiet') return;
    this.write(`[${index}/${total}] ▶ ${name} ...\n`);
  }

  scenarioEnd(name: string, verdict: string, durationMs: number): void {
    if (this.level === 'quiet') return;
    const label = verdict === 'pass'
      ? chalk.green('PASS')
      : verdict === 'fail'
        ? chalk.red('FAIL')
        : chalk.yellow('ERROR');
    this.write(`[${label}] ${name} (${durationMs}ms)\n`);
  }

  turn(_scenarioName: string, turnNum: number): void {
    if (this.level !== 'verbose') return;
    this.write(`  ↻ Turn ${turnNum}\n`);
  }

  toolCall(callType: string, name: string, turn: number): void {
    if (this.level !== 'verbose') return;
    this.write(`    T${turn} ${callType}:${name}\n`);
  }

  info(message: string): void {
    if (this.level === 'quiet') return;
    this.write(`${message}\n`);
  }

  private write(text: string): void {
    process.stderr.write(text);
  }
}
