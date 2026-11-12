import { Channel, invoke } from '@tauri-apps/api/core';
import { emitTo, listen } from '@tauri-apps/api/event';
import type { PreferencesSnapshot } from './storage';

export const readPreferences = () => invoke<PreferencesSnapshot>('preferences');
export const updatePreferences = (target: 'config' | 'state', patch: Record<string, unknown>) => invoke<PreferencesSnapshot>('update_preferences', { target, patch });
export const onPreferencesChanged = (handler: (snapshot: PreferencesSnapshot) => void) => listen<PreferencesSnapshot>('preferences-changed', ({ payload }) => handler(payload));
export const setSystemLanguage = (language: 'zh' | 'en') => invoke<void>('set_system_language', { language });

import type { UpdateState } from './appUpdate';

export interface AppUpdate { version: string; notes: string | null }
export interface UpdateProgress { downloaded: number; total: number | null }
export const readAppUpdate = () => invoke<UpdateState>('update_state');
export const onAppUpdateChanged = (handler: (value: UpdateState) => void) => listen<UpdateState>('app-update-changed', ({ payload }) => handler(payload));
export const checkAppUpdate = () => invoke<UpdateState>('check_update');
export const downloadAppUpdate = () => invoke<UpdateState>('download_update');
export const installAppUpdate = () => invoke<UpdateState>('install_update');

export type Agent = 'claude' | 'codex' | 'pi';

export interface AgentInventory {
  agent: Agent;
  mcpServers: { name: string; transport: string; command: string | null; scope: 'global' | 'project'; source: string; importedFrom?: string; provider?: string }[];
  skills: { name: string; description: string; path: string; scope: 'global' | 'project'; managed: boolean; repository: string | null }[];
  errors: { section: 'mcp' | 'skills'; path: string; reason: string }[];
  notes: { section: 'mcp' | 'skills'; kind: 'piMcpDisabled' | 'mcpImports'; detail: string }[];
}
export const agentResources = (cwd: string | null) => invoke<AgentInventory[]>('agent_resources', { cwd });

export const openTaskPath = (agent: Agent, id: string, path: string, action: 'open' | 'reveal') => invoke<void>('open_task_path', { agent, id, path, action });
export const resolveTaskPath = (agent: Agent, id: string, path: string) => invoke<string>('resolve_task_path', { agent, id, path });

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
  imageError?: string;
}

export interface TaskContext {
  usedTokens: number;
  model?: string | null;
}

export interface TaskModel {
  model: string;
  effort: string | null;
}

export interface TaskContent {
  messages: Message[];
  context: TaskContext | null;
  /** The task's native model and thinking level, independent of new-task defaults. */
  modelSelection?: TaskModel | null;
  /** The mode the CLI last ran the task in, as Claude records it. */
  permissionMode?: string;
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
  /** Replaces the task's last prompt, given by its message id. Claude only. */
  editLast?: string;
}

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface Question {
  /** Original native text; also the key used when submitting an answer. */
  question: string;
  /** Main question and background, separated for presentation. */
  displayQuestion?: string;
  context?: string;
  header?: string;
  options?: QuestionOption[];
  multiSelect?: boolean;
  /** Normalized native capability for the localized free-text entry. */
  allowCustom?: boolean;
}

export type Decision =
  | { kind: 'allow' }
  | { kind: 'allowForTask' }
  | { kind: 'deny' }
  | { kind: 'answer'; answers: Record<string, string>; custom?: boolean };

export interface GenerationSpeed {
  /** Latest complete request, paired with real CLI usage. */
  rate: number | null;
  average: number | null;
  peak: number | null;
  generationMs: number;
  measuredTokens: number;
  streaming: boolean;
}

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
  | { type: 'generationSpeed'; speed: GenerationSpeed }
  | { type: 'contextUsage'; usedTokens: number; model: string | null }
  | { type: 'contextWindow'; model: string; tokens: number }
  | { type: 'rateLimits'; windows: UsageWindows }
  | { type: 'steerRefused'; prompt: string }
  /** Claude's background tasks; `idle` means the agent has answered and only waits for them. */
  | { type: 'background'; tasks: number; idle: boolean }
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
export const generateTaskTitle = (agent: Agent, id: string, options: { model: string | null; effort: string | null }) =>
  invoke<string>('generate_task_title', { agent, id, ...options });
