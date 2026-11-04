import { Channel, invoke } from '@tauri-apps/api/core';

export interface TaskSummary {
  id: string;
  title: string;
  cwd: string;
  updatedAtMs: number;
}

export type MessageKind = 'user' | 'assistant' | 'thinking' | 'tool_use' | 'tool_result';

export interface Message {
  id: string;
  kind: MessageKind;
  text: string;
  toolName?: string;
  toolUseId?: string;
  isError: boolean;
  truncated: boolean;
  timestamp?: string;
}

export type TurnEvent =
  | { type: 'started'; taskId: string }
  | { type: 'textDelta'; text: string }
  | { type: 'thinkingDelta'; text: string }
  | { type: 'toolUse'; id: string; name: string; input: string }
  | { type: 'toolResult'; toolUseId: string; text: string; isError: boolean }
  | {
      type: 'finished';
      isError: boolean;
      cancelled: boolean;
      message: string | null;
      deniedTools: string[];
    };

export const listTasks = () => invoke<TaskSummary[]>('list_tasks');
export const readTask = (id: string) => invoke<Message[]>('read_task', { id });
export const cancelTurn = (taskId: string) => invoke<void>('cancel_turn', { taskId });
export const openExternal = (url: string) => invoke<void>('open_external', { url });
export const appReady = () => invoke<void>('app_ready');

export function sendTurn(
  target: { taskId: string } | { cwd: string },
  prompt: string,
  onEvent: (event: TurnEvent) => void,
): Promise<void> {
  const channel = new Channel<TurnEvent>();
  channel.onmessage = onEvent;
  return invoke('send_turn', {
    taskId: 'taskId' in target ? target.taskId : null,
    cwd: 'cwd' in target ? target.cwd : null,
    prompt,
    onEvent: channel,
  });
}
