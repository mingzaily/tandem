import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONVERSATION_CWD } from './items';
import { useSidebarDrag, type SidebarDrag } from './useSidebarDrag';

const harness = vi.hoisted(() => ({ state: null as unknown, cleanups: [] as (() => void)[], effects: [] as (() => void | (() => void))[] }));
vi.mock('react', () => ({
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => {
    harness.state = initial;
    return [initial, (value: unknown) => { harness.state = typeof value === 'function' ? value(harness.state) : value; }];
  },
  useEffect: (effect: () => void | (() => void)) => {
    harness.effects.push(effect);
    const cleanup = effect();
    if (cleanup) harness.cleanups.push(cleanup);
  },
}));

let frames: Map<number, FrameRequestCallback>;
let windowEvents: EventTarget;
let documentEvents: EventTarget & { visibilityState: string; body: { classList: { add: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> } } };
const emit = (type: string, properties: Record<string, unknown> = {}) => windowEvents.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), properties));
const preview = () => harness.state as SidebarDrag | null;
const nextFrame = (time: number) => {
  const callbacks = [...frames.values()];
  frames.clear();
  callbacks.forEach((callback) => callback(time));
};

function fixture(ids = ['/a', '/b', '/c'], pinned: string[] = []) {
  const starts = [40, 104, 304];
  const heights = [64, 200, 32];
  const sections = ids.map((id, index) => ({
    dataset: { project: id }, offsetTop: starts[index], offsetHeight: heights[index],
    querySelector: () => ({ offsetHeight: 32 }),
  }));
  const element = {
    scrollTop: 0,
    getBoundingClientRect: () => ({ left: 20, right: 260, top: 100, bottom: 500 }),
    querySelectorAll: () => sections,
  } as unknown as HTMLElement;
  const onMove = vi.fn();
  const options = { ids, pinned, scroller: { current: element }, disabled: false, version: 'initial', onMove };
  const hook = useSidebarDrag(options);
  const event = {
    button: 0, pointerId: 1, clientX: 50, clientY: 150,
    currentTarget: { getBoundingClientRect: () => ({ left: 32, top: 140, width: 216, height: 32 }) },
    target: { closest: () => null }, preventDefault: vi.fn(),
  } as unknown as ReactPointerEvent<HTMLElement>;
  const eventFor = (index: number) => ({
    ...event, clientY: starts[index] + 110,
    currentTarget: { getBoundingClientRect: () => ({ left: 32, top: starts[index] + 100, width: 216, height: 32 }) },
  } as unknown as ReactPointerEvent<HTMLElement>);
  const click = () => ({ detail: 1, preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as ReactMouseEvent);
  return { hook, options, onMove, event, eventFor, element, sections, click };
}

beforeEach(() => {
  harness.state = null;
  harness.cleanups = [];
  harness.effects = [];
  frames = new Map();
  windowEvents = new EventTarget();
  documentEvents = Object.assign(new EventTarget(), { visibilityState: 'visible', body: { classList: { add: vi.fn(), remove: vi.fn() } } });
  vi.stubGlobal('window', windowEvents);
  vi.stubGlobal('document', documentEvents);
  let id = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (key: number) => frames.delete(key));
});
afterEach(() => {
  harness.cleanups.forEach((cleanup) => cleanup());
  vi.unstubAllGlobals();
});

