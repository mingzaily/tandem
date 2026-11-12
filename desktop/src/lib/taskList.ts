import type { TaskSummary } from './api';

export type TaskPreviews = Record<string, TaskSummary>;

/** The native list owns stored metadata; a started task is visible while that list catches up. */
export function taskListWithPreviews(native: TaskSummary[], previews: TaskPreviews): TaskSummary[] {
  const byId = new Map(Object.values(previews).map((task) => [task.id, task]));
  for (const task of native) byId.set(task.id, task);
  return [...byId.values()].sort((a, b) => b.updatedAtMs - a.updatedAtMs);
}

export function clearTaskPreviews(previews: TaskPreviews, ids: Iterable<string>): TaskPreviews {
  let next = previews;
  for (const id of ids) {
    if (!Object.hasOwn(next, id)) continue;
    if (next === previews) next = { ...previews };
    delete next[id];
  }
  return next;
}
