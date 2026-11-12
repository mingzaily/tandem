import type { Message, TurnEvent } from './api';

interface Timed {
  id: string;
  /** Native record time, or the local send time for a live input. */
  at?: number;
}

export interface AttachedFile {
  name: string;
  path?: string;
}
export type TextItem = Timed & { type: 'assistant' | 'thinking' | 'notice' | 'error'; text: string };
/** `steered`: sent into a running turn, so it belongs to that turn rather than starting one. */
export type UserItem = Timed & { type: 'user'; text: string; images?: string[]; imageErrors?: string[]; files?: AttachedFile[]; steered?: boolean };
export type ToolItem = Timed & {
  type: 'tool';
  name: string;
  input: string;
  result: string | null;
  isError: boolean;
  truncated: boolean;
};
/** The CLI summarised the conversation here. */
export type CompactionItem = Timed & { type: 'compaction' };
export type Item = UserItem | TextItem | ToolItem | CompactionItem;

/** A finished stretch of work, folded under one header as in the task view it replicates. */
export type WorkGroup = { type: 'group'; id: string; items: Row[]; durationMs: number | null; isRunning: boolean; isSummary: boolean; preview?: boolean; hasFinalReply?: boolean };
export type Row = Item | WorkGroup;

const ATTACHED_FILE_PREFIX = 'Attached file, readable with your tools even outside the workspace: ';

/** Files travel as lines after the prompt, the only form a task file can keep them in. */
export function splitAttachedFiles(text: string): { text: string; files: AttachedFile[] } {
  const lines = text.split('\n');
  const files: AttachedFile[] = [];
  while (lines.at(-1)?.startsWith(ATTACHED_FILE_PREFIX)) {
    const path = (lines.pop() as string).slice(ATTACHED_FILE_PREFIX.length);
    files.unshift({ name: path.split('/').pop() || path, path });
  }
  return { text: files.length > 0 ? lines.join('\n').trimEnd() : text, files };
}

/** Claude Code records an interruption as user text, but the user did not write it. */
const INTERRUPTION_PREFIX = '[Request interrupted by user';

function timeOf(timestamp?: string): number | undefined {
  const at = timestamp ? Date.parse(timestamp) : Number.NaN;
  return Number.isNaN(at) ? undefined : at;
}

/** Merges each tool result into the row of the tool use it belongs to. */
export function buildItems(messages: Message[]): Item[] {
  const items: Item[] = [];
  const tools = new Map<string, ToolItem>();
  // A message's images come before its text. With no text, they stand as a message of their own.
  let images: string[] = [];
  let imageErrors: string[] = [];
  let imagesId = '';
  let imagesAt: number | undefined;
  const flushImages = () => {
    if (images.length + imageErrors.length > 0) items.push({ type: 'user', id: imagesId, at: imagesAt, text: '', images, imageErrors });
    images = [];
    imageErrors = [];
    imagesAt = undefined;
  };
  for (const message of messages) {
    const at = timeOf(message.timestamp);
    if (message.kind === 'assistant' && message.isError) {
      flushImages();
      items.push({ type: 'error', id: message.id, at, text: message.text });
      continue;
    }
    if (message.kind === 'compaction') {
      flushImages();
      items.push({ type: 'compaction', id: message.id, at });
      continue;
    }
    if (message.kind === 'user' && (message.image || message.imageError)) {
      if (images.length + imageErrors.length === 0) { imagesId = message.id; imagesAt = at; }
      if (message.image) images.push(message.image);
      if (message.imageError) imageErrors.push(message.imageError);
      continue;
    }
    if (message.kind === 'user' && !message.text.startsWith(INTERRUPTION_PREFIX)) {
      const { text, files } = splitAttachedFiles(message.text);
      items.push({
        type: 'user',
        id: message.id,
        at: at ?? imagesAt,
        text,
        ...(files.length > 0 ? { files } : {}),
        ...(images.length > 0 ? { images } : {}),
        ...(imageErrors.length > 0 ? { imageErrors } : {}),
      });
      images = [];
      imageErrors = [];
      imagesAt = undefined;
      continue;
    }
    flushImages();
    if (message.kind === 'tool_use') {
      const tool: ToolItem = {
        type: 'tool',
        id: message.id,
        at,
        name: message.toolName ?? '',
        input: message.text,
        result: null,
        isError: false,
        truncated: message.truncated,
      };
      items.push(tool);
      if (message.toolUseId) tools.set(message.toolUseId, tool);
    } else if (message.kind === 'tool_result') {
      const tool = message.toolUseId ? tools.get(message.toolUseId) : undefined;
      if (!tool) continue;
      tool.result = message.text;
      tool.isError = message.isError;
      tool.truncated ||= message.truncated;
      if (at !== undefined) tool.at = at;
    } else if (message.kind === 'user' && message.text.startsWith(INTERRUPTION_PREFIX)) {
      items.push({ type: 'notice', id: message.id, at, text: message.text });
    } else {
      items.push({ type: message.kind as TextItem['type'], id: message.id, at, text: message.text });
    }
  }
  flushImages();
  return items;
}

