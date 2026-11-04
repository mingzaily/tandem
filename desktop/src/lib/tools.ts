import { t } from './i18n';
import type { Item, ToolItem } from './items';

const FILE_TOOLS = new Set(['Read', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit']);

const VERBS: Record<string, Parameters<typeof t>[0]> = {
  Edit: 'verbEdited',
  MultiEdit: 'verbEdited',
  NotebookEdit: 'verbEdited',
  Write: 'verbCreated',
  Read: 'verbRead',
  Bash: 'verbRan',
  Glob: 'verbSearched',
  Grep: 'verbSearched',
  WebFetch: 'verbFetched',
  WebSearch: 'verbFetched',
  TodoWrite: 'verbUpdated',
  LS: 'verbListed',
};

export interface ToolDisplay {
  /** Empty when the description already reads as a full sentence. */
  verb: string;
  text: string;
  fileName: string | null;
  command: string | null;
  stats: { added: number; removed: number } | null;
}

function parseInput(input: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(input);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const asString = (value: unknown) => (typeof value === 'string' ? value : '');
const lineCount = (text: string) => (text === '' ? 0 : text.split('\n').length);
const baseName = (path: string) => path.split('/').filter(Boolean).pop() ?? path;

function editStats(tool: ToolItem, input: Record<string, unknown>): ToolDisplay['stats'] {
  // Line counts from clipped text would be wrong, so they are left out.
  if (tool.truncated) return null;
  if (tool.name === 'Edit') {
    return { added: lineCount(asString(input.new_string)), removed: lineCount(asString(input.old_string)) };
  }
  if (tool.name === 'Write') return { added: lineCount(asString(input.content)), removed: 0 };
  return null;
}

export function describeTool(tool: ToolItem): ToolDisplay {
  const input = parseInput(tool.input);
  const verbKey = VERBS[tool.name];
  const verb = verbKey ? t(verbKey) : t('verbUsed');
  if (FILE_TOOLS.has(tool.name)) {
    const path = asString(input.file_path) || asString(input.notebook_path);
    return {
      verb,
      text: path,
      fileName: path ? baseName(path) : null,
      command: null,
      stats: editStats(tool, input),
    };
  }
  if (tool.name === 'Bash') {
    const command = asString(input.command);
    const description = asString(input.description);
    return description
      ? { verb: '', text: description, fileName: null, command, stats: null }
      : { verb, text: command, fileName: null, command: null, stats: null };
  }
  const detail =
    asString(input.pattern) || asString(input.query) || asString(input.url) || asString(input.path);
  return {
    verb,
    text: verbKey ? detail : detail ? `${tool.name} ${detail}` : tool.name,
    fileName: null,
    command: null,
    stats: null,
  };
}

/** "Read 3 files · Searched twice", counted the way the group header reports exploration. */
export function explorationSummary(items: Item[]): string {
  let read = 0;
  let search = 0;
  let list = 0;
  for (const item of items) {
    if (item.type !== 'tool') continue;
    if (item.name === 'Read') read += 1;
    else if (item.name === 'Grep' || item.name === 'Glob' || item.name === 'WebSearch') search += 1;
    else if (item.name === 'LS') list += 1;
  }
  const parts: string[] = [];
  if (read > 0) parts.push(t(read === 1 ? 'exploredReadOne' : 'exploredRead', { count: String(read) }));
  if (search > 0) {
    parts.push(t(search === 1 ? 'exploredSearchOne' : 'exploredSearch', { count: String(search) }));
  }
  if (list > 0) parts.push(t(list === 1 ? 'exploredListOne' : 'exploredList', { count: String(list) }));
  return parts.join(' · ');
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return t('durationHours', { hours: String(hours), minutes: String(minutes) });
  if (minutes > 0) return t('durationMinutes', { minutes: String(minutes), seconds: String(seconds) });
  return t('durationSeconds', { seconds: String(seconds) });
}

/** Compact age for the sidebar's right slot. */
export function formatAge(updatedAtMs: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - updatedAtMs) / 60000);
  if (minutes < 1) return t('ageNow');
  if (minutes < 60) return t('ageMinutes', { count: String(minutes) });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('ageHours', { count: String(hours) });
  return t('ageDays', { count: String(Math.floor(hours / 24)) });
}
