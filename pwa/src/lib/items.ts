import type { Message, TurnEvent } from './types';

interface Timed {
  id: string;
  /** Milliseconds since the epoch. Absent while a turn is live. */
  at?: number;
}

export interface AttachedFile {
  name: string;
  path?: string;
}
export type TextItem = Timed & { type: 'assistant' | 'thinking' | 'notice' | 'error'; text: string };
export type UserItem = Timed & { type: 'user'; text: string; images?: string[]; files?: AttachedFile[] };
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
export type WorkGroup = {
  type: 'group';
  id: string;
  items: Row[];
  durationMs: number | null;
  isRunning: boolean;
  isSummary: boolean;
};
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
  let imagesId = '';
  let imagesAt: number | undefined;
  const flushImages = () => {
    if (images.length > 0) items.push({ type: 'user', id: imagesId, at: imagesAt, text: '', images });
    images = [];
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
    if (message.kind === 'user' && message.image) {
      if (images.length === 0) {
        imagesId = message.id;
        imagesAt = at;
      }
      images.push(message.image);
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
      });
      images = [];
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
  | { key: 'statusCallingTool'; toolName: string };

/** What a running turn is doing now, for the line above the input box. */
export function turnStatus(items: Item[], isWaitingForUser: boolean): TurnStatus {
  if (isWaitingForUser) return { key: 'statusAwaitingYou' };
  const last = items.at(-1);
  if (last?.type === 'assistant') return { key: 'statusReplying' };
  if (last?.type === 'tool') {
    for (let index = items.length - 1; index >= 0; index--) {
      const item = items[index];
      if (item.type === 'user') break;
      if (item.type === 'tool' && item.result === null) {
        return { key: 'statusCallingTool', toolName: item.name };
      }
    }
  }
  return { key: 'statusThinking' };
}

function workGroup(
  items: Row[],
  startAt: number | undefined,
  endAt: number | undefined,
  isRunning = false,
  isSummary = false,
): WorkGroup {
  const durationMs =
    startAt !== undefined && endAt !== undefined && endAt >= startAt ? endAt - startAt : null;
  return {
    type: 'group',
    id: `${isSummary ? 'summary' : 'group'}-${items[0].id}`,
    items,
    durationMs,
    isRunning,
    isSummary,
  };
}

function lastTime(items: Item[]): number | undefined {
  return [...items].reverse().find((item) => item.at !== undefined)?.at;
}

/** Assistant progress closes the preceding action group, even while the turn is running. */
function actionGroups(items: Item[], startAt: number | undefined, isRunning: boolean): Row[] {
  const rows: Row[] = [];
  let actions: Item[] = [];
  const flush = (running: boolean, endAt?: number) => {
    if (actions.length) rows.push(workGroup(actions, startAt, endAt ?? lastTime(actions), running));
    actions = [];
  };
  for (const item of items) {
    if (item.type === 'tool' || item.type === 'thinking') actions.push(item);
    else {
      flush(false, item.at);
      rows.push(item);
      startAt = item.at;
    }
  }
  flush(isRunning);
  return rows;
}

function pushTurn(rows: Row[], turn: Item[], startAt: number | undefined, isRunning: boolean) {
  if (isRunning) {
    rows.push(...actionGroups(turn, startAt, true));
    return;
  }
  const answerIndex = turn.at(-1)?.type === 'assistant' ? turn.length - 1 : -1;
  const work = answerIndex < 0 ? turn : turn.slice(0, answerIndex);
  if (work.length) {
    const children = work.some((item) => item.type === 'assistant')
      ? actionGroups(work, startAt, false)
      : work;
    rows.push(workGroup(children, startAt, turn[answerIndex]?.at ?? lastTime(work), false, true));
  }
  if (answerIndex >= 0) rows.push(turn[answerIndex]);
}

/** Live actions preview their latest five; completed progress folds toward the final answer. */
export function buildRows(items: Item[], isRunning: boolean): Row[] {
  const rows: Row[] = [];
  let turn: Item[] = [];
  let startAt: number | undefined;
  for (const item of items) {
    if (item.type === 'thinking' && !item.text.trim()) continue;
    if (item.type === 'user' || item.type === 'compaction' || item.type === 'notice' || item.type === 'error') {
      if (turn.length) pushTurn(rows, turn, startAt, false);
      turn = [];
      startAt = item.at;
      rows.push(item);
    } else turn.push(item);
  }
  if (turn.length) pushTurn(rows, turn, startAt, isRunning);
  return rows;
}

export const MAX_LIVE_ACTIVITIES = 5;
/** An untouched live group previews recent work; an explicit close hides all its children. */
export function visibleWorkItems(group: WorkGroup, expanded?: boolean): Row[] {
  if (expanded === true) return group.items;
  return expanded === undefined && group.isRunning ? group.items.slice(-MAX_LIVE_ACTIVITIES) : [];
}
