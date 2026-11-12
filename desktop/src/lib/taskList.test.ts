import { describe, expect, it } from 'vitest';
import type { Agent, TaskSummary } from './api';
import { clearTaskPreviews, taskListWithPreviews } from './taskList';

const task = (id: string, overrides: Partial<TaskSummary> = {}): TaskSummary => ({
  id, agent: 'pi', title: id, cwd: '/project', updatedAtMs: 10, ...overrides,
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
