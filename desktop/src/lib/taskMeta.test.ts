import { describe, expect, it } from 'vitest';
import { acceptNativeTitle, archivedTaskIds, EMPTY_TASK_META, isTaskArchived, renameTask, taskTitle, togglePin } from './taskMeta';

describe('taskMeta', () => {
  it('pins and unpins', () => {
    const pinned = togglePin(EMPTY_TASK_META, 'a');
    expect(pinned.pins).toEqual(['a']);
    expect(togglePin(pinned, 'a').pins).toEqual([]);
  });

  it('recognizes native Codex archives alongside existing local marks', () => {
    const meta = { ...EMPTY_TASK_META, archived: ['local'] };
    expect(isTaskArchived(meta, { id: 'native', archived: true })).toBe(true);
    expect(isTaskArchived(meta, { id: 'local', archived: false })).toBe(true);
    expect(isTaskArchived(meta, { id: 'active', archived: false })).toBe(false);
  });

  it('deduplicates archived ids for attention counts without persisting native state', () => {
    const meta = { pins: ['active'], archived: ['local', 'native'], titles: {} };
    const tasks = ['native', 'active'].map((id) => ({ id, title: id, cwd: '/project', agent: 'codex' as const, updatedAtMs: 0, archived: id === 'native' }));
    expect(archivedTaskIds(meta, tasks)).toEqual(['local', 'native']);
    expect(meta).toEqual({ pins: ['active'], archived: ['local', 'native'], titles: {} });
  });

  it('a rename overrides the title and an empty one restores it', () => {
    const task = { id: 'a', title: 'from cli' };
    const renamed = renameTask(EMPTY_TASK_META, 'a', '  mine ');
    expect(taskTitle(renamed, task)).toBe('mine');
    expect(taskTitle(renameTask(renamed, 'a', '   '), task)).toBe('from cli');
  });

  it('keeps a manual rename made while a generated title is in flight', () => {
    const manual = renameTask(EMPTY_TASK_META, 'a', '手动标题');
    expect(acceptNativeTitle(manual, 'a', undefined)).toBe(manual);
  });

  it('adopts the native title and preserves newer pin and archive changes', () => {
    const current = togglePin(renameTask(EMPTY_TASK_META, 'a', '旧别名'), 'b');
    const updated = acceptNativeTitle(current, 'a', '旧别名');
    expect(updated.titles.a).toBeUndefined();
    expect(taskTitle(updated, { id: 'a', title: '原生标题' })).toBe('原生标题');
    expect(updated.pins).toEqual(['b']);
  });
});
