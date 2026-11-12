import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { listDropTarget, listInsertionIndex, listPreviewStart, listScrollStep } from './listDrag';
import { projectMoveRange } from './sidebarModel';

export interface SidebarDrag {
  cwd: string;
  target: number;
  left: number;
  top: number;
  width: number;
  height: number;
  offsets: number[];
}

interface Options {
  ids: string[];
  pinned: string[];
  scroller: RefObject<HTMLElement | null>;
  disabled: boolean;
  /** Order and navigation changes cancel the gesture; streamed task activity keeps it alive. */
  version: string;
  onMove: (cwd: string, target: number) => void;
}

/** The heading follows the pointer; full project blocks preview their final places. */
export function useSidebarDrag(options: Options) {
  const [drag, setDrag] = useState<SidebarDrag | null>(null);
  const latest = useRef(options);
  latest.current = options;
  const cancel = useRef<(() => void) | null>(null);
  const suppressClick = useRef(false);
  useEffect(() => () => cancel.current?.(), []);
  useEffect(() => { cancel.current?.(); }, [options.version, options.disabled]);

  const startDrag = (event: ReactPointerEvent<HTMLElement>, cwd: string) => {
    const { ids, pinned, scroller, disabled, version } = latest.current;
    const range = projectMoveRange(ids, pinned, cwd);
    if (event.button !== 0 || disabled || cancel.current || !range || range.min === range.max) return;
    if ((event.target as HTMLElement).closest('[data-no-drag], input, textarea, select, a')) return;
    const element = scroller.current;
    if (!element) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const pointerId = event.pointerId;
    const startY = event.clientY;
    const grabOffset = startY - bounds.top;
    const from = ids.indexOf(cwd);
    let x = event.clientX;
    let y = startY;
    let target = from;
    let active = false;
    let closed = false;
    let frame = 0;
    let lastTime = 0;

    const measure = (now: number, autoScroll = true) => {
      if (closed) return;
      if (latest.current.version !== version || latest.current.disabled) { finish(false); return; }
      const rect = element.getBoundingClientRect();
      if (autoScroll) {
        if (lastTime && x >= rect.left && x <= rect.right) element.scrollTop += listScrollStep(y, rect.top, rect.bottom, now - lastTime);
        lastTime = now;
      }
      const sections = [...element.querySelectorAll<HTMLElement>('[data-project]')];
      // offsetTop is the layout position: preview transforms never move a drop threshold.
      const rows = sections.map((section) => ({ start: section.offsetTop, end: section.offsetTop + section.offsetHeight }));
      const headings = rows.map((row, index) => ({ start: row.start, end: row.start + (sections[index].querySelector<HTMLElement>('[data-project-header]')?.offsetHeight ?? bounds.height) }));
      const insertion = listInsertionIndex(headings, y - rect.top + element.scrollTop);
      target = Math.max(range.min, Math.min(range.max, listDropTarget(ids.length, from, insertion)));
      const offsets = rows.map((row, index) => listPreviewStart(rows, index, from, target) - row.start);
      const top = y - grabOffset;
      setDrag((current) => current && current.top === top && current.target === target && current.offsets.length === offsets.length && offsets.every((offset, index) => offset === current.offsets[index])
        ? current : { cwd, target, left: bounds.left, top, width: bounds.width, height: bounds.height, offsets });
    };
    const tick = (now: number) => {
      measure(now);
      if (!closed) frame = requestAnimationFrame(tick);
    };
    const finish = (apply: boolean) => {
      if (closed) return;
      closed = true;
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', pointerCancel);
      window.removeEventListener('blur', stop);
      window.removeEventListener('keydown', key);
      document.removeEventListener('visibilitychange', hidden);
      document.body.classList.remove('sidebar-dragging');
      cancel.current = null;
      setDrag(null);
      if (apply && active && target !== from && latest.current.version === version && !latest.current.disabled) latest.current.onMove(cwd, target);
    };
    const move = (moved: PointerEvent) => {
      if (moved.pointerId !== pointerId) return;
      x = moved.clientX;
      y = moved.clientY;
      if (!active && Math.abs(y - startY) < 4) return;
      moved.preventDefault();
      if (!active) {
        active = true;
        suppressClick.current = true;
        document.body.classList.add('sidebar-dragging');
        frame = requestAnimationFrame(tick);
      }
      measure(performance.now(), false);
    };
    const up = (released: PointerEvent) => {
      if (released.pointerId !== pointerId) return;
      x = released.clientX;
      y = released.clientY;
      const rect = element.getBoundingClientRect();
      const inside = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
      if (active) measure(performance.now(), false);
      finish(inside);
    };
    const stop = () => finish(false);
    const pointerCancel = (event: PointerEvent) => { if (event.pointerId === pointerId) finish(false); };
    const key = (pressed: KeyboardEvent) => { if (pressed.key === 'Escape') { pressed.preventDefault(); finish(false); } };
    const hidden = () => { if (document.visibilityState === 'hidden') finish(false); };
    cancel.current = stop;
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', pointerCancel);
    window.addEventListener('blur', stop);
    window.addEventListener('keydown', key);
    document.addEventListener('visibilitychange', hidden);
  };

  return {
    drag, startDrag,
    onPointerDownCapture: () => { if (!cancel.current) suppressClick.current = false; },
    onClickCapture: (event: ReactMouseEvent) => {
      if (suppressClick.current && event.detail > 0) { event.preventDefault(); event.stopPropagation(); }
    },
  };
}