function appendText(items: Item[], type: 'assistant' | 'thinking', text: string): Item[] {
  const last = items[items.length - 1];
  if (last?.type === type) {
    return [...items.slice(0, -1), { ...last, text: last.text + text }];
  }
  return [...items, { type, id: `live-${items.length}`, text }];
}

/** Items of the running turn. They last until the finished turn is read back from the task file. */
export function applyTurnEvent(items: Item[], event: TurnEvent): Item[] {
  switch (event.type) {
    case 'textDelta':
      return appendText(items, 'assistant', event.text);
    case 'thinkingDelta':
      return appendText(items, 'thinking', event.text);
    case 'toolUse':
      return [
        ...items,
        {
          type: 'tool',
          id: event.id,
          name: event.name,
          input: event.input,
          result: null,
          isError: false,
          truncated: false,
        },
      ];
    case 'finished':
      return event.isError && !event.cancelled
        ? [...items, { type: 'error', id: `error-${items[0]?.id ?? items.length}`, text: event.message ?? '' }]
        : items;
    case 'toolResult':
      return items.map((item) =>
        item.type === 'tool' && item.id === event.toolUseId
          ? { ...item, result: event.text, isError: event.isError }
          : item,
      );
    default:
      return items;
  }
}

export type TurnStatus =
  | { key: 'statusAwaitingYou' | 'statusReplying' | 'statusThinking' }
  | { key: 'statusCallingTool'; toolName: string }
  | { key: 'statusBackground'; tasks: number };

/** What a running turn is doing now, for the line above the input box. */
export function turnStatus(items: Item[], isWaitingForUser: boolean): TurnStatus {
  if (isWaitingForUser) return { key: 'statusAwaitingYou' };
  let tail = items.length - 1;
  while (tail >= 0) {
    const item = items[tail];
    if (item.type !== 'user' || !item.steered) break;
    tail -= 1;
  }
  const last = items[tail];
  if (last?.type === 'assistant') return { key: 'statusReplying' };
  if (last?.type === 'tool') {
    // Parallel calls can finish out of order. Show the latest call still awaiting a result.
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index];
      if (item.type === 'user' && !item.steered) break;
      if (item.type === 'tool' && item.result === null) {
        return { key: 'statusCallingTool', toolName: item.name };
      }
    }
  }
  return { key: 'statusThinking' };
}

function workGroup(items: Row[], startAt: number | undefined, endAt: number | undefined, isRunning = false, outer = false): WorkGroup {
  const durationMs = startAt !== undefined && endAt !== undefined && endAt >= startAt ? endAt - startAt : null;
  return { type: 'group', id: `${outer ? 'summary' : 'group'}-${items[0].id}`, items, durationMs, isRunning, isSummary: outer };
}

function lastTime(items: Item[]): number | undefined {
  return [...items].reverse().find((item) => item.at !== undefined)?.at;
}

/** Actions on either side of assistant progress keep independent disclosure state. */
function actionGroups(items: Item[], startAt: number | undefined, isRunning: boolean): Row[] {
  const rows: Row[] = [];
  let actions: Item[] = [];
  const flush = (running: boolean, endAt?: number, preview = running) => {
    if (actions.length) rows.push({ ...workGroup(actions, startAt, endAt ?? lastTime(actions), running), ...(preview && !running ? { preview: true } : {}) });
    actions = [];
  };
  let lastReply = items.length - 1;
  while (lastReply >= 0 && items[lastReply].type !== 'assistant') lastReply -= 1;
  let lastActivity = items.length - 1;
  while (lastActivity >= 0 && items[lastActivity].type !== 'tool' && items[lastActivity].type !== 'thinking') lastActivity -= 1;
  for (const [index, item] of items.entries()) {
    if (item.type === 'tool' || item.type === 'thinking') actions.push(item);
    else {
      // A steer keeps prior work visible while only the current segment owns the spinner.
      const keepPreview = isRunning && item.type === 'user' && Boolean(item.steered) && index > lastReply;
      flush(keepPreview && index > lastActivity, item.at, keepPreview);
      rows.push(item);
      startAt = item.at;
    }
  }
  flush(isRunning);
  return rows;
}

