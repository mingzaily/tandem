// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PendingQueuePanel } from './PendingQueuePanel';
import type { TaskQueue } from '../lib/api';
import { mergeQueue } from '../lib/pendingQueue';

vi.mock('../lib/api', async (original) => ({
  ...await original<typeof import('../lib/api')>(), setQueueLock: vi.fn(), reorderQueuedTurn: vi.fn(),
}));
import { reorderQueuedTurn, setQueueLock } from '../lib/api';

let root: Root;
let host: HTMLDivElement;
let queue: TaskQueue;
let frames: Map<number, FrameRequestCallback>;
let captures: Map<number, HTMLElement>;
let publish: (snapshot: TaskQueue) => void;
const onError = vi.fn();
const rect = (left: number, top: number, width: number, height: number) => new DOMRect(left, top, width, height);

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('navigator', { language: 'zh-CN' });
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  captures = new Map();
  vi.spyOn(HTMLElement.prototype, 'setPointerCapture').mockImplementation(function (this: HTMLElement, id) { captures.set(id, this); });
  vi.spyOn(HTMLElement.prototype, 'hasPointerCapture').mockImplementation(function (this: HTMLElement, id) { return captures.get(id) === this; });
  vi.spyOn(HTMLElement.prototype, 'releasePointerCapture').mockImplementation(function (this: HTMLElement, id) {
    if (captures.get(id) === this) captures.delete(id);
  });
  frames = new Map(); let id = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (key: number) => frames.delete(key));
  queue = { taskId: 'task', agent: 'pi', paused: true, pausedAfterRestart: false, error: null, revision: 1,
    entries: ['first', 'second'].map((id) => ({ id, prompt: id, attachments: [], options: { model: null, effort: null, permissionMode: null } })) };
  vi.mocked(setQueueLock).mockResolvedValue(undefined);
  vi.mocked(reorderQueuedTurn).mockImplementation(async (_taskId, entryId, target) => {
    const entries = [...queue.entries];
    const [moved] = entries.splice(entries.findIndex((entry) => entry.id === entryId), 1);
    entries.splice(target, 0, moved);
    queue = { ...queue, entries, revision: queue.revision + 1 };
    return queue;
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.hasAttribute('data-queue-entry')) {
      const offset = Number(/translateY\(([-\d.]+)px\)/.exec(this.style.transform)?.[1] ?? 0);
      return rect(20, 100 + offset, 400, 32);
    }
    if (this.classList.contains('pending-queue-scroll')) return rect(20, 100, 400, Math.min(196, queue.entries.length * 32 + 12));
    return rect(20, 100, 400, 32);
  });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.getBoundingClientRect().height; });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.getBoundingClientRect().height; });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, 'scrollTo').mockImplementation(function (this: HTMLElement, options: number | ScrollToOptions) {
    this.scrollTop = typeof options === 'number' ? options : options.top ?? this.scrollTop;
  });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.classList.remove('pending-queue-dragging'); vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

function Panel() {
  const [state, setState] = useState<Record<string, TaskQueue>>({ task: queue });
  publish = (snapshot) => setState((current) => mergeQueue(current, snapshot));
  return <PendingQueuePanel queue={state.task} onChange={publish}
    onEdit={() => {}} onError={onError} running onSteer={() => {}} onNewTask={async () => {}} />;
}
const pointer = (type: string, y: number) => new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 1, clientX: 30, clientY: y });
const handle = (id: string) => host.querySelector<HTMLButtonElement>(`[data-queue-entry="${id}"] button`)!;
const currentOrder = () => [...host.querySelectorAll<HTMLElement>('[data-queue-entry]')].sort((a, b) => Number(a.dataset.index) - Number(b.dataset.index)).map((row) => row.dataset.queueEntry);

