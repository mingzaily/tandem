import { afterAll, describe, expect, it, vi } from 'vitest';
import type { Agent, TaskSummary } from './api';
import { clearTaskPreviews, recordTaskActivity, recordedTaskActivity, taskListWithPreviews, retainTaskTimes, type TaskActivity } from './taskList';
import { sortSidebarTasks } from './sidebarModel';
import { formatAge } from './tools';

vi.hoisted(() => vi.stubGlobal('navigator', { language: 'zh-CN' }));
afterAll(() => vi.unstubAllGlobals());

const task = (id: string, overrides: Partial<TaskSummary> = {}): TaskSummary => ({
  id, agent: 'pi', title: id, cwd: '/project', updatedAtMs: 10, ...overrides,
});

describe('task activity drives sidebar order and time', () => {
  it.each<Agent>(['claude', 'codex', 'pi'])('moves an existing %s task on a new send without waiting for native metadata', (agent) => {
    const native = [task('previously-newer', { updatedAtMs: 180000 }), task('resumed', { agent, title: 'Saved native title', updatedAtMs: 1000 })];
    const activity = recordTaskActivity({}, 'resumed', 240000);
    const listed = taskListWithPreviews(native, {}, activity);
    expect(listed.map(({ id }) => id)).toEqual(['resumed', 'previously-newer']);
    expect(listed[0].title).toBe('Saved native title');
    expect(formatAge(listed[0].updatedAtMs, 241000)).toBe('刚刚');
    expect(native[1].updatedAtMs).toBe(1000);
  });

  it('keeps native metadata while an old scan returns and advances the next completed turn once', () => {
    const native = [task('a', { title: 'Latest title', cwd: '/project/.claude/worktrees/new', updatedAtMs: 100 })];
    let activity: TaskActivity = recordTaskActivity({}, 'a', 200);
    expect(taskListWithPreviews(native, {}, activity)[0]).toMatchObject({ title: 'Latest title', cwd: native[0].cwd, updatedAtMs: 200 });
    activity = recordTaskActivity(activity, 'a', 500);
    const late = recordTaskActivity(activity, 'a', 250);
    expect(late).toBe(activity);
    expect(taskListWithPreviews(native, {}, late)[0].updatedAtMs).toBe(500);
    expect(taskListWithPreviews([task('a', { updatedAtMs: 600 })], {}, late)[0].updatedAtMs).toBe(600);
  });

  it('keeps parallel tasks independent and uses the same time for all sidebar sort modes', () => {
    let activity = recordTaskActivity({}, 'pi', 400);
    activity = recordTaskActivity(activity, 'claude', 500);
    const listed = taskListWithPreviews([task('pi', { agent: 'pi' }), task('claude', { agent: 'claude' })], {}, activity);
    expect(sortSidebarTasks(listed, 'time').map(({ id }) => id)).toEqual(['claude', 'pi']);
    expect(sortSidebarTasks(listed, 'type').map(({ id }) => id)).toEqual(['claude', 'pi']);
    const waiting = { waiting: new Set(['pi']), unread: new Set<string>(), isRunning: () => true, held: new Map<string, number>(), leftAt: new Map<string, number>() };
    expect(sortSidebarTasks(listed, 'priority', waiting).map(({ id }) => id)).toEqual(['pi', 'claude']);
    expect(Object.keys(activity)).toEqual(['pi', 'claude']);
  });

  it('uses recorded timestamps when an external task is followed and never turns a read into fresh activity', () => {
    const sentAt = Date.parse('2026-11-12T01:00:00Z');
    const replyAt = Date.parse('2026-11-12T01:01:00Z');
    const recorded = recordedTaskActivity([{ timestamp: '2026-11-12T01:00:00Z' }, { timestamp: 'invalid' }, {}, { timestamp: '2026-11-12T01:01:00Z' }]);
    expect(recorded).toBe(replyAt);
    expect(recordedTaskActivity([{}, { timestamp: 'invalid' }])).toBe(0);
    const activity = recordTaskActivity({}, 'a', recorded);
    const listed = taskListWithPreviews([task('a', { updatedAtMs: sentAt })], {}, activity);
    expect(formatAge(listed[0].updatedAtMs, replyAt + 120000)).toBe('2 分钟');
    expect(taskListWithPreviews([], {}, activity)).toEqual([]);
  });

  it('retains the highest observed native time when list requests finish out of order', () => {
    const current = [task('a', { title: 'Earlier title', updatedAtMs: 300 })];
    const incoming = [task('a', { title: 'Native title', cwd: '/new-path', updatedAtMs: 100 }), task('b', { updatedAtMs: 50 })];
    const saved = retainTaskTimes(current, incoming);
    expect(saved[0]).toMatchObject({ title: 'Native title', cwd: '/new-path', updatedAtMs: 300 });
    expect(saved[1]).toBe(incoming[1]);
    expect(retainTaskTimes(saved, [])).toEqual([]);
  });
});

describe('started task list preview', () => {
  it.each<Agent>(['claude', 'codex', 'pi'])('shows the real %s task ID and prompt before the first response or native list entry', (agent) => {
    const started = task('started-id', { agent, title: '首条消息', updatedAtMs: 100 });
    const existing = task('earlier', { updatedAtMs: 50 });
    expect(taskListWithPreviews([existing], { [started.id]: started })).toEqual([started, existing]);
    expect(taskListWithPreviews([], { [started.id]: started })).toEqual([started]);
  });

  it('keeps previews when an earlier disk scan returns without the new task', () => {
    const started = task('new', { title: '只有图片', updatedAtMs: 100 });
    const previews = { new: started };
    const native = [task('old')];
    const afterScan = clearTaskPreviews(previews, native.map(({ id }) => id));
    expect(afterScan).toBe(previews);
    expect(taskListWithPreviews(native, afterScan)).toEqual([started, native[0]]);
  });

  it('hands the same ID to native metadata once without changing sibling tasks', () => {
    const preview = task('new', { title: 'first prompt', cwd: '/project', updatedAtMs: 100 });
    const native = task('new', { title: 'Native title', cwd: '/project/.claude/worktrees/branch', updatedAtMs: 120 });
    const sibling = task('parallel', { agent: 'codex', updatedAtMs: 110 });
    const previews = { new: preview, parallel: sibling };
    expect(taskListWithPreviews([native], previews)).toEqual([native, sibling]);
    const remaining = clearTaskPreviews(previews, [native.id]);
    expect(remaining).toEqual({ parallel: sibling });
    expect(taskListWithPreviews([native], remaining)).toEqual([native, sibling]);
    expect(previews.new).toBe(preview);
  });

  it('removes a failed or cancelled startup preview while preserving a native task if one exists', () => {
    const first = task('failed'), second = task('still-running');
    const previews = { failed: first, 'still-running': second };
    const remaining = clearTaskPreviews(previews, [first.id]);
    expect(taskListWithPreviews([], remaining)).toEqual([second]);
    expect(taskListWithPreviews([first], remaining)).toEqual([second, first]);
    expect(previews).toEqual({ failed: first, 'still-running': second });
  });

  it('uses stable IDs for parallel tasks with identical first prompts', () => {
    const first = task('a', { title: 'Continue', updatedAtMs: 50 });
    const second = task('b', { title: 'Continue', updatedAtMs: 100 });
    expect(taskListWithPreviews([], { a: first, b: second })).toEqual([second, first]);
  });
});
