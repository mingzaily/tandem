/**
 * Pins, archived tasks and renames. These are Tandem's own view of a task and are kept in browser
 * storage: writing them into the CLI's task files could collide with a CLI that is running.
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

export function renameTask(meta: TaskMeta, id: string, title: string): TaskMeta {
  const { [id]: _removed, ...titles } = meta.titles;
  const trimmed = title.trim();
  return { ...meta, titles: trimmed ? { ...titles, [id]: trimmed } : titles };
}

export const taskTitle = (meta: TaskMeta, task: { id: string; title: string }) => meta.titles[task.id] ?? task.title;
