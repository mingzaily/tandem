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
export type UserItem = Timed & { type: 'user'; text: string; images?: string[]; files?: AttachedFile[] };
export type ToolItem = Timed & {
  type: 'tool';
  name: string;
  input: string;
  result: string | null;
  isError: boolean;
  truncated: boolean;
};
export type Item = UserItem | TextItem | ToolItem;

/** A finished stretch of work, folded under one header as in the task view it replicates. */
export type WorkGroup = { type: 'group'; id: string; items: Item[]; durationMs: number | null };
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
  const flushImages = () => {
    if (images.length > 0) items.push({ type: 'user', id: imagesId, text: '', images });
    images = [];
  };
  for (const message of messages) {
    const at = timeOf(message.timestamp);
    if (message.kind === 'user' && message.image) {
      if (images.length === 0) imagesId = message.id;
      images.push(message.image);
      continue;
    }
    if (message.kind === 'user' && !message.text.startsWith(INTERRUPTION_PREFIX)) {
      const { text, files } = splitAttachedFiles(message.text);
      items.push({
        type: 'user',
        id: message.id,
        at,
        text,
        ...(files.length > 0 ? { files } : {}),
        ...(images.length > 0 ? { images } : {}),
      });
      images = [];
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

export type TurnStatusKey = 'statusAwaitingYou' | 'statusCallingTool' | 'statusReplying' | 'statusThinking';

/** What a running turn is doing now, for the line above the input box. */
export function turnStatus(items: Item[], isWaitingForUser: boolean): TurnStatusKey {
  if (isWaitingForUser) return 'statusAwaitingYou';
  const last = items[items.length - 1];
  if (last?.type === 'tool' && last.result === null) return 'statusCallingTool';
  if (last?.type === 'assistant') return 'statusReplying';
  return 'statusThinking';
}

function workGroup(items: Item[], startAt: number | undefined, endAt: number | undefined): WorkGroup {
  const durationMs =
    startAt !== undefined && endAt !== undefined && endAt >= startAt ? endAt - startAt : null;
  return { type: 'group', id: `group-${items[0].id}`, items, durationMs };
}

function lastTime(items: Item[]): number | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index].at !== undefined) return items[index].at;
  }
  return undefined;
}

function pushTurn(rows: Row[], turn: Item[], startAt: number | undefined) {
  let answerIndex = -1;
  for (let index = turn.length - 1; index >= 0; index -= 1) {
    if (turn[index].type === 'assistant') {
      answerIndex = index;
      break;
    }
  }
  if (answerIndex < 0) {
    // Without an answer there is nothing to fold towards, except a longer run of work.
    if (turn.length >= 2) rows.push(workGroup(turn, startAt, lastTime(turn)));
    else rows.push(...turn);
    return;
  }
  const work = turn.slice(0, answerIndex);
  const answer = turn[answerIndex];
  if (work.length > 0) rows.push(workGroup(work, startAt, answer.at ?? lastTime(work)));
  rows.push(answer);
  rows.push(...turn.slice(answerIndex + 1));
}

/**
 * Folds the work before each turn's final answer. While a turn runs, its rows stay flat so
 * progress is visible as it happens.
 */
export function buildRows(items: Item[], isRunning: boolean): Row[] {
  const rows: Row[] = [];
  let turn: Item[] = [];
  let startAt: number | undefined;
  let liveStart = items.length;
  if (isRunning) {
    for (let index = items.length - 1; index >= 0; index -= 1) {
      if (items[index].type === 'user') {
        liveStart = index;
        break;
      }
    }
  }
  items.slice(0, liveStart).forEach((item) => {
    if (item.type === 'user') {
      if (turn.length > 0) pushTurn(rows, turn, startAt);
      turn = [];
      startAt = item.at;
      rows.push(item);
    } else {
      turn.push(item);
    }
  });
  if (turn.length > 0) pushTurn(rows, turn, startAt);
  rows.push(...items.slice(liveStart));
  return rows;
}

const WORKTREE_FOLDER = '/.claude/worktrees/';

/** A task in a worktree belongs to the project the worktree was made from. */
export const projectRoot = (cwd: string) => cwd.split(WORKTREE_FOLDER)[0];
export const worktreeName = (cwd: string): string | null => cwd.split(WORKTREE_FOLDER)[1]?.split('/')[0] ?? null;

export function projectName(cwd: string): string {
  return cwd.split('/').filter(Boolean).pop() ?? cwd;
}
