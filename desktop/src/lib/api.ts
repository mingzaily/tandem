import { Channel, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export type Agent = 'claude' | 'codex' | 'pi';

export interface TaskSummary {
  id: string;
  title: string;
  cwd: string;
  updatedAtMs: number;
  agent: Agent;
}

export type MessageKind = 'user' | 'assistant' | 'thinking' | 'tool_use' | 'tool_result' | 'compaction';

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
  /** The level the model runs at when none is chosen. Missing while it could not be read. */
  defaultEffort?: string | null;
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
  ignoreExternalWriter?: boolean;
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

export interface DiscoveredProject {
  cwd: string;
  lastActiveMs: number;
}
export const listTasks = (roots: string[]) => invoke<TaskSummary[]>('list_tasks', { roots });
export const listCodexTasks = (roots: string[], conversationRoots: string[]) =>
  invoke<TaskSummary[]>('list_codex_tasks', { roots, conversationRoots });
export const discoverProjects = () => invoke<DiscoveredProject[]>('discover_projects');
export const defaultConversationDir = () => invoke<string>('default_conversation_dir');
export const createConversationDir = (base: string | null) => invoke<string>('create_conversation_dir', { base });
export const taskStamp = (agent: Agent, id: string) => invoke<string | null>('task_stamp', { agent, id });
export const listPiTasks = (roots: string[], conversationRoots: string[]) =>
  invoke<TaskSummary[]>('list_pi_tasks', { roots, conversationRoots });
const READ_COMMANDS: Record<Agent, string> = { claude: 'read_task', codex: 'read_codex_task', pi: 'read_pi_task' };
export const readTask = (agent: Agent, id: string) => invoke<TaskContent>(READ_COMMANDS[agent], { id });
export const readPiInfo = () => invoke<CliInfo>('pi_info');
export const readCodexInfo = () => invoke<CliInfo>('codex_info');
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
  command: 'claude' | 'codex' | 'pi';
  installed: boolean;
  version: string | null;
  login: { loggedIn: boolean; detail: string | null } | null;
}
export type JobEvent = { type: 'line'; text: string } | { type: 'finished'; ok: boolean };
function jobChannel(onEvent: (event: JobEvent) => void) {
  const channel = new Channel<JobEvent>();
  channel.onmessage = onEvent;
  return channel;
}
export const installAgent = (command: string, onEvent: (event: JobEvent) => void) =>
  invoke<void>('install_agent', { command, onEvent: jobChannel(onEvent) });
export const loginAgent = (command: string, onEvent: (event: JobEvent) => void) =>
  invoke<void>('login_agent', { command, onEvent: jobChannel(onEvent) });
export const stopAgentJob = () => invoke<void>('stop_agent_job');
export interface ExternalWriter {
  taskId: string;
  pid: number;
  isBusy: boolean;
  fromTerminal: boolean;
  canOverride: boolean;
}
export const externalWriters = () => invoke<ExternalWriter[]>('external_writers');
export type TrayTaskStatus = 'running' | 'waiting' | 'elsewhere';
export interface TrayTask {
  id: string;
  title: string;
  agent: Agent;
  status: TrayTaskStatus;
  project: string;
}
export interface TrayWindow {
  name: 'short' | 'week';
  remaining: number;
  resetIn: string;
  isLow: boolean;
}
/** One agent's limits. Its tube shows whichever window runs out first. */
export interface TraySource {
  agent: Agent;
  windows: TrayWindow[];
}
export interface TraySummary {
  tasks: TrayTask[];
  sources: TraySource[];
}
export const updateTray = (summary: TraySummary) =>
  invoke<void>('update_tray', { update: { count: summary.tasks.length, summary } });
export const traySummary = () => invoke<TraySummary | null>('tray_summary');
export const resizeTrayPanel = (height: number) => invoke<void>('resize_tray_panel', { height });
export const trayPanelAction = (action: 'open' | 'settings' | 'quit' | 'task', taskId?: string) =>
  invoke<void>('tray_panel_action', { action, taskId: taskId ?? null });
export const onTraySummary = (handler: (summary: TraySummary) => void) =>
  listen<TraySummary>('tray-summary', (event) => handler(event.payload));
export const onTrayOpenSettings = (handler: () => void) => listen('tray-open-settings', () => handler());
export const notifyUser = (title: string, body: string) => invoke<void>('notify_user', { title, body });
export const setKeepRunning = (value: boolean) => invoke<void>('set_keep_running', { value });
export const onTrayOpenTask = (handler: (id: string) => void) =>
  listen<string>('tray-open-task', (event) => handler(event.payload));
export const pickProject = () => invoke<string | null>('pick_project');
export const gitBranch = (cwd: string) => invoke<string | null>('git_branch', { cwd });
export const revealTaskFolder = (agent: Agent, id: string) => invoke<void>('reveal_task_folder', { agent, id });
export const agentStatus = () => invoke<AgentStatus[]>('agent_status');
export const pickAttachments = () => invoke<AddResult>('pick_attachments');
export const addPastedImage = (data: string) => invoke<Attachment>('add_pasted_image', { data });
export const removeAttachment = (id: string) => invoke<void>('remove_attachment', { id });
export const onAttachmentsDropped = (handler: (result: AddResult) => void) =>
  listen<AddResult>('attachments-dropped', (event) => handler(event.payload));
export const onAttachmentDrag = (handler: (isOver: boolean) => void) =>
  listen<boolean>('attachment-drag', (event) => handler(event.payload));

export function sendTurn(
  agent: Agent,
  target: { taskId: string } | { cwd: string },
  prompt: string,
  attachments: Attachment[],
  options: TurnOptions,
  onEvent: (event: TurnEvent) => void,
): Promise<void> {
  const channel = new Channel<TurnEvent>();
  channel.onmessage = onEvent;
  return invoke('send_turn', {
    agent,
    taskId: 'taskId' in target ? target.taskId : null,
    cwd: 'cwd' in target ? target.cwd : null,
    attachmentIds: attachments.map((attachment) => attachment.id),
    prompt,
    options,
    onEvent: channel,
  });
}
