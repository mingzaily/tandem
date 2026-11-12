import type { Message, TaskSummary } from './api';

export type TaskPreviews = Record<string, TaskSummary>;
/** Latest observed task activity, kept only while the app is open. */
export type TaskActivity = Record<string, number>;

export function recordTaskActivity(current: TaskActivity, id: string, at: number): TaskActivity {
  return at > (current[id] ?? 0) ? { ...current, [id]: at } : current;
}

/** Concurrent native scans may finish in reverse order; metadata still comes from the new response. */
export function retainTaskTimes(current: readonly TaskSummary[], incoming: TaskSummary[]): TaskSummary[] {
  const times = new Map(current.map((task) => [task.id, task.updatedAtMs]));
  return incoming.map((task) => {
    const updatedAtMs = Math.max(task.updatedAtMs, times.get(task.id) ?? 0);
    return updatedAtMs === task.updatedAtMs ? task : { ...task, updatedAtMs };
  });
}

/** Saved message times advance external activity when history is followed. */
export function recordedTaskActivity(messages: readonly Pick<Message, 'timestamp'>[]): number {
  return messages.reduce((latest, message) => {
    const at = message.timestamp ? Date.parse(message.timestamp) : 0;
    return Number.isFinite(at) ? Math.max(latest, at) : latest;
  }, 0);
}

/** Native metadata owns the title and path; observed activity keeps list time current. */
export function taskListWithPreviews(native: TaskSummary[], previews: TaskPreviews, activity: TaskActivity = {}): TaskSummary[] {
  const byId = new Map(Object.values(previews).map((task) => [task.id, task]));
  for (const task of native) byId.set(task.id, task);
  return [...byId.values()].map((task) => (activity[task.id] ?? 0) > task.updatedAtMs
    ? { ...task, updatedAtMs: activity[task.id] } : task).sort((a, b) => b.updatedAtMs - a.updatedAtMs);
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