export const renameNativeTask = (agent: Agent, id: string, title: string) =>
  invoke<void>('rename_native_task', { agent, id, title });
export const readPiInfo = () => invoke<CliInfo>('pi_info');
export const readCodexInfo = () => invoke<CliInfo>('codex_info');
export const cancelTurn = (taskId: string) => invoke<void>('cancel_turn', { taskId });
export const answerRequest = (taskId: string, requestId: string, decision: Decision) =>
  invoke<void>('answer_request', { taskId, requestId, decision });
export const readCliInfo = () => invoke<CliInfo>('cli_info');
export const openExternal = (url: string) => invoke<void>('open_external', { url });
export const openLogFolder = () => invoke<void>('open_log_folder');
export const clearLogs = () => invoke<void>('clear_logs');
export const logPageError = (message: string) => invoke<void>('log_page_error', { message });
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
  queuedCount: number;
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
  invoke<void>('update_tray', { update: { summary } });
export const traySummary = () => invoke<TraySummary | null>('tray_summary');
export const resizeTrayPanel = (height: number) => invoke<void>('resize_tray_panel', { height });
export const trayPanelAction = (action: 'open' | 'settings' | 'quit' | 'task' | 'refresh', taskId?: string) =>
  invoke<void>('tray_panel_action', { action, taskId: taskId ?? null });
export const onTrayRefresh = (handler: () => void) => listen('tray-refresh', handler);
export const onTrayPanelOpened = (handler: () => void) => listen('tray-panel-opened', () => handler());
export const completeTrayRefresh = (error: string | null) => emitTo('tray-panel', 'tray-refreshed', error);
export async function refreshTray(): Promise<void> {
  let finish!: (error: string | null) => void;
  const result = new Promise<string | null>((resolve) => { finish = resolve; });
  const stop = await listen<string | null>('tray-refreshed', (event) => finish(event.payload));
  try {
    await trayPanelAction('refresh');
    const error = await result;
    if (error !== null) throw error;
  } finally {
    stop();
  }
}
export const onTraySummary = (handler: (summary: TraySummary) => void) =>
  listen<TraySummary>('tray-summary', (event) => handler(event.payload));
export const onTrayOpenSettings = (handler: () => void) => listen('tray-open-settings', () => handler());
export const notifyUser = (title: string, body: string) => invoke<void>('notify_user', { title, body });
export interface NotificationStatus {
  authorization: 'notDetermined' | 'denied' | 'authorized' | 'unsupported';
  badgeEnabled: boolean;
}
export const notificationStatus = () => invoke<NotificationStatus>('notification_status');
export const requestNotificationPermission = () => invoke<NotificationStatus>('request_notification_permission');
export const openNotificationSettings = () => invoke<void>('open_notification_settings');
export const updateAppBadge = (count: number) => invoke<void>('update_app_badge', { count });
export type RemoteLinkStatus = 'off' | 'connecting' | 'online' | 'failed';
export interface RemoteClient {
  clientId: string;
  name: string;
  pairedAtMs: number;
  isOnline: boolean;
}
export interface RemoteState {
  enabled: boolean;
  relayUrl: string;
  hasHostToken: boolean;
  relayVersion: string | null;
  status: RemoteLinkStatus;
  error: string | null;
  pairing: { text: string; qr: string; expiresAtMs: number } | null;
  clients: RemoteClient[];
}
export interface RemoteTurn {
  runId: string;
  agent: Agent;
  isNew: boolean;
  cwd: string | null;
  prompt: string;
  event: TurnEvent;
}
export const remoteState = () => invoke<RemoteState>('remote_state');
export const remoteConfigure = (enabled: boolean, relayUrl: string, hostToken: string | null) =>
  invoke<void>('remote_configure', { enabled, relayUrl, hostToken });
