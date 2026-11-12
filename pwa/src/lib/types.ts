export type Agent = 'claude' | 'codex' | 'pi';

export interface TaskSummary {
  id: string;
  title: string;
  cwd: string;
  updatedAtMs: number;
  agent: Agent;
}

export type MessageKind =
  'user' | 'assistant' | 'thinking' | 'tool_use' | 'tool_result' | 'compaction' | 'notice';

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

export interface TaskModel {
  model: string;
  effort: string | null;
}

export interface TaskContent {
  messages: Message[];
  context: TaskContext | null;
  modelSelection?: TaskModel | null;
  permissionMode?: string | null;
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
  | { type: 'finished'; isError: boolean; cancelled: boolean; message: string | null };

export type PendingRequest = Extract<TurnEvent, { type: 'permissionRequest' | 'question' }>;

export interface Run {
  runId: string;
  taskId: string | null;
  agent: Agent;
  /** The original input anchors the live turn within the CLI's history. */
  prompt: string;
  startedAtMs: number;
  elapsedMs: number;
  events: TurnEvent[];
}
