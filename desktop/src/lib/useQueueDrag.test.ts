import type { PointerEvent as ReactPointerEvent } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useQueueDrag } from './useQueueDrag';
import type { TaskQueue } from './api';

const harness = vi.hoisted(() => ({ states: [] as unknown[], effects: [] as (() => void | (() => void))[], cleanups: [] as (() => void)[], cursor: 0 }));
vi.mock('react', () => ({
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => {
    const index = harness.cursor++;
    harness.states[index] = initial;
    return [initial, (value: unknown) => { harness.states[index] = value; }];
  },
  useEffect: (effect: () => void | (() => void)) => {
    harness.effects.push(effect);
    const cleanup = effect();
    if (cleanup) harness.cleanups.push(cleanup);
  },
}));
vi.mock('./api', () => ({ setQueueLock: vi.fn(), reorderQueuedTurn: vi.fn() }));
import { reorderQueuedTurn, setQueueLock } from './api';

let frames: Map<number, FrameRequestCallback>;
let windowEvents: EventTarget;
let documentEvents: EventTarget & { visibilityState: string; body: { classList: { add: (name: string) => void; remove: (name: string) => void } } };
const settle = async () => { for (let index = 0; index < 12; index += 1) await Promise.resolve(); };
const emit = (type: string, properties: Record<string, unknown> = {}) => windowEvents.dispatchEvent(Object.assign(new Event(type), properties));

function fixture() {
  const queue: TaskQueue = {
    taskId: 'task', agent: 'pi', paused: false, pausedAfterRestart: false, revision: 1, error: null,
    entries: Array.from({ length: 7 }, (_, index) => ({ id: `entry-${index}`, prompt: `message ${index}`, attachments: [], options: { model: null, effort: null, permissionMode: null } })),
  };
  const onExpand = vi.fn(), onChange = vi.fn(), onMoved = vi.fn(), onError = vi.fn();
  const scroller = { current: { scrollTop: 0, getBoundingClientRect: () => ({ left: 20, right: 420, top: 100, bottom: 296 }) } as HTMLDivElement };
  const hook = useQueueDrag({ queue, scroller, measurements: () => queue.entries.map((_, index) => ({ start: 6 + index * 32, end: 38 + index * 32 })), onExpand, onChange, onMoved, onError });
  const currentTarget = { focus: vi.fn(), closest: () => ({ getBoundingClientRect: () => ({ left: 20, top: 106, width: 400, height: 32 }) }) };
  const event = { button: 0, pointerId: 1, clientX: 30, clientY: 116, currentTarget, preventDefault: vi.fn() } as unknown as ReactPointerEvent<HTMLButtonElement>;
  return { hook, queue, event, onExpand, onChange, onMoved, onError };
}

beforeEach(() => {
  harness.cursor = 0;
  harness.states = [];
  harness.effects = [];
  harness.cleanups = [];
  vi.resetAllMocks();
  vi.mocked(setQueueLock).mockResolvedValue(undefined);
  frames = new Map();
  windowEvents = new EventTarget();
  documentEvents = Object.assign(new EventTarget(), { visibilityState: 'visible', body: { classList: { add: vi.fn(), remove: vi.fn() } } });
  vi.stubGlobal('window', windowEvents);
  vi.stubGlobal('document', documentEvents);
  let id = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (key: number) => frames.delete(key));
});
afterEach(async () => {
  for (const cleanup of harness.cleanups) cleanup();
  await settle();
  vi.unstubAllGlobals();
});

