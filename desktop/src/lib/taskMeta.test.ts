import { describe, expect, it } from 'vitest';
import { EMPTY_TASK_META, renameTask, taskTitle, toggleArchived, togglePin } from './taskMeta';

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

  it('a rename overrides the title and an empty one restores it', () => {
    const task = { id: 'a', title: 'from cli' };
    const renamed = renameTask(EMPTY_TASK_META, 'a', '  mine ');
    expect(taskTitle(renamed, task)).toBe('mine');
    expect(taskTitle(renameTask(renamed, 'a', '   '), task)).toBe('from cli');
  });
});
