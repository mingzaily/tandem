import type { Message, TurnEvent } from './api';

interface Timed {
  id: string;
  /** Milliseconds since the epoch. Absent while a turn is live. */
  at?: number;
}

export interface AttachedFile {
  name: string;
  path?: string;
}
export type TextItem = Timed & { type: 'assistant' | 'thinking' | 'notice'; text: string };
export type UserItem = Timed & { type: 'user'; text: string; images?: string[]; imageErrors?: string[]; files?: AttachedFile[] };
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
export type WorkGroup = { type: 'group'; id: string; items: Row[]; durationMs: number | null; isRunning: boolean; isSummary: boolean };
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
  | { key: 'statusCallingTool'; toolName: string };

/** What a running turn is doing now, for the line above the input box. */
export function turnStatus(items: Item[], isWaitingForUser: boolean): TurnStatus {
  if (isWaitingForUser) return { key: 'statusAwaitingYou' };
  const last = items[items.length - 1];
  if (last?.type === 'assistant') return { key: 'statusReplying' };
  if (last?.type === 'tool') {
    // Parallel calls can finish out of order. Show the latest call still awaiting a result.
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index];
      if (item.type === 'user') break;
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
  const flush = (endAt?: number) => {
    if (actions.length) rows.push(workGroup(actions, startAt, endAt ?? lastTime(actions), isRunning));
    actions = [];
  };
  for (const item of items) {
    if (item.type === 'tool' || item.type === 'thinking') actions.push(item);
    else {
      flush(item.at);
      rows.push(item);
      startAt = item.at;
    }
  }
  flush();
  return rows;
}

function pushTurn(rows: Row[], turn: Item[], startAt: number | undefined, isRunning: boolean) {
  if (isRunning) { rows.push(...actionGroups(turn, startAt, true)); return; }
  const answerIndex = turn.at(-1)?.type === 'assistant' ? turn.length - 1 : -1;
  const work = answerIndex < 0 ? turn : turn.slice(0, answerIndex);
  if (work.length) {
    const hasProgress = work.some((item) => item.type === 'assistant');
    const children = hasProgress ? actionGroups(work, startAt, false) : work;
    rows.push(workGroup(children, startAt, turn[answerIndex]?.at ?? lastTime(work), false, true));
  }
  if (answerIndex >= 0) rows.push(...turn.slice(answerIndex));
}

/** Running actions preview their latest five; completed progress folds toward the final answer. */
export function buildRows(items: Item[], isRunning: boolean): Row[] {
  const rows: Row[] = [];
  let turn: Item[] = [];
  let startAt: number | undefined;
  for (const item of items) {
    if (item.type === 'user' || item.type === 'compaction' || item.type === 'notice') {
      if (turn.length) pushTurn(rows, turn, startAt, false);
      turn = [];
      startAt = item.at;
      rows.push(item);
    } else turn.push(item);
  }
  if (turn.length) pushTurn(rows, turn, startAt, isRunning);
  return rows;
}

export function flattenRows(rows: Row[]): Item[] {
  return rows.flatMap((row) => row.type === 'group' ? flattenRows(row.items) : [row]);
}

export const MAX_LIVE_ACTIVITIES = 5;
export function visibleWorkItems(group: WorkGroup, expanded: boolean): Row[] {
  if (expanded) return group.items;
  return group.isRunning ? group.items.slice(-MAX_LIVE_ACTIVITIES) : [];
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