describe('queue drag DOM handoff', () => {
  it('captures the gesture on the stable list so release over a disabled action is still committed', async () => {
    await act(async () => root.render(<Panel />));
    const source = handle('second');
    await act(async () => source.dispatchEvent(pointer('pointerdown', 148)));
    const list = host.querySelector<HTMLElement>('[role="list"]')!;
    expect(captures.get(1)).toBe(list);
    await act(async () => window.dispatchEvent(pointer('pointermove', 110)));
    expect(source.disabled).toBe(false);
    await act(async () => source.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })));
    expect(reorderQueuedTurn).not.toHaveBeenCalled();
    const destinationAction = host.querySelector<HTMLButtonElement>('[data-queue-entry="first"] button[aria-label^="插话"]')
      ?? host.querySelector<HTMLButtonElement>('[data-queue-entry="first"] button:not(:first-child)');
    expect(destinationAction?.disabled).toBe(true);
    // Captured events are dispatched to the list even if the pointer is above a disabled child.
    await act(async () => captures.get(1)!.dispatchEvent(pointer('pointerup', 110)));
    expect(currentOrder()).toEqual(['second', 'first']);
    expect(reorderQueuedTurn).toHaveBeenCalledExactlyOnceWith('task', 'second', 0);
    expect(captures.size).toBe(0);
  });

  it('hands a broadcast order to the actual rows before a slower reorder response returns', async () => {
    let resolve!: (snapshot: TaskQueue) => void;
    vi.mocked(reorderQueuedTurn).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    await act(async () => root.render(<Panel />));
    const source = handle('second');
    await act(async () => source.dispatchEvent(pointer('pointerdown', 148)));
    await act(async () => window.dispatchEvent(pointer('pointermove', 110)));
    await act(async () => window.dispatchEvent(pointer('pointerup', 110)));
    expect(reorderQueuedTurn).toHaveBeenCalledExactlyOnceWith('task', 'second', 0);
    const confirmed = { ...queue, revision: 2, entries: [queue.entries[1], queue.entries[0]] };
    try {
      await act(async () => publish(confirmed));
      expect(currentOrder()).toEqual(['second', 'first']);
      expect(host.querySelector<HTMLElement>('[data-queue-entry="second"]')!.style.transform).toBe('translateY(6px)');
      expect(host.querySelector<HTMLElement>('[data-queue-entry="first"]')!.style.transform).toBe('translateY(38px)');
      expect(document.body.querySelector('.pending-queue-row.fixed')).toBeNull();
    } finally { await act(async () => resolve(confirmed)); }
    expect(vi.mocked(setQueueLock).mock.calls.map((call) => call[3])).toEqual([true, false]);
  });

  it('keeps the confirmed order while queue unlock is still waiting', async () => {
    let unlock!: () => void;
    vi.mocked(setQueueLock).mockImplementation(async (_task, _owner, _entry, locked) => {
      if (!locked) await new Promise<void>((resolve) => { unlock = resolve; });
    });
    await act(async () => root.render(<Panel />));
    await act(async () => handle('second').dispatchEvent(pointer('pointerdown', 148)));
    await act(async () => window.dispatchEvent(pointer('pointermove', 110)));
    await act(async () => window.dispatchEvent(pointer('pointerup', 110)));
    try {
      expect(currentOrder()).toEqual(['second', 'first']);
      expect(host.querySelector<HTMLElement>('[data-queue-entry="second"]')!.style.transform).toBe('translateY(6px)');
      expect(document.body.querySelector('.pending-queue-row.fixed')).toBeNull();
      expect(captures.size).toBe(0);
    } finally { await act(async () => unlock()); }
    expect(reorderQueuedTurn).toHaveBeenCalledOnce();
  });

  it.each([
    { from: 'second', start: 148, release: 110, target: 0, expected: ['second', 'first'] },
    { from: 'first', start: 116, release: 166, target: 1, expected: ['second', 'first'] },
  ])('persists $from at final index $target after real component rerenders', async ({ from, start, release, target, expected }) => {
    await act(async () => root.render(<Panel />));
    const source = handle(from);
    await act(async () => source.dispatchEvent(pointer('pointerdown', start)));
    await act(async () => window.dispatchEvent(pointer('pointermove', release)));
    expect(document.body.classList.contains('pending-queue-dragging')).toBe(true);
    await act(async () => source.dispatchEvent(pointer('pointerup', release)));
    expect(reorderQueuedTurn).toHaveBeenCalledExactlyOnceWith('task', from, target);
    expect(currentOrder()).toEqual(expected);
    expect(onError).not.toHaveBeenCalled();
    expect(document.body.classList.contains('pending-queue-dragging')).toBe(false);
    expect(vi.mocked(setQueueLock).mock.calls.map((call) => call[3])).toEqual([true, false]);
  });

  it('preserves keyboard reordering outside an active pointer gesture', async () => {
    await act(async () => root.render(<Panel />));
    await act(async () => handle('second').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })));
    expect(reorderQueuedTurn).toHaveBeenCalledExactlyOnceWith('task', 'second', 0);
    expect(currentOrder()).toEqual(['second', 'first']);
    expect(setQueueLock).not.toHaveBeenCalled();
  });

  it('keeps capture on the same list as a collapsed long queue expands during the drag', async () => {
    queue = { ...queue, entries: Array.from({ length: 7 }, (_, index) => ({ ...queue.entries[0], id: `entry-${index}`, prompt: `message ${index}` })) };
    await act(async () => root.render(<Panel />));
    expect(currentOrder()).toHaveLength(3);
    const source = handle('entry-2');
    const list = host.querySelector<HTMLElement>('[role="list"]')!;
    await act(async () => source.dispatchEvent(pointer('pointerdown', 180)));
    await act(async () => window.dispatchEvent(pointer('pointermove', 110)));
    expect(captures.get(1)).toBe(list);
    expect(currentOrder()).toHaveLength(7);
    await act(async () => list.dispatchEvent(pointer('pointerup', 110)));
    expect(reorderQueuedTurn).toHaveBeenCalledExactlyOnceWith('task', 'entry-2', 0);
    expect(currentOrder()[0]).toBe('entry-2');
    expect(captures.size).toBe(0);
  });

  it('cancels a gesture when an unrelated queue change arrives and preserves that snapshot', async () => {
    await act(async () => root.render(<Panel />));
    await act(async () => handle('second').dispatchEvent(pointer('pointerdown', 148)));
    await act(async () => window.dispatchEvent(pointer('pointermove', 110)));
    const updated = { ...queue, revision: 2, entries: [...queue.entries, { ...queue.entries[0], id: 'third', prompt: 'third' }] };
    await act(async () => publish(updated));
    expect(currentOrder()).toEqual(['first', 'second', 'third']);
    expect(captures.size).toBe(0);
    expect(document.body.querySelector('.pending-queue-row.fixed')).toBeNull();
    await act(async () => window.dispatchEvent(pointer('pointerup', 110)));
    expect(reorderQueuedTurn).not.toHaveBeenCalled();
    expect(vi.mocked(setQueueLock).mock.calls.map((call) => call[3])).toEqual([true, false]);
  });

  it('retains the original order, reports a failed save and releases the captured pointer and queue lock', async () => {
    vi.mocked(reorderQueuedTurn).mockRejectedValueOnce(new Error('write failed'));
    await act(async () => root.render(<Panel />));
    await act(async () => handle('second').dispatchEvent(pointer('pointerdown', 148)));
    await act(async () => window.dispatchEvent(pointer('pointermove', 110)));
    await act(async () => window.dispatchEvent(pointer('pointerup', 110)));
    expect(currentOrder()).toEqual(['first', 'second']);
    expect(host.querySelector<HTMLElement>('[data-queue-entry="second"]')!.style.transform).toBe('translateY(38px)');
    expect(onError).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: 'write failed' }));
    expect(captures.size).toBe(0);
    expect(document.body.querySelector('.pending-queue-row.fixed')).toBeNull();
    expect(vi.mocked(setQueueLock).mock.calls.map((call) => call[3])).toEqual([true, false]);
  });
});
