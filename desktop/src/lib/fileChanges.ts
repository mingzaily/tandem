import { buildRows, flattenRows, type Item, type Row } from './items';
import { parseToolInput, WRITE_TOOLS } from './tools';

export interface ChangedFile {
  path: string;
  stats: { added: number; removed: number } | null;
}

export interface FileChanges {
  files: ChangedFile[];
  stats: ChangedFile['stats'];
}

export type FileChangesRow = FileChanges & { type: 'changes'; id: string };

function addStats(left: ChangedFile['stats'], right: ChangedFile['stats']): ChangedFile['stats'] {
  return left && right ? { added: left.added + right.added, removed: left.removed + right.removed } : null;
}

function fileIdentity(path: string, cwd: string | null): string {
  if (!path.startsWith('/') && !cwd) return path;
  const parts: string[] = [];
  for (const part of (path.startsWith('/') ? path : `${cwd}/${path}`).split('/')) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  return `/${parts.join('/')}`;
}

/** Successful file tools in the latest turn, with cumulative native patch counts when complete. */
export function summarizeFileChanges(items: Item[], cwd: string | null): FileChanges {
  let start = items.length - 1;
  while (start >= 0) {
    const item = items[start];
    if (item.type === 'user' && !item.steered) break;
    start -= 1;
  }
  const files = new Map<string, ChangedFile>();
  for (let index = start + 1; index < items.length; index += 1) {
    const item = items[index];
    if (item.type !== 'tool' || !WRITE_TOOLS.has(item.name) || item.result === null || item.isError) continue;
    const input = parseToolInput(item.input);
    const path = typeof input.file_path === 'string' ? input.file_path : typeof input.notebook_path === 'string' ? input.notebook_path : '';
    if (!path) continue;
    const identity = fileIdentity(path, cwd);
    // Text snippets and Write contents describe replacements, not a complete file diff.
    const stats = !item.truncated && Number.isInteger(input.added) && Number.isInteger(input.removed) && Number(input.added) >= 0 && Number(input.removed) >= 0
      ? { added: Number(input.added), removed: Number(input.removed) } : null;
    const previous = files.get(identity);
    files.set(identity, { path: identity, stats: previous ? addStats(previous.stats, stats) : stats });
  }
  const entries = [...files.values()];
  const stats = entries.length > 0
    ? entries.reduce<ChangedFile['stats']>((total, file) => addStats(total, file.stats), { added: 0, removed: 0 }) : null;
  return { files: entries, stats };
}

/** Change cards belong to their completed turn and stay in history when another turn starts. */
export function buildMessageRows(items: Item[], isRunning: boolean, cwd: string | null): (Row | FileChangesRow)[] {
  const rows: (Row | FileChangesRow)[] = [];
  let turn: Item[] = [];
  const appendChanges = () => {
    const summary = summarizeFileChanges(turn, cwd);
    if (summary.files.length) rows.push({ type: 'changes', id: `changes-${turn[0].id}`, ...summary });
    turn = [];
  };
  for (const row of buildRows(items, isRunning)) {
    if (row.type === 'user' && !row.steered) appendChanges();
    rows.push(row);
    turn.push(...flattenRows([row]));
  }
  if (!isRunning) appendChanges();
  return rows;
}

/** Lead with the filename so long absolute paths still identify the edited file. */
export function fileChangeLabel(path: string, cwd: string | null): { name: string; directory: string } {
  const prefix = cwd === '/' ? '/' : `${cwd}/`;
  const display = cwd && path.startsWith(prefix) ? path.slice(prefix.length) : path;
  const slash = display.lastIndexOf('/');
  return { name: display.slice(slash + 1), directory: slash < 0 ? '' : display.slice(0, slash) };
}

