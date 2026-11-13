import type { TaskSummary } from './api';

/** Pins, local archive marks and aliases live in state.json. Codex also reports native archive state. */
export interface TaskMeta {
  pins: string[];
  archived: string[];
  titles: Record<string, string>;
}

export const EMPTY_TASK_META: TaskMeta = { pins: [], archived: [], titles: {} };

export const isTaskArchived = (meta: TaskMeta, task: Pick<TaskSummary, 'id' | 'archived'>): boolean =>
  task.archived === true || meta.archived.includes(task.id);

export const archivedTaskIds = (meta: TaskMeta, tasks: readonly TaskSummary[]): string[] =>
  [...new Set([...meta.archived, ...tasks.filter((task) => task.archived === true).map(({ id }) => id)])];

const toggled = (list: string[], id: string) =>
  list.includes(id) ? list.filter((item) => item !== id) : [id, ...list];

export const togglePin = (meta: TaskMeta, id: string): TaskMeta => ({ ...meta, pins: toggled(meta.pins, id) });

export function renameTask(meta: TaskMeta, id: string, title: string): TaskMeta {
  const { [id]: _removed, ...titles } = meta.titles;
  const trimmed = title.trim();
  return { ...meta, titles: trimmed ? { ...titles, [id]: trimmed } : titles };
}

export const taskTitle = (meta: TaskMeta, task: { id: string; title: string }) => meta.titles[task.id] ?? task.title;

/** Adopt the saved native title while preserving a manual rename made during generation. */
export function acceptNativeTitle(meta: TaskMeta, id: string, previousTitle: string | undefined): TaskMeta {
  return meta.titles[id] === previousTitle ? renameTask(meta, id, '') : meta;
}