export const remoteBeginPairing = () => invoke<void>('remote_begin_pairing');
export const remoteCancelPairing = () => invoke<void>('remote_cancel_pairing');
export const remoteRevoke = (clientId: string) => invoke<void>('remote_revoke', { clientId });
export const onRemoteChanged = (handler: () => void) => listen('remote-changed', () => handler());
export const onRemoteTurn = (handler: (turn: RemoteTurn) => void) =>
  listen<RemoteTurn>('remote-turn', (event) => handler(event.payload));
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

export interface QueuedMessage {
  id: string;
  prompt: string;
  attachments: Attachment[];
  options: TurnOptions;
}
export interface TaskQueue {
  taskId: string;
  agent: Agent;
  entries: QueuedMessage[];
  paused: boolean;
  /** Paused because Tandem started again with these waiting, not because the task stopped. */
  pausedAfterRestart: boolean;
  error: string | null;
  revision: number;
}
export interface QueuedTurn {
  taskId: string;
  agent: Agent;
  entryId: string;
  entry: QueuedMessage | null;
  event: TurnEvent;
}
export const listQueues = () => invoke<TaskQueue[]>('list_queues');
/** The backend's answer when the running turn can no longer take a message. */
export const NO_ACTIVE_TURN = 'No active turn to add a message to';
export const steerTurn = (agent: Agent, taskId: string, prompt: string, attachments: Attachment[]) =>
  invoke<void>('steer_turn', { agent, taskId, prompt, attachmentIds: attachments.map(({ id }) => id) });
export const enqueueTurn = (agent: Agent, taskId: string, prompt: string, attachments: Attachment[], options: TurnOptions) =>
  invoke<TaskQueue>('enqueue_turn', { agent, taskId, prompt, attachmentIds: attachments.map(({ id }) => id), options });
export const editQueuedTurn = (taskId: string, entryId: string, prompt: string, keepAttachmentIds: string[], attachmentIds: string[]) =>
  invoke<TaskQueue>('edit_queued_turn', { taskId, entryId, prompt, keepAttachmentIds, attachmentIds });
export const removeQueuedTurn = (taskId: string, entryId: string) =>
  invoke<TaskQueue>('remove_queued_turn', { taskId, entryId });
export const reorderQueuedTurn = (taskId: string, entryId: string, targetIndex: number) =>
  invoke<TaskQueue>('reorder_queued_turn', { taskId, entryId, targetIndex });
export interface SteeredQueuedTurn {
  queue: TaskQueue;
  /** Accepted message with image previews independent of the removed queue files. */
  entry: QueuedMessage;
}
export const steerQueuedTurn = (taskId: string, entryId: string) => invoke<SteeredQueuedTurn>('steer_queued_turn', { taskId, entryId });
export const resumeQueue = (taskId: string) => invoke<TaskQueue>('resume_queue', { taskId });
export const setQueueLock = (taskId: string, owner: string, entryId: string | null, locked: boolean) =>
  invoke<void>('set_queue_lock', { taskId, owner, entryId, locked });
export const onQueueChanged = (handler: (queue: TaskQueue) => void) =>
  listen<TaskQueue>('queue-changed', ({ payload }) => handler(payload));
export const onQueuedTurn = (handler: (turn: QueuedTurn) => void) =>
  listen<QueuedTurn>('queued-turn', ({ payload }) => handler(payload));
export const onQueueError = (handler: (failure: { taskId: string | null; error: string }) => void) =>
  listen<{ taskId: string | null; error: string }>('queue-error', ({ payload }) => handler(payload));

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
    request: {
      agent,
      taskId: 'taskId' in target ? target.taskId : null,
      cwd: 'cwd' in target ? target.cwd : null,
      attachmentIds: attachments.map((attachment) => attachment.id),
      prompt,
      options,
    },
    onEvent: channel,
  });
}