function pushTurn(rows: Row[], turn: Item[], startAt: number | undefined, isRunning: boolean, hasFinalReply: boolean) {
  if (isRunning) { rows.push(...actionGroups(turn, startAt, true)); return; }
  // A completed turn folds only work; every steered user bubble stays in the timeline.
  let segment: Item[] = [];
  for (const item of turn) {
    if (item.type === 'user') {
      pushCompletedTurn(rows, segment, startAt, hasFinalReply);
      rows.push(item);
      startAt = item.at;
      segment = [];
    } else segment.push(item);
  }
  pushCompletedTurn(rows, segment, startAt, hasFinalReply);
}

function pushCompletedTurn(rows: Row[], turn: Item[], startAt: number | undefined, hasFinalReply: boolean) {
  const answerIndex = turn.at(-1)?.type === 'assistant' ? turn.length - 1 : -1;
  const work = answerIndex < 0 ? turn : turn.slice(0, answerIndex);
  if (work.length) {
    const hasProgress = work.some((item) => item.type === 'assistant');
    const children = hasProgress ? actionGroups(work, startAt, false) : work;
    rows.push({ ...workGroup(children, startAt, turn[answerIndex]?.at ?? lastTime(work), false, true), hasFinalReply });
  }
  if (answerIndex >= 0) rows.push(...turn.slice(answerIndex));
}

/** Display separators and steering inputs do not turn earlier work into an unanswered turn. */
function turnReplyFlags(items: Item[]): boolean[] {
  const flags: boolean[] = [];
  let final: boolean | undefined;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item.type === 'user' && !item.steered) { final = undefined; continue; }
    if (item.type === 'compaction' || item.type === 'thinking' && !item.text.trim()) continue;
    final ??= item.type === 'assistant' && Boolean(item.text.trim());
    flags[index] = final;
  }
  return flags;
}

/** Running actions preview their latest five; answered history folds toward the final reply. */
export function buildRows(items: Item[], isRunning: boolean): Row[] {
  const rows: Row[] = [];
  const replies = turnReplyFlags(items);
  let hasFinalReply = false;
  let turn: Item[] = [];
  let startAt: number | undefined;
  for (const [index, item] of items.entries()) {
    // Newer models often stream thinking with no visible text, only a signature: nothing to show.
    if (item.type === 'thinking' && !item.text.trim()) continue;
    if ((item.type === 'user' && !item.steered) || item.type === 'compaction' || item.type === 'notice' || item.type === 'error') {
      if (turn.length) pushTurn(rows, turn, startAt, false, hasFinalReply);
      turn = [];
      startAt = item.at;
      rows.push(item);
    } else {
      if (!turn.length) hasFinalReply = replies[index] ?? false;
      turn.push(item);
    }
  }
  if (turn.length) pushTurn(rows, turn, startAt, isRunning, hasFinalReply);
  return rows;
}

export function flattenRows(rows: Row[]): Item[] {
  return rows.flatMap((row) => row.type === 'group' ? flattenRows(row.items) : [row]);
}

/** The final visible reply of each completed work segment owns its copy action. */
export function completedReplyIds(items: Item[], isRunning: boolean): Set<string> {
  const replies = new Set<string>();
  let tail: Item | undefined;
  const finish = () => {
    if (tail?.type === 'assistant' && tail.text.trim()) replies.add(tail.id);
    tail = undefined;
  };
  for (const item of items) {
    if (item.type === 'thinking' && !item.text.trim()) continue;
    if ((item.type === 'user' && !item.steered) || item.type === 'notice' || item.type === 'compaction' || item.type === 'error') finish();
    else tail = item;
  }
  if (!isRunning) finish();
  return replies;
}


export interface TurnFailure {
  prompt: string;
  sentAt?: number;
  endedAt?: number;
  occurrence?: number;
  error: TextItem & { type: 'error' };
}

/** Native errors take precedence; transport failures stay anchored while this window is open. */
export function withTurnFailures(items: Item[], failures: TurnFailure[]): Item[] {
  let result = items;
  for (const failure of failures) {
    if (result.some((item) => item.id === failure.error.id)) continue;
    const candidates = result.flatMap((item, index) => item.type === 'user' && item.text === failure.prompt ? [{ item, index }] : []);
    const timed = candidates.find(({ item }) => item.at !== undefined && failure.sentAt !== undefined && item.at >= failure.sentAt
      && (failure.endedAt === undefined || item.at <= failure.endedAt));
    const start = timed?.index ?? (failure.occurrence !== undefined ? candidates[failure.occurrence]?.index : undefined) ?? -1;
    if (start < 0) continue;
    const next = result.findIndex((item, index) => index > start && item.type === 'user' && !item.steered);
    const end = next < 0 ? result.length : next;
    if (result.slice(start + 1, end).some((item) => item.type === 'error')) continue;
    result = [...result.slice(0, end), failure.error, ...result.slice(end)];
  }
  return result;
}

