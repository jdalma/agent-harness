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
