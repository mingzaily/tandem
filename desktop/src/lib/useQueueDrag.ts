import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { reorderQueuedTurn, setQueueLock, type QueuedMessage, type TaskQueue } from './api';
import { queueDragTransaction, queueDropTarget, queueInsertionIndex, queueScrollStep, type QueueRowBounds } from './pendingQueue';

export interface QueueDrag {
  entry: QueuedMessage;
  from: number;
  target: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Options {
  queue: TaskQueue;
  editingId?: string;
  scroller: RefObject<HTMLDivElement | null>;
  measurements: () => readonly QueueRowBounds[];
  onExpand: () => void;
  onChange: (queue: TaskQueue) => void;
  onMoved: (index: number) => void;
  onError: (error: unknown) => void;
}

/** React owns the row preview and floating copy; the backend only receives the final move. */
export function useQueueDrag(options: Options) {
  const [drag, setDrag] = useState<QueueDrag | null>(null);
  const [sorting, setSorting] = useState(false);
  const latest = useRef(options);
  latest.current = options;
  const cancel = useRef<(() => void) | null>(null);
  useEffect(() => () => cancel.current?.(), []);
  useEffect(() => { cancel.current?.(); }, [options.queue.taskId, options.queue.revision, options.editingId]);

  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>, entry: QueuedMessage, index: number) => {
    const { queue, editingId, scroller, onError } = latest.current;
    if (event.button !== 0 || queue.entries.length < 2 || editingId || sorting || cancel.current) return;
    const row = event.currentTarget.closest<HTMLElement>('[data-queue-entry]');
    if (!row || !scroller.current) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    const bounds = row.getBoundingClientRect();
    const startY = event.clientY;
    const grabOffset = startY - bounds.top;
    const pointerId = event.pointerId;
    // The virtualized row may leave the DOM; the stable list owns the complete gesture.
    const pointerSurface = scroller.current;
    pointerSurface.setPointerCapture(pointerId);
    let x = event.clientX;
    let y = startY;
    let target = index;
    let active = false;
    let closed = false;
    let frame = 0;
    let lastTime = 0;
    const owner = `drag-${crypto.randomUUID()}`;
    // Hold dispatch from pointer-down so a finishing turn cannot remove the row while we activate.
    const acquired = setQueueLock(queue.taskId, owner, null, true);
    const transaction = queueDragTransaction(acquired, () => setQueueLock(queue.taskId, owner, null, false));
    let ready = false;
    const measure = (now: number) => {
      if (closed || !ready) return;
      const element = scroller.current;
      if (!element) { finish(false); return; }
      if (!active) {
        if (Math.abs(y - startY) < 4) return;
        active = true;
        setSorting(true);
        document.body.classList.add('pending-queue-dragging');
        latest.current.onExpand();
      }
      const rect = element.getBoundingClientRect();
      if (lastTime) element.scrollTop += queueScrollStep(y, rect.top, rect.bottom, now - lastTime);
      lastTime = now;
      const positions = latest.current.measurements();
      const insertion = queueInsertionIndex(positions, y - rect.top + element.scrollTop);
      target = queueDropTarget(queue.entries.length, index, insertion);
      setDrag({ entry, from: index, target, left: bounds.left, top: y - grabOffset, width: bounds.width, height: bounds.height });
      frame = requestAnimationFrame(measure);
    };
    const finish = (apply: boolean) => {
      if (closed) return;
      closed = true;
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', pointerCancel);
      pointerSurface.removeEventListener('lostpointercapture', pointerCancel);
      window.removeEventListener('blur', stop);
      window.removeEventListener('keydown', key);
      document.removeEventListener('visibilitychange', hidden);
      document.body.classList.remove('pending-queue-dragging');
      if (pointerSurface.hasPointerCapture(pointerId)) pointerSurface.releasePointerCapture(pointerId);
      cancel.current = null;
      const commit = apply && active && target !== index ? async () => {
        latest.current.onChange(await reorderQueuedTurn(queue.taskId, entry.id, target));
        latest.current.onMoved(target);
        setDrag(null);
      } : undefined;
      if (!commit) setDrag(null);
      setSorting(true);
      void transaction(commit).catch(onError).finally(() => { setDrag(null); setSorting(false); });
    };
    const move = (moved: PointerEvent) => {
      if (moved.pointerId !== pointerId) return;
      x = moved.clientX;
      y = moved.clientY;
      if (!active && ready) measure(performance.now());
    };
    const up = (released: PointerEvent) => {
      if (released.pointerId !== pointerId) return;
      x = released.clientX;
      y = released.clientY;
      const rect = scroller.current?.getBoundingClientRect();
      const inside = Boolean(rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom);
      if (inside && active && rect && scroller.current) {
        const insertion = queueInsertionIndex(latest.current.measurements(), y - rect.top + scroller.current.scrollTop);
        target = queueDropTarget(queue.entries.length, index, insertion);
      }
      finish(inside);
    };
    const stop = () => finish(false);
    const pointerCancel = (event: PointerEvent) => { if (event.pointerId === pointerId) finish(false); };
    const key = (pressed: KeyboardEvent) => { if (pressed.key === 'Escape') { pressed.preventDefault(); finish(false); } };
    const hidden = () => { if (document.visibilityState === 'hidden') finish(false); };
    cancel.current = stop;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', pointerCancel);
    pointerSurface.addEventListener('lostpointercapture', pointerCancel);
    window.addEventListener('blur', stop);
    window.addEventListener('keydown', key);
    document.addEventListener('visibilitychange', hidden);
    void acquired.then(() => { ready = true; if (!closed) measure(performance.now()); }).catch(() => finish(false));
  };

  return { drag, sorting, startDrag };
}
