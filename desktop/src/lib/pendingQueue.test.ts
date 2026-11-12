import { describe, expect, it } from 'vitest';
import type { TaskQueue } from './api';
import { mergeQueue, queueDragTransaction, queueDropTarget, queueInsertionIndex, queueKeyboardTarget, queuePreviewStart, queueScrollStep, visibleQueueCount } from './pendingQueue';

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

  it('previews surrounding rows moving aside for differently sized dragged rows', () => {
    const rows = [{ start: 6, end: 38 }, { start: 38, end: 78 }, { start: 78, end: 110 }, { start: 110, end: 142 }];
    expect(rows.map((_, index) => queuePreviewStart(rows, index, 0, 2))).toEqual([78, 6, 46, 110]);
    expect(rows.map((_, index) => queuePreviewStart(rows, index, 2, 0))).toEqual([38, 70, 6, 110]);
    expect(rows.map((_, index) => queuePreviewStart(rows, index, 1, 1))).toEqual(rows.map(({ start }) => start));
  });

  it('scrolls only near the edges at a bounded time-based speed', () => {
    expect(queueScrollStep(80, 0, 196, 16)).toBe(0);
    expect(queueScrollStep(0, 0, 196, 16)).toBeCloseTo(-5.76);
    expect(queueScrollStep(196, 0, 196, 16)).toBeCloseTo(5.76);
    expect(queueScrollStep(250, 0, 196, 1000)).toBeCloseTo(11.52);
  });

  it('commits once after acquiring the drag lock and releases after saving', async () => {
    const events: string[] = [];
    let acquired!: () => void;
    const lock = new Promise<void>((resolve) => { acquired = resolve; });
    const finish = queueDragTransaction(lock, async () => { events.push('release'); });
    const complete = finish(async () => { events.push('save'); });
    expect(finish()).toBe(complete);
    expect(events).toEqual([]);
    acquired();
    await complete;
    expect(events).toEqual(['save', 'release']);
  });

  it('cancels without a reorder and releases the lock even when saving fails', async () => {
    let releases = 0;
    await queueDragTransaction(Promise.resolve(), async () => { releases += 1; })();
    const finish = queueDragTransaction(Promise.resolve(), async () => { releases += 1; });
    await expect(finish(async () => { throw new Error('write failed'); })).rejects.toThrow('write failed');
    expect(releases).toBe(2);
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
    const queue: TaskQueue = { taskId: 'task', agent: 'claude', paused: false, pausedAfterRestart: false, error: null, entries: [], revision: 3 };
    const state = { task: queue };
    expect(mergeQueue(state, { ...queue, revision: 2, paused: true })).toBe(state);
    expect(mergeQueue(state, { ...queue, revision: 4, paused: true }).task.paused).toBe(true);
  });
});
