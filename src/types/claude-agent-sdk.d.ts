// Optional dependency — only required when using runner: agent-sdk
declare module '@anthropic-ai/claude-agent-sdk' {
  export function query(options: {
    prompt: string | AsyncIterable<unknown>;
    options?: Record<string, unknown>;
  }): AsyncGenerator<Record<string, unknown>, void>;
}
