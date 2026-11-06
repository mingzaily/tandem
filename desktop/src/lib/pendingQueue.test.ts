import { describe, expect, it } from 'vitest';
import type { TaskQueue } from './api';
import { mergeQueue, queueDropTarget, queueInsertionIndex, queueKeyboardTarget, visibleQueueCount } from './pendingQueue';

describe('pending queue', () => {
  it('shows four rows and collapses five or more to three', () => {
    expect(visibleQueueCount(4, false)).toBe(4);
    expect(visibleQueueCount(5, false)).toBe(3);
    expect(visibleQueueCount(20, true)).toBe(20);
  });

  it('turns pointer insertion slots into final row positions in either direction', () => {
    expect(queueDropTarget(5, 0, 3)).toBe(2);
    expect(queueDropTarget(5, 3, 0)).toBe(0);
    expect(queueDropTarget(5, 2, 2)).toBe(2);
    expect(queueDropTarget(5, 2, 3)).toBe(2);
    expect(queueDropTarget(5, 0, 5)).toBe(4);
  });

  it('uses measured row centers and list padding for pointer insertion', () => {
    const rows = [{ start: 6, end: 32 }, { start: 32, end: 58 }, { start: 58, end: 84 }];
    expect(queueInsertionIndex(rows, 0)).toBe(0);
    expect(queueInsertionIndex(rows, 18)).toBe(0);
    expect(queueInsertionIndex(rows, 19)).toBe(1);
    expect(queueInsertionIndex(rows, 46)).toBe(2);
    expect(queueInsertionIndex(rows, 100)).toBe(3);
  });

  it('keeps pointer sorting aligned when font scaling changes row heights', () => {
    const rows = [{ start: 6, end: 34 }, { start: 34, end: 64 }, { start: 64, end: 94 }];
    expect(queueInsertionIndex(rows, 33)).toBe(1);
    expect(queueInsertionIndex(rows, 48)).toBe(1);
    expect(queueInsertionIndex(rows, 50)).toBe(2);
    expect(queueInsertionIndex(rows, 90)).toBe(3);
  });

  it('supports arrows, Home and End across the full queue', () => {
    expect(queueKeyboardTarget(6, 0, 'ArrowUp')).toBe(0);
    expect(queueKeyboardTarget(6, 5, 'ArrowDown')).toBe(5);
    expect(queueKeyboardTarget(6, 2, 'ArrowUp')).toBe(1);
    expect(queueKeyboardTarget(6, 2, 'ArrowDown')).toBe(3);
    expect(queueKeyboardTarget(6, 2, 'Home')).toBe(0);
    expect(queueKeyboardTarget(6, 2, 'End')).toBe(5);
    expect(queueKeyboardTarget(6, 2, 'Enter')).toBeNull();
  });

  it('keeps a newer event when an earlier IPC response arrives later', () => {
    const queue: TaskQueue = { taskId: 'task', agent: 'claude', paused: false, error: null, entries: [], revision: 3 };
    const state = { task: queue };
    expect(mergeQueue(state, { ...queue, revision: 2, paused: true })).toBe(state);
    expect(mergeQueue(state, { ...queue, revision: 4, paused: true }).task.paused).toBe(true);
  });
});
