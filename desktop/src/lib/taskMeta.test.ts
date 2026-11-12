import { describe, expect, it } from 'vitest';
import { acceptNativeTitle, EMPTY_TASK_META, renameTask, taskTitle, toggleArchived, togglePin, unarchive } from './taskMeta';

describe('taskMeta', () => {
  it('pins and unpins', () => {
    const pinned = togglePin(EMPTY_TASK_META, 'a');
    expect(pinned.pins).toEqual(['a']);
    expect(togglePin(pinned, 'a').pins).toEqual([]);
  });

  it('removes the pin when archiving', () => {
    const archived = toggleArchived(togglePin(EMPTY_TASK_META, 'a'), 'a');
    expect(archived).toMatchObject({ pins: [], archived: ['a'] });
  });

  it('brings an archived task back and leaves others untouched', () => {
    const archived = toggleArchived(EMPTY_TASK_META, 'a');
    expect(unarchive(archived, 'a').archived).toEqual([]);
    expect(unarchive(archived, 'b')).toBe(archived);
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
