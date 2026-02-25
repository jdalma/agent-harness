export interface IToolExecutor {
  execute(toolName: string, toolInput: Record<string, unknown>): string;
}
