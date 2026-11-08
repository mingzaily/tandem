import type { Agent, TaskSummary } from './api';
import { CONVERSATION_CWD, orderProjects } from './items';

export type SidebarSort = 'time' | 'type' | 'priority';
export interface SidebarOptions { groupByCli: boolean; sort: SidebarSort }
export const CLI_ORDER: Agent[] = ['claude', 'codex', 'pi'];

/** Waiting for you, finished but unread, running, then the rest: the reference sidebar's four tiers. */
export const PRIORITY = { waiting: 0, unread: 1, running: 2, idle: 3 } as const;

export interface PriorityContext {
  waiting: ReadonlySet<string>;
  unread: ReadonlySet<string>;
  isRunning: (id: string) => boolean;
  /** The tier a task had when it was opened, kept while it is being viewed. */
  held: Map<string, number>;
  /** When an unread task was left, so it leads the idle tier instead of dropping by its age. */
  leftAt: Map<string, number>;
}

export function naturalRank(id: string, ctx: Pick<PriorityContext, 'waiting' | 'unread' | 'isRunning'>): number {
  if (ctx.waiting.has(id)) return PRIORITY.waiting;
  if (ctx.unread.has(id)) return PRIORITY.unread;
  return ctx.isRunning(id) ? PRIORITY.running : PRIORITY.idle;
}

function heldRank(natural: number, held: number | undefined): number {
  // A new turn in the viewed task releases the hold, or the old tier would lift it again when it ends.
  return natural === PRIORITY.running || held === undefined ? natural : Math.min(natural, held);
}

export function priorityRank(id: string, ctx: PriorityContext): number {
  return heldRank(naturalRank(id, ctx), ctx.held.get(id));
}

/** Call on every render with the viewed task; it updates the hold in place, as the reference does. */
export function advanceHold(state: { viewed: string | null }, viewed: string | null, ctx: PriorityContext, now: number) {
  if (state.viewed && state.viewed !== viewed) {
    if (ctx.held.get(state.viewed) === PRIORITY.unread) ctx.leftAt.set(state.viewed, now);
    ctx.held.delete(state.viewed);
  }
  if (viewed) ctx.held.set(viewed, heldRank(naturalRank(viewed, ctx), ctx.held.get(viewed)));
  state.viewed = viewed;
}

export function sortSidebarTasks(tasks: TaskSummary[], sort: SidebarSort, priority?: PriorityContext): TaskSummary[] {
  const time = (task: TaskSummary) => Math.max(task.updatedAtMs, priority?.leftAt.get(task.id) ?? 0);
  return [...tasks].sort((a, b) => {
    if (sort === 'type') return CLI_ORDER.indexOf(a.agent) - CLI_ORDER.indexOf(b.agent) || b.updatedAtMs - a.updatedAtMs;
    if (sort === 'priority' && priority) return priorityRank(a.id, priority) - priorityRank(b.id, priority) || time(b) - time(a);
    return b.updatedAtMs - a.updatedAtMs;
  });
}

export function cliTaskGroups(tasks: TaskSummary[], options: SidebarOptions, priority?: PriorityContext): { agent: Agent | null; tasks: TaskSummary[] }[] {
  const ordered = sortSidebarTasks(tasks, options.sort, priority);
  return options.groupByCli
    ? CLI_ORDER.map((agent) => ({ agent, tasks: ordered.filter((task) => task.agent === agent) })).filter((group) => group.tasks.length > 0)
    : [{ agent: null, tasks: ordered }];
}

/** Conversations stay on top, pinned projects follow, then the rest in saved order. */
export function orderSidebarProjects<T>(groups: [string, T][], order: string[], pinned: string[]): [string, T][] {
  const pins = new Set(pinned);
  const rank = (cwd: string) => (cwd === CONVERSATION_CWD ? 0 : pins.has(cwd) ? 1 : 2);
  return orderProjects(groups, order).sort(([a], [b]) => rank(a) - rank(b));
}

export const toggleProjectPin = (pins: string[], cwd: string): string[] => pins.includes(cwd) ? pins.filter((path) => path !== cwd) : [cwd, ...pins];

/** Newest first, so a long-unvisited backlog cannot grow without bound. */
export const UNREAD_LIMIT = 200;
export const markUnread = (unread: string[], id: string): string[] => unread.includes(id) ? unread : [id, ...unread].slice(0, UNREAD_LIMIT);