export const MAX_LIVE_ACTIVITIES = 5;
export const workGroupDefaultOpen = (group: WorkGroup): boolean => group.hasFinalReply === false || (group.preview ?? group.isRunning);

/** Unanswered history shows its progress; a manual choice always takes precedence. */
export function visibleWorkItems(group: WorkGroup, expanded?: boolean): Row[] {
  if (expanded === true || expanded === undefined && group.hasFinalReply === false) return group.items;
  return expanded === undefined && (group.preview ?? group.isRunning) ? group.items.slice(-MAX_LIVE_ACTIVITIES) : [];
}

/** Saved projects keep their order. One the order has not seen yet comes first, so it gets noticed. */
export function orderProjects<T>(groups: [string, T][], order: string[]): [string, T][] {
  const rank = new Map(order.map((cwd, index) => [cwd, index]));
  const known = groups.filter(([cwd]) => rank.has(cwd));
  known.sort(([a], [b]) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
  return [...groups.filter(([cwd]) => !rank.has(cwd)), ...known];
}

/** The order after moving one project so it lands before the row now at `to`. */
export function moveProject(cwds: string[], cwd: string, to: number): string[] {
  const from = cwds.indexOf(cwd);
  if (from < 0) return cwds;
  const next = cwds.filter((item) => item !== cwd);
  next.splice(from < to ? to - 1 : to, 0, cwd);
  return next;
}

/** Stands in for a project on the new task page: the folder is created when the task starts. */
export const CONVERSATION_CWD = 'tandem:conversation';

const WORKTREE_FOLDER = '/.claude/worktrees/';

/** A task in a worktree belongs to the project the worktree was made from. */
export const projectRoot = (cwd: string) => cwd.split(WORKTREE_FOLDER)[0];

export function isUnder(cwd: string, root: string): boolean {
  const base = root.replace(/\/+$/, '');
  return cwd === base || cwd.startsWith(`${base}/`);
}

/** The added project a task belongs to, the deepest one when projects are nested. */
export function groupRoot(cwd: string, roots: string[]): string {
  const matches = roots.filter((root) => isUnder(cwd, root));
  return matches.sort((first, second) => second.length - first.length)[0] ?? projectRoot(cwd);
}
export const worktreeName = (cwd: string): string | null => cwd.split(WORKTREE_FOLDER)[1]?.split('/')[0] ?? null;

export function projectName(cwd: string): string {
  return cwd.split('/').filter(Boolean).pop() ?? cwd;
}

/** The last prompt, when it is plain text and not the task's first. Attachments are not re-sent. */
export function lastEditablePrompt(items: Item[]): string | null {
  const prompts = items.filter((item): item is UserItem => item.type === 'user');
  const last = prompts.at(-1);
  if (!last || prompts.length < 2 || !last.text.trim() || last.id.startsWith('live-')) return null;
  return last.images?.length || last.imageErrors?.length || last.files?.length ? null : last.id;
}

/**
 * The history read from disk can already hold the start of the turn shown live: the file is read
 * again while the turn runs, after the CLI has written the prompt. That part is dropped from the
 * history, including accepted steering inputs in their delivery order, so the turn shows once.
 */
export function historyBeforeLiveTurn(history: Item[], live: Item[] | undefined): Item[] {
  if (!live || live[0]?.type !== 'user') return history;
  const first = live[0];
  const inputs = live.filter((item): item is UserItem => item.type === 'user');
  for (let at = 0; at < history.length; at += 1) {
    const candidate = history[at];
    if (candidate.type !== 'user' || candidate.text !== first.text) continue;
    // A repeated prompt in an earlier completed turn keeps its own history.
    if (first.at !== undefined && candidate.at !== undefined && candidate.at < first.at) continue;
    const saved = history.slice(at).filter((item): item is UserItem => item.type === 'user');
    if (saved.some((input, index) => !inputs[index] || input.text !== inputs[index].text)) continue;
    const before = history[at - 1];
    const withImages = before?.type === 'user' && !before.text && (before.images?.length ?? 0) > 0 && before.at === candidate.at;
    return history.slice(0, withImages ? at - 1 : at);
  }
  return history;
}
