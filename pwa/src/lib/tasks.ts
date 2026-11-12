import type { TaskSummary } from './types';

export const CONVERSATION_CWD = 'tandem:conversation';

const isUnder = (cwd: string, root: string) => {
  const base = root.replace(/\/+$/, '');
  return cwd === base || cwd.startsWith(base + '/');
};

export function groupTasks(
  tasks: TaskSummary[],
  projects: string[],
  conversationRoots: string[],
): [string, TaskSummary[]][] {
  const groups = new Map<string, TaskSummary[]>(projects.map((cwd) => [cwd, []]));
  const roots = [...projects].sort((a, b) => b.length - a.length);
  for (const task of tasks) {
    const root = conversationRoots.some((cwd) => isUnder(task.cwd, cwd))
      ? CONVERSATION_CWD
      : (roots.find((cwd) => isUnder(task.cwd, cwd)) ?? task.cwd);
    const group = groups.get(root);
    if (group) group.push(task);
    else groups.set(root, [task]);
  }
  return [...groups]
    .filter(([, group]) => group.length > 0)
    .map(([cwd, group]) => [cwd, group.sort((a, b) => b.updatedAtMs - a.updatedAtMs)]);
}

/** Search is local to the task metadata already available on the phone. */
export function filterTasks(tasks: TaskSummary[], query: string): TaskSummary[] {
  const needle = query.trim().toLocaleLowerCase();
  return needle
    ? tasks.filter((task) => `${task.title} ${task.cwd} ${task.agent}`.toLocaleLowerCase().includes(needle))
    : tasks;
}
