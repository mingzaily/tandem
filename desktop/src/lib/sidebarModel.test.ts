import { describe, expect, it } from 'vitest';
import type { TaskSummary } from './api';
import { CONVERSATION_CWD } from './items';
import { advanceHold, cliTaskGroups, markUnread, moveSidebarProject, orderSidebarProjects, PRIORITY, priorityRank, projectMoveRange, sortSidebarTasks, toggleProjectPin, UNREAD_LIMIT, type PriorityContext } from './sidebarModel';

const task = (id: string, agent: TaskSummary['agent'], time: number): TaskSummary => ({ id, agent, updatedAtMs: time, cwd: '/a', title: id });
const tasks = [task('p', 'pi', 3), task('c-old', 'codex', 1), task('a', 'claude', 2), task('c-new', 'codex', 4)];
describe('sidebar grouping and order', () => {
  it('sorts by recent activity or CLI and then activity', () => {
    expect(sortSidebarTasks(tasks, 'time').map(({ id }) => id)).toEqual(['c-new', 'p', 'a', 'c-old']);
    expect(sortSidebarTasks(tasks, 'type').map(({ id }) => id)).toEqual(['a', 'c-new', 'c-old', 'p']);
    expect(tasks[0].id).toBe('p');
  });
  it('creates CLI subgroups within the project', () => {
    expect(cliTaskGroups(tasks, { groupByCli: true, sort: 'time' }).map(({ agent, tasks }) => [agent, tasks.map(({ id }) => id)])).toEqual([
      ['claude', ['a']], ['codex', ['c-new', 'c-old']], ['pi', ['p']],
    ]);
    expect(cliTaskGroups(tasks, { groupByCli: false, sort: 'time' })).toHaveLength(1);
  });
  it('places pinned projects right after conversations while preserving saved project order within each section', () => {
    expect(orderSidebarProjects([['a', 1], ['b', 2], ['c', 3]], ['b', 'c', 'a'], ['a', 'c']).map(([cwd]) => cwd)).toEqual(['c', 'a', 'b']);
    expect(orderSidebarProjects([['a', 1], [CONVERSATION_CWD, 0], ['b', 2]], ['a', CONVERSATION_CWD, 'b'], ['b']).map(([cwd]) => cwd)).toEqual([CONVERSATION_CWD, 'b', 'a']);
    expect(toggleProjectPin(['a'], 'b')).toEqual(['b', 'a']);
    expect(toggleProjectPin(['a', 'b'], 'a')).toEqual(['b']);
  });
});

describe('manual project moves', () => {
  const ids = [CONVERSATION_CWD, '/pin-a', '/pin-b', '/a', '/b', '/c'];
  const pinned = ['/pin-a', '/pin-b'];
  it('keeps the conversation group fixed and moves projects inside their visible pin tier', () => {
    expect(projectMoveRange(ids, pinned, CONVERSATION_CWD)).toBeNull();
    expect(projectMoveRange(ids, pinned, '/pin-a')).toEqual({ min: 1, max: 2 });
    expect(projectMoveRange(ids, pinned, '/b')).toEqual({ min: 3, max: 5 });
    expect(moveSidebarProject(ids, ids, pinned, '/pin-a', 5)).toEqual([CONVERSATION_CWD, '/pin-b', '/pin-a', '/a', '/b', '/c']);
    expect(moveSidebarProject(ids, ids, pinned, '/c', 0)).toEqual([CONVERSATION_CWD, '/pin-a', '/pin-b', '/c', '/a', '/b']);
  });
  it('preserves saved hidden projects and agrees with the displayed order after saving', () => {
    const saved = [...ids, '/hidden'];
    const next = moveSidebarProject(ids, saved, pinned, '/a', 5)!;
    expect(next).toEqual([CONVERSATION_CWD, '/pin-a', '/pin-b', '/b', '/c', '/a', '/hidden']);
    expect(orderSidebarProjects(ids.map((id) => [id, id]), next, pinned).map(([id]) => id)).toEqual(next.slice(0, -1));
    expect(saved).toEqual([...ids, '/hidden']);
  });
  it('does not save a fixed, missing or unchanged position', () => {
    expect(moveSidebarProject(ids, ids, pinned, CONVERSATION_CWD, 3)).toBeNull();
    expect(moveSidebarProject(ids, ids, pinned, '/missing', 3)).toBeNull();
    expect(moveSidebarProject(ids, ids, pinned, '/pin-b', 5)).toBeNull();
    expect(moveSidebarProject(ids, ids, pinned, '/a', 0)).toBeNull();
  });
});

describe('priority order', () => {
  const ctx = (over: Partial<PriorityContext> = {}): PriorityContext => ({
    waiting: new Set(['w']), unread: new Set(['u']), isRunning: (id) => id === 'r', held: new Map(), leftAt: new Map(), ...over,
  });
  const list = [task('idle-new', 'claude', 9), task('r', 'codex', 1), task('u', 'pi', 2), task('w', 'claude', 3), task('idle-old', 'pi', 0)];
  it('ranks waiting, unread, running, then the rest by time', () => {
    expect(sortSidebarTasks(list, 'priority', ctx()).map(({ id }) => id)).toEqual(['w', 'u', 'r', 'idle-new', 'idle-old']);
  });
  it('holds an opened unread task in place and leads the idle tier once it is left', () => {
    const context = ctx();
    const state = { viewed: null as string | null };
    advanceHold(state, 'u', context, 100);
    const read = { ...context, unread: new Set<string>() };
    expect(sortSidebarTasks(list, 'priority', read).map(({ id }) => id)[1]).toBe('u');
    advanceHold(state, 'idle-old', read, 100);
    expect(sortSidebarTasks(list, 'priority', read).map(({ id }) => id)).toEqual(['w', 'r', 'u', 'idle-new', 'idle-old']);
  });
  it('releases the hold when the viewed task starts another turn', () => {
    const context = ctx({ isRunning: (id) => id === 'r' || id === 'u' });
    context.held.set('u', PRIORITY.waiting);
    expect(priorityRank('u', { ...context, unread: new Set() })).toBe(PRIORITY.running);
  });
  it('keeps unread marks bounded and unique', () => {
    expect(markUnread(['a'], 'a')).toEqual(['a']);
    expect(markUnread(Array.from({ length: UNREAD_LIMIT }, (_, index) => String(index)), 'new')).toHaveLength(UNREAD_LIMIT);
  });
});