describe('sidebar pointer sorting', () => {
  it('keeps clicks and motion below 4px available for folding the project', () => {
    const test = fixture();
    test.hook.startDrag(test.event, '/a');
    emit('pointermove', { pointerId: 1, clientX: 50, clientY: 153 });
    emit('pointerup', { pointerId: 1, clientX: 50, clientY: 153 });
    const click = test.click();
    test.hook.onClickCapture(click);
    expect(click.preventDefault).not.toHaveBeenCalled();
    expect(test.event.preventDefault).not.toHaveBeenCalled();
    expect(preview()).toBeNull();
    expect(test.onMove).not.toHaveBeenCalled();
    expect(documentEvents.body.classList.add).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });

  it('lifts a compact heading and lets expanded projects move aside at their heading midpoint', () => {
    const test = fixture();
    test.hook.startDrag(test.event, '/a');
    // B is 200px tall. Its heading center is at y=220; its whole-block center is y=304.
    emit('pointermove', { pointerId: 1, clientX: 50, clientY: 235 });
    expect(preview()).toMatchObject({ cwd: '/a', target: 1, left: 32, top: 225, width: 216, height: 32, offsets: [200, -64, 0] });
    const before = preview();
    nextFrame(100);
    nextFrame(116);
    expect(preview()).toBe(before);
    expect(test.onMove).not.toHaveBeenCalled();
    emit('pointerup', { pointerId: 1, clientX: 50, clientY: 235 });
    emit('pointerup', { pointerId: 1, clientX: 50, clientY: 235 });
    expect(test.onMove).toHaveBeenCalledExactlyOnceWith('/a', 1);
    expect(preview()).toBeNull();
    expect(frames.size).toBe(0);
  });

  it('remeasures at release and suppresses only the compatibility click from that gesture', () => {
    const test = fixture();
    test.hook.startDrag(test.event, '/a');
    emit('pointermove', { pointerId: 1, clientX: 50, clientY: 235 });
    emit('pointerup', { pointerId: 1, clientX: 50, clientY: 435 });
    expect(test.onMove).toHaveBeenCalledExactlyOnceWith('/a', 2);
    const compatibility = test.click();
    test.hook.onClickCapture(compatibility);
    expect(compatibility.preventDefault).toHaveBeenCalledOnce();
    test.hook.onPointerDownCapture();
    const next = test.click();
    test.hook.onClickCapture(next);
    expect(next.preventDefault).not.toHaveBeenCalled();
  });

  it('ignores secondary pointers without releasing the active drag', () => {
    const test = fixture();
    test.hook.startDrag(test.event, '/a');
    emit('pointermove', { pointerId: 2, clientX: 50, clientY: 235 });
    expect(preview()).toBeNull();
    emit('pointermove', { pointerId: 1, clientX: 50, clientY: 235 });
    emit('pointerup', { pointerId: 2, clientX: 50, clientY: 435 });
    emit('pointercancel', { pointerId: 2 });
    expect(preview()?.target).toBe(1);
    emit('pointerup', { pointerId: 1, clientX: 50, clientY: 235 });
    expect(test.onMove).toHaveBeenCalledExactlyOnceWith('/a', 1);
  });

  it.each(['blur', 'pointercancel', 'escape', 'hidden', 'outside', 'unmount', 'changed'])('cancels on %s and restores the preview without saving', (reason) => {
    const test = fixture();
    test.hook.startDrag(test.event, '/a');
    emit('pointermove', { pointerId: 1, clientX: 50, clientY: 235 });
    if (reason === 'escape') emit('keydown', { key: 'Escape' });
    else if (reason === 'hidden') { documentEvents.visibilityState = 'hidden'; documentEvents.dispatchEvent(new Event('visibilitychange')); }
    else if (reason === 'outside') emit('pointerup', { pointerId: 1, clientX: 500, clientY: 235 });
    else if (reason === 'unmount') harness.cleanups[0]();
    else if (reason === 'changed') { test.options.version = 'changed'; nextFrame(100); }
    else emit(reason, { pointerId: 1 });
    expect(test.onMove).not.toHaveBeenCalled();
    expect(preview()).toBeNull();
    expect(documentEvents.body.classList.remove).toHaveBeenCalledWith('sidebar-dragging');
    expect(frames.size).toBe(0);
    emit('pointerup', { pointerId: 1, clientX: 50, clientY: 435 });
    expect(test.onMove).not.toHaveBeenCalled();
  });

  it('does not start from the fixed conversation group, a new-task action or a disabled view', () => {
    const test = fixture([CONVERSATION_CWD, '/a', '/b']);
    test.hook.startDrag(test.event, CONVERSATION_CWD);
    emit('pointermove', { pointerId: 1, clientX: 50, clientY: 235 });
    expect(preview()).toBeNull();
    test.options.disabled = true;
    test.hook.startDrag(test.event, '/a');
    emit('pointermove', { pointerId: 1, clientX: 50, clientY: 235 });
    expect(preview()).toBeNull();
    test.options.disabled = false;
    const action = { ...test.event, target: { closest: () => ({}) } } as unknown as ReactPointerEvent<HTMLElement>;
    test.hook.startDrag(action, '/a');
    emit('pointermove', { pointerId: 1, clientX: 50, clientY: 235 });
    expect(preview()).toBeNull();
    expect(test.onMove).not.toHaveBeenCalled();
  });

  it('keeps the preview and final move inside the project pin tier', () => {
    const test = fixture(['/pinned', '/a', '/b'], ['/pinned']);
    test.hook.startDrag(test.event, '/pinned');
    emit('pointermove', { pointerId: 1, clientX: 50, clientY: 435 });
    expect(preview()).toBeNull();
    test.hook.startDrag(test.eventFor(2), '/b');
    emit('pointermove', { pointerId: 1, clientX: 50, clientY: 140 });
    expect(preview()?.target).toBe(1);
    emit('pointerup', { pointerId: 1, clientX: 50, clientY: 140 });
    expect(test.onMove).toHaveBeenCalledExactlyOnceWith('/b', 1);
  });

  it('scrolls at the queue cadence and updates the target while the pointer stays near the edge', () => {
    const test = fixture();
    test.hook.startDrag(test.event, '/a');
    emit('pointermove', { pointerId: 1, clientX: 50, clientY: 490 });
    nextFrame(100);
    const start = test.element.scrollTop;
    // Pointer events can have a later timestamp than the next frame's animation timestamp.
    emit('pointermove', { pointerId: 1, clientX: 50, clientY: 490 });
    expect(test.element.scrollTop).toBe(start);
    nextFrame(116);
    expect(test.element.scrollTop - start).toBeCloseTo(3.36);
    expect(preview()?.target).toBe(2);
    emit('pointermove', { pointerId: 1, clientX: 500, clientY: 490 });
    const outside = test.element.scrollTop;
    nextFrame(132);
    expect(test.element.scrollTop).toBe(outside);
  });
});
