import { describe, expect, it } from 'vitest';
import { historyForTask, historyReadyForTask, HistoryReads, type TaskHistory } from './taskHistory';
import type { Item } from './items';

const visit = {};
const items = (id: string): Item[] => [{ type: 'user', id, text: id }];

describe('selected task history ownership', () => {
  it('does not lend A history to B during the render before the switch effect runs', () => {
    const snapshot: TaskHistory = { taskId: 'a', items: items('a'), ready: true, visit };
    expect(historyForTask(snapshot, 'a')).toBe(snapshot.items);
    expect(historyForTask(snapshot, 'b')).toEqual([]);
    expect(historyForTask(snapshot, null)).toEqual([]);
    expect(historyForTask(null, 'b')).toEqual([]);
  });

  it('keeps an unavailable task’s empty projection stable across unrelated renders', () => {
    const snapshot: TaskHistory = { taskId: 'a', items: items('a'), ready: true, visit };
    expect(historyForTask(snapshot, 'b')).toBe(historyForTask(snapshot, 'b'));
    expect(historyForTask(null, 'b')).toBe(historyForTask(snapshot, 'b'));
  });

  it('waits for a fresh B read when a short new A never replaced the prior B snapshot', () => {
    const firstB = {};
    const snapshot: TaskHistory = { taskId: 'b', items: items('old-b'), ready: true, visit: firstB };
    expect(historyReadyForTask(snapshot, 'b', firstB)).toBe(true);
    expect(historyReadyForTask(snapshot, 'a', {})).toBe(false);
    const returnedB = {};
    expect(historyReadyForTask(snapshot, 'b', returnedB)).toBe(false);
    expect(historyReadyForTask({ ...snapshot, visit: returnedB }, 'b', returnedB)).toBe(true);
  });

  it('rejects an old A read when A is opened again after B', () => {
    const reads = new HistoryReads();
    const firstA = reads.begin('a');
    const b = reads.begin('b');
    const secondA = reads.begin('a');
    expect(firstA.isCurrent()).toBe(false);
    expect(b.isCurrent()).toBe(true);
    expect(secondA.isCurrent()).toBe(true);
    firstA.release();
    expect(secondA.isCurrent()).toBe(true);
    secondA.release();
    expect(firstA.isCurrent()).toBe(false);
    expect(secondA.isCurrent()).toBe(false);
  });

  it('accepts only the newest same-task result when native reads resolve out of order', async () => {
    const reads = new HistoryReads();
    let snapshot: TaskHistory | null = null;
    let finishOld!: (value: Item[]) => void;
    let finishNew!: (value: Item[]) => void;
    const run = async (read: Promise<Item[]>) => {
      const pending = reads.begin('a');
      try {
        const value = await read;
        if (pending.isCurrent()) snapshot = { taskId: 'a', items: value, ready: true, visit };
      } finally { pending.release(); }
    };
    const old = run(new Promise((resolve) => { finishOld = resolve; }));
    const fresh = run(new Promise((resolve) => { finishNew = resolve; }));
    finishNew(items('latest'));
    await fresh;
    finishOld(items('stale'));
    await old;
    expect(snapshot).toEqual({ taskId: 'a', items: items('latest'), ready: true, visit });
  });
});
