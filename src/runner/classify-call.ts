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
