import { Channel, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

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
  image?: string;
}

export interface TaskContext {
  usedTokens: number;
  model?: string | null;
}

export interface TaskContent {
  messages: Message[];
  context: TaskContext | null;
}

export interface UsageWindow {
  usedPercent: number;
  /** Seconds since the epoch from a running turn, an ISO date when asked directly. */
  resetsAt: number | string | null;
}

export interface UsageWindows {
  fiveHour: UsageWindow | null;
  sevenDay: UsageWindow | null;
}

export interface ModelOption {
  value: string;
  displayName: string;
  description: string;
  resolvedModel: string;
  supportsEffort: boolean;
  supportedEffortLevels: string[];
  supportsAutoMode: boolean;
}

export interface CliInfo {
  models: ModelOption[];
  usage: UsageWindows | null;
}

export interface TurnOptions {
  model: string | null;
  effort: string | null;
  permissionMode: string | null;
  worktree?: boolean;
}

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface Question {
  question: string;
  header?: string;
  options?: QuestionOption[];
  multiSelect?: boolean;
}

export type Decision =
  | { kind: 'allow' }
  | { kind: 'allowForTask' }
  | { kind: 'deny' }
  | { kind: 'answer'; answers: Record<string, string> };

export type TurnEvent =
  | { type: 'started'; taskId: string }
  | { type: 'textDelta'; text: string }
  | { type: 'thinkingDelta'; text: string }
  | { type: 'toolUse'; id: string; name: string; input: string }
  | { type: 'toolResult'; toolUseId: string; text: string; isError: boolean }
  | {
      type: 'permissionRequest';
      requestId: string;
      toolName: string;
      input: string;
      description: string | null;
      rules: string[];
    }
  | { type: 'question'; requestId: string; questions: Question[] }
  | { type: 'requestSettled'; requestId: string }
  | { type: 'outputTokens'; total: number }
  | { type: 'contextUsage'; usedTokens: number; model: string | null }
  | { type: 'contextWindow'; model: string; tokens: number }
  | { type: 'rateLimits'; windows: UsageWindows }
  | { type: 'finished'; isError: boolean; cancelled: boolean; message: string | null };

export type PendingRequest = Extract<TurnEvent, { type: 'permissionRequest' | 'question' }>;

export const listTasks = () => invoke<TaskSummary[]>('list_tasks');
export const readTask = (id: string) => invoke<TaskContent>('read_task', { id });
export const cancelTurn = (taskId: string) => invoke<void>('cancel_turn', { taskId });
export const answerRequest = (taskId: string, requestId: string, decision: Decision) =>
  invoke<void>('answer_request', { taskId, requestId, decision });
export const readCliInfo = () => invoke<CliInfo>('cli_info');
export const openExternal = (url: string) => invoke<void>('open_external', { url });
export const appReady = () => invoke<void>('app_ready');

export interface Attachment {
  id: string;
  name: string;
  kind: 'image' | 'file';
  path?: string;
  preview?: string;
}
export interface AddResult {
  added: Attachment[];
  errors: string[];
}
export interface AgentStatus {
  command: string;
  path?: string | null;
  version?: string | null;
}
export const pickProject = () => invoke<string | null>('pick_project');
export const gitBranch = (cwd: string) => invoke<string | null>('git_branch', { cwd });
export const revealTaskFolder = (id: string) => invoke<void>('reveal_task_folder', { id });
export const agentStatus = () => invoke<AgentStatus[]>('agent_status');
export const pickAttachments = () => invoke<AddResult>('pick_attachments');
export const addPastedImage = (data: string) => invoke<Attachment>('add_pasted_image', { data });
export const removeAttachment = (id: string) => invoke<void>('remove_attachment', { id });
export const onAttachmentsDropped = (handler: (result: AddResult) => void) =>
  listen<AddResult>('attachments-dropped', (event) => handler(event.payload));
export const onAttachmentDrag = (handler: (isOver: boolean) => void) =>
  listen<boolean>('attachment-drag', (event) => handler(event.payload));

export function sendTurn(
  target: { taskId: string } | { cwd: string },
  prompt: string,
  attachments: Attachment[],
  options: TurnOptions,
  onEvent: (event: TurnEvent) => void,
): Promise<void> {
  const channel = new Channel<TurnEvent>();
  channel.onmessage = onEvent;
  return invoke('send_turn', {
    taskId: 'taskId' in target ? target.taskId : null,
    cwd: 'cwd' in target ? target.cwd : null,
    attachmentIds: attachments.map((attachment) => attachment.id),
    prompt,
    options,
    onEvent: channel,
  });
}
