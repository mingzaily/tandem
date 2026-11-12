/**
 * Pins, archived tasks and aliases live in state.json, managed by Rust.
 * Each CLI continues to own its native task files.
 */
export interface TaskMeta {
  pins: string[];
  archived: string[];
  titles: Record<string, string>;
}

export const EMPTY_TASK_META: TaskMeta = { pins: [], archived: [], titles: {} };

const toggled = (list: string[], id: string) =>
  list.includes(id) ? list.filter((item) => item !== id) : [id, ...list];

export const togglePin = (meta: TaskMeta, id: string): TaskMeta => ({ ...meta, pins: toggled(meta.pins, id) });

/** An archived task leaves the list, so it stops being pinned too. */
export const toggleArchived = (meta: TaskMeta, id: string): TaskMeta => ({
  ...meta,
  archived: toggled(meta.archived, id),
  pins: meta.pins.filter((item) => item !== id),
});

/** Sending to an archived task brings it back, as in the reference. */
export const unarchive = (meta: TaskMeta, id: string): TaskMeta =>
  meta.archived.includes(id) ? { ...meta, archived: meta.archived.filter((item) => item !== id) } : meta;

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
