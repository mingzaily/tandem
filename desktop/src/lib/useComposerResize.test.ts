import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { clampComposerHeight, composerHeightRange, useComposerResize } from './useComposerResize';

const hooks = vi.hoisted(() => ({ values: [] as any[], cursor: 0, cleanups: [] as (() => void)[] }));
vi.mock('react', () => ({
  useState: (initial: unknown) => {
    const at = hooks.cursor++;
    if (!(at in hooks.values)) hooks.values[at] = typeof initial === 'function' ? initial() : initial;
    return [hooks.values[at], (next: any) => { hooks.values[at] = typeof next === 'function' ? next(hooks.values[at]) : next; }];
  },
  useRef: (initial: unknown) => hooks.values[hooks.cursor++] ??= { current: initial },
  useLayoutEffect: () => {},
  useEffect: (effect: () => void | (() => void)) => {
    const at = hooks.cursor++;
    if (hooks.values[at]) return;
    hooks.values[at] = true;
    const cleanup = effect();
    if (cleanup) hooks.cleanups.push(cleanup);
  },
}));
let windowEvents: EventTarget;
let documentEvents: EventTarget & { visibilityState: string; body: { classList: { add: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> } } };
let fixtureId = 0;
let resizeObserver: () => void;
beforeEach(() => {
  hooks.values = []; hooks.cursor = 0; hooks.cleanups = [];
  windowEvents = new EventTarget();
  documentEvents = Object.assign(new EventTarget(), { visibilityState: 'visible', body: { classList: { add: vi.fn(), remove: vi.fn() } } });
  vi.stubGlobal('window', windowEvents); vi.stubGlobal('document', documentEvents);
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resizeObserver = callback; } observe() {} disconnect() {} });
});
afterEach(() => { hooks.cleanups.forEach((cleanup) => cleanup()); vi.unstubAllGlobals(); });
function fixture() {
  const area = { clientHeight: 1000 };
  const element = { offsetHeight: 110, closest: () => area, children: [{ offsetHeight: 52, hasAttribute: () => true }, { offsetHeight: 38, hasAttribute: () => false }] } as unknown as HTMLDivElement;
  const ref = { current: element };
  const id = `resize-${++fixtureId}`;
  const render = () => { hooks.cursor = 0; return useComposerResize(ref, id, 'task'); };
  const start = () => render().start({ button: 0, pointerId: 1, clientY: 500, preventDefault: vi.fn() } as unknown as ReactPointerEvent<HTMLDivElement>);
  const emit = (type: string, data: Record<string, unknown> = {}) => windowEvents.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { pointerId: 1, clientY: 500, ...data }));
  return { render, start, emit, area };
}
describe('input height resizing', () => {
  it('preserves the default minimum and caps expansion at half the view or 420px', () => {
    expect(composerHeightRange(110, 1000)).toEqual({ min: 110, max: 420 });
    expect(composerHeightRange(110, 600)).toEqual({ min: 110, max: 300 });
    expect(composerHeightRange(138, 200)).toEqual({ min: 138, max: 138 });
    expect(clampComposerHeight(90, composerHeightRange(110, 900))).toBe(110);
  });
  it('clamps a manually expanded input when the window becomes shorter', () => {
    const test = fixture();
    test.render().resize(420);
    test.render();
    test.area.clientHeight = 500;
    resizeObserver();
    expect(test.render().range.max).toBe(250);
    expect(test.render().height).toBe(250);
  });
  it('expands upwards and accepts only the pointer that started the drag', () => {
    const test = fixture(); test.start();
    test.emit('pointermove', { pointerId: 2, clientY: 350 });
    expect(test.render().height).toBeNull();
    test.emit('pointermove', { clientY: 350 });
    expect(test.render().height).toBe(260);
    test.emit('pointerup', { pointerId: 2, clientY: 300 });
    test.emit('pointerup', { clientY: -500 });
    expect(test.render().height).toBe(420);
    test.render().resize(null);
    expect(test.render().height).toBeNull();
  });
  it.each(['blur', 'pointercancel', 'escape', 'hidden'])('restores the original height after %s', (reason) => {
    const test = fixture(); test.render().resize(180); test.start();
    test.emit('pointermove', { clientY: 350 });
    expect(test.render().height).toBe(260);
    if (reason === 'escape') test.emit('keydown', { key: 'Escape' });
    else if (reason === 'hidden') { documentEvents.visibilityState = 'hidden'; documentEvents.dispatchEvent(new Event('visibilitychange')); }
    else test.emit(reason);
    expect(test.render().height).toBe(180);
    test.emit('pointerup', { clientY: 300 });
    expect(test.render().height).toBe(180);
    expect(documentEvents.body.classList.remove).toHaveBeenCalledWith('composer-resizing');
  });
});