describe('queue drag lifecycle', () => {
  it('keeps a click and sub-threshold movement from sorting or expanding the queue', async () => {
    const test = fixture();
    test.hook.startDrag(test.event, test.queue.entries[0], 0);
    await settle();
    emit('pointermove', { pointerId: 1, clientX: 30, clientY: 119 });
    emit('pointerup', { pointerId: 1, clientX: 30, clientY: 119 });
    await settle();
    expect(test.onExpand).not.toHaveBeenCalled();
    expect(reorderQueuedTurn).not.toHaveBeenCalled();
    expect(vi.mocked(setQueueLock).mock.calls.map((call) => call[3])).toEqual([true, false]);
    expect(frames.size).toBe(0);
  });

  it('shows a floating row, expands the tail, and commits the final position once before unlocking', async () => {
    const test = fixture();
    vi.mocked(reorderQueuedTurn).mockResolvedValue({ ...test.queue, revision: 2 });
    test.hook.startDrag(test.event, test.queue.entries[0], 0);
    await settle();
    emit('pointermove', { pointerId: 1, clientX: 30, clientY: 200 });
    expect(harness.states[0]).toMatchObject({ entry: { id: 'entry-0' }, from: 0, target: 2, top: 190, width: 400, height: 32 });
    expect(test.onExpand).toHaveBeenCalledOnce();
    emit('pointerup', { pointerId: 1, clientX: 30, clientY: 200 });
    emit('pointerup', { pointerId: 1, clientX: 30, clientY: 200 });
    await settle();
    expect(reorderQueuedTurn).toHaveBeenCalledExactlyOnceWith('task', 'entry-0', 2);
    expect(test.onMoved).toHaveBeenCalledWith(2);
    expect(setQueueLock).toHaveBeenLastCalledWith('task', expect.any(String), null, false);
    expect(harness.states[0]).toBeNull();
    expect(frames.size).toBe(0);
  });

  it.each(['blur', 'pointercancel', 'escape', 'hidden', 'outside', 'unmount'])('cancels on %s and releases the dispatch lock without reordering', async (reason) => {
    const test = fixture();
    test.hook.startDrag(test.event, test.queue.entries[0], 0);
    await settle();
    emit('pointermove', { pointerId: 1, clientX: 30, clientY: 200 });
    if (reason === 'escape') emit('keydown', { key: 'Escape' });
    else if (reason === 'hidden') { documentEvents.visibilityState = 'hidden'; documentEvents.dispatchEvent(new Event('visibilitychange')); }
    else if (reason === 'outside') emit('pointerup', { pointerId: 1, clientX: 500, clientY: 200 });
    else if (reason === 'unmount') harness.cleanups[0]();
    else emit(reason);
    await settle();
    expect(reorderQueuedTurn).not.toHaveBeenCalled();
    expect(vi.mocked(setQueueLock).mock.calls.map((call) => call[3])).toEqual([true, false]);
    expect(harness.states[0]).toBeNull();
    expect(frames.size).toBe(0);
  });

  it('cancels while the lock request is still pending without activating later', async () => {
    let resolve!: () => void;
    vi.mocked(setQueueLock).mockImplementationOnce(() => new Promise<void>((done) => { resolve = done; }));
    const test = fixture();
    test.hook.startDrag(test.event, test.queue.entries[0], 0);
    emit('pointermove', { pointerId: 1, clientX: 30, clientY: 200 });
    emit('blur');
    resolve();
    await settle();
    expect(test.onExpand).not.toHaveBeenCalled();
    expect(reorderQueuedTurn).not.toHaveBeenCalled();
    expect(setQueueLock).toHaveBeenLastCalledWith('task', expect.any(String), null, false);
  });

  it('restores the preview and releases the lock after a failed reorder', async () => {
    vi.mocked(reorderQueuedTurn).mockRejectedValue(new Error('write failed'));
    const test = fixture();
    test.hook.startDrag(test.event, test.queue.entries[0], 0);
    await settle();
    emit('pointermove', { pointerId: 1, clientX: 30, clientY: 200 });
    emit('pointerup', { pointerId: 1, clientX: 30, clientY: 200 });
    await settle();
    expect(test.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'write failed' }));
    expect(test.onChange).not.toHaveBeenCalled();
    expect(setQueueLock).toHaveBeenLastCalledWith('task', expect.any(String), null, false);
    expect(harness.states[0]).toBeNull();
  });
});
