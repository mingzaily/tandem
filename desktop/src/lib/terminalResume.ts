import type { Agent, TaskSummary } from './api';

const RESUME_COMMANDS: Record<Agent, string> = {
  claude: 'claude --resume',
  codex: 'codex resume',
  pi: 'pi --session',
};

export function terminalResumeCommand(task: Pick<TaskSummary, 'agent' | 'id' | 'cwd'>): string {
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  return `cd -- ${quote(task.cwd)} && ${RESUME_COMMANDS[task.agent]} ${quote(task.id)}`;
}
