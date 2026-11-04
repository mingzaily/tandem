import type { Message, TurnEvent } from './api';

interface Timed {
  id: string;
  /** Milliseconds since the epoch. Absent while a turn is live. */
  at?: number;
}

export type TextItem = Timed & { type: 'user' | 'assistant' | 'thinking' | 'notice'; text: string };
export type ToolItem = Timed & {
  type: 'tool';
  name: string;
  input: string;
  result: string | null;
  isError: boolean;
  truncated: boolean;
};
export type Item = TextItem | ToolItem;

/** A finished stretch of work, folded under one header as in the task view it replicates. */
export type WorkGroup = { type: 'group'; id: string; items: Item[]; durationMs: number | null };
export type Row = Item | WorkGroup;

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
  for (const message of messages) {
    const at = timeOf(message.timestamp);
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
      items.push({ type: message.kind, id: message.id, at, text: message.text });
    }
  }
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
    case 'started':
    case 'finished':
      return items;
  }
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

export function projectName(cwd: string): string {
  return cwd.split('/').filter(Boolean).pop() ?? cwd;
}
