import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';

const memory = new Map<string, number>();
export const MAX_COMPOSER_HEIGHT = 420;

export function composerHeightRange(minimum: number, available: number) {
  return { min: minimum, max: Math.max(minimum, Math.min(MAX_COMPOSER_HEIGHT, Math.floor(available / 2))) };
}
export const clampComposerHeight = (height: number, range: { min: number; max: number }) => Math.max(range.min, Math.min(range.max, height));

/** Height belongs to this draft; resize cancellation restores the pre-gesture height. */
export function useComposerResize(input: RefObject<HTMLDivElement | null>, draftKey: string, variant: 'task' | 'new') {
  const [height, setHeight] = useState<number | null>(() => memory.get(draftKey) ?? null);
  const [range, setRange] = useState(() => composerHeightRange(variant === 'new' ? 138 : 110, 840));
  const current = useRef({ height, range });
  current.current = { height, range };
  const drag = useRef<{ pointerId: number; y: number; start: number; previous: number | null } | null>(null);
  const measure = () => {
    const element = input.current;
    if (!element) return;
    const area = element.closest('.conversation-layout') ?? element.closest('main');
    const chrome = [...element.children].filter((child) => !(child as HTMLElement).hasAttribute('data-composer-editor'))
      .reduce((total, child) => total + (child as HTMLElement).offsetHeight, 0);
    const bounds = composerHeightRange(Math.max(variant === 'new' ? 138 : 110, chrome + 52), area?.clientHeight ?? window.innerHeight);
    setRange((old) => old.min === bounds.min && old.max === bounds.max ? old : bounds);
    setHeight((old) => old === null ? old : clampComposerHeight(old, bounds));
  };
  useLayoutEffect(measure);
  useEffect(() => {
    const element = input.current;
    const area = element?.closest('.conversation-layout') ?? element?.closest('main');
    const observer = new ResizeObserver(measure);
    if (area) observer.observe(area);
    const cancel = () => {
      if (!drag.current) return;
      setHeight(drag.current.previous);
      drag.current = null;
      document.body.classList.remove('composer-resizing');
    };
    const move = (event: PointerEvent) => {
      const active = drag.current;
      if (!active || active.pointerId !== event.pointerId) return;
      event.preventDefault();
      setHeight(clampComposerHeight(active.start + active.y - event.clientY, current.current.range));
    };
    const finish = (event: PointerEvent) => {
      const active = drag.current;
      if (!active || active.pointerId !== event.pointerId) return;
      const next = clampComposerHeight(active.start + active.y - event.clientY, current.current.range);
      drag.current = null;
      setHeight(next);
      memory.set(draftKey, next);
      document.body.classList.remove('composer-resizing');
    };
    const cancelPointer = (event: PointerEvent) => { if (drag.current?.pointerId === event.pointerId) cancel(); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && drag.current) { event.preventDefault(); event.stopPropagation(); cancel(); } };
    const hidden = () => { if (document.visibilityState !== 'visible') cancel(); };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', cancelPointer);
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', key, true);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      observer.disconnect();
      drag.current = null;
      document.body.classList.remove('composer-resizing');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', cancelPointer);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', key, true);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [draftKey, variant]);
  const resize = (next: number | null) => {
    const value = next === null ? null : clampComposerHeight(next, current.current.range);
    setHeight(value);
    if (value === null) memory.delete(draftKey);
    else memory.set(draftKey, value);
  };
  return {
    height, range,
    start(event: ReactPointerEvent<HTMLDivElement>) {
      if (event.button !== 0 || drag.current || !input.current) return;
      event.preventDefault();
      drag.current = { pointerId: event.pointerId, y: event.clientY, start: input.current.offsetHeight, previous: current.current.height };
      document.body.classList.add('composer-resizing');
    },
    resize,
  };
}
