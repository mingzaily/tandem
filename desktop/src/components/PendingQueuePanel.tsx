import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowUpToLine, ChevronDown, ChevronUp, GripVertical, Paperclip, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { removeQueuedTurn, reorderQueuedTurn, setQueueLock, type QueuedMessage, type TaskQueue } from '../lib/api';
import { t } from '../lib/i18n';
import { QUEUE_ROW_ESTIMATE, queueDropTarget, queueInsertionIndex, queueKeyboardTarget, visibleQueueCount } from '../lib/pendingQueue';

const ICON_BUTTON = 'flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full border border-[var(--chat-input-border)] bg-[var(--chat-input-bg)] text-[var(--settings-section-desc)] enabled:hover:text-[var(--msg-assistant-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:cursor-default disabled:opacity-30';

interface Props {
  queue: TaskQueue;
  editingId?: string;
  onEdit: (entry: QueuedMessage) => void;
  onChange: (queue: TaskQueue) => void;
  onError: (error: unknown) => void;
}

export function PendingQueuePanel({ queue, editingId, onEdit, onChange, onError }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [drag, setDrag] = useState<{ id: string; insertion: number } | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [queueHovered, setQueueHovered] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const cancelDrag = useRef<(() => void) | null>(null);
  const focusAfterMove = useRef<{ id: string; index: number } | null>(null);
  const shown = visibleQueueCount(queue.entries.length, expanded);
  const rows = useVirtualizer({ count: shown, getScrollElement: () => scroller.current, getItemKey: (index) => queue.entries[index].id, estimateSize: () => QUEUE_ROW_ESTIMATE, paddingStart: 6, overscan: 3 });

  useEffect(() => () => cancelDrag.current?.(), []);
  useEffect(() => {
    const ids = new Set(queue.entries.map(({ id }) => id));
    setHoveredId((id) => id !== null && ids.has(id) ? id : null);
    setFocusedId((id) => id !== null && ids.has(id) ? id : null);
  }, [queue.entries]);
  useEffect(() => {
    const target = focusAfterMove.current;
    if (!target || queue.entries[target.index]?.id !== target.id) return;
    rows.scrollToIndex(target.index, { align: 'auto' });
    const frame = requestAnimationFrame(() => {
      scroller.current?.querySelector<HTMLButtonElement>(`[data-queue-entry="${target.id}"] button`)?.focus();
      focusAfterMove.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [queue.entries, expanded, rows]);

  const move = async (entry: QueuedMessage, target: number) => {
    try {
      onChange(await reorderQueuedTurn(queue.taskId, entry.id, target));
      setAnnouncement(t('queuePosition', { index: String(target + 1) }));
    } catch (error) { focusAfterMove.current = null; onError(error); }
  };

  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>, entry: QueuedMessage, index: number) => {
    if (event.button !== 0 || shown < 2) return;
    event.preventDefault();
    event.currentTarget.focus();
    const owner = `drag-${crypto.randomUUID()}`;
    const locked = setQueueLock(queue.taskId, owner, null, true);
    const startY = event.clientY;
    let y = startY;
    let insertion = index;
    let active = false;
    let closed = false;
    let frame = 0;
    const measure = () => {
      const element = scroller.current;
      if (!element) return;
      const bounds = element.getBoundingClientRect();
      insertion = queueInsertionIndex(rows.measurementsCache, y - bounds.top + element.scrollTop);
      setDrag({ id: entry.id, insertion });
    };
    const scroll = () => {
      const element = scroller.current;
      if (!element) return;
      const bounds = element.getBoundingClientRect();
      if (y < bounds.top + 24) element.scrollTop -= 6;
      else if (y > bounds.bottom - 24) element.scrollTop += 6;
      measure();
      frame = requestAnimationFrame(scroll);
    };
    const finish = (apply: boolean) => {
      if (closed) return;
      closed = true;
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', pointerMove);
      window.removeEventListener('pointerup', pointerUp);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key);
      document.body.style.cursor = '';
      cancelDrag.current = null;
      setDrag(null);
      void locked.then(async () => {
        try {
          if (apply && active) await move(entry, queueDropTarget(queue.entries.length, index, insertion));
        } finally { await setQueueLock(queue.taskId, owner, null, false); }
      }).catch(onError);
    };
    const pointerMove = (moved: PointerEvent) => {
      if (moved.pointerId !== event.pointerId) return;
      y = moved.clientY;
      if (!active && Math.abs(y - startY) < 5) return;
      if (!active) {
        active = true;
        document.body.style.cursor = 'grabbing';
        frame = requestAnimationFrame(scroll);
      }
      measure();
    };
    const pointerUp = (up: PointerEvent) => { if (up.pointerId === event.pointerId) finish(true); };
    const cancel = () => finish(false);
    const key = (pressed: KeyboardEvent) => { if (pressed.key === 'Escape') finish(false); };
    cancelDrag.current = cancel;
    window.addEventListener('pointermove', pointerMove);
    window.addEventListener('pointerup', pointerUp);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key);
    void locked.catch(() => finish(false));
  };

  return (
    <section aria-label={t('queueRegion')} onMouseEnter={() => setQueueHovered(true)} onMouseLeave={() => { setQueueHovered(false); setHoveredId(null); }}
      className="w-full cursor-default overflow-hidden border-b border-[var(--chat-input-border)]">
      <div ref={scroller} role="list" aria-label={t('queueRegion')} className="pending-queue-scroll max-h-[196px] overflow-y-auto overscroll-contain px-1 pb-1.5 [scrollbar-gutter:stable]">
        <div className="relative w-full" style={{ height: rows.getTotalSize() }}>
          {rows.getVirtualItems().map((row) => {
            const entry = queue.entries[row.index];
            const editing = entry.id === editingId;
            const active = entry.id === hoveredId || entry.id === focusedId;
            const dragging = entry.id === drag?.id;
            const controlsVisible = queueHovered || active;
            const controlsOpacity = active ? 'opacity-100' : queueHovered ? 'opacity-40' : 'opacity-0';
            const title = [entry.prompt, ...entry.attachments.map(({ name }) => name)].filter(Boolean).join('\n');
            const preview = entry.attachments.find((attachment) => attachment.preview)?.preview;
            return (
              <div key={entry.id} data-queue-entry={entry.id} data-index={row.index} ref={rows.measureElement} role="listitem"
                onMouseEnter={() => { if (!editingId) setHoveredId(entry.id); }}
                onMouseLeave={() => setHoveredId((id) => id === entry.id ? null : id)}
                onFocusCapture={() => setFocusedId(entry.id)}
                onBlurCapture={(event) => {
                  if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
                  setFocusedId((id) => id === entry.id ? null : id);
                }}
                className={`pending-queue-row absolute left-0 top-0 flex min-h-[32px] w-full items-center gap-1.5 rounded-[8px] border border-transparent py-0.5 ${active || editing ? 'bg-[var(--chat-input-chip-bg)]' : ''} ${dragging ? 'opacity-40' : ''}`}
                style={{ transform: `translateY(${row.start}px)` }}>
                <button type="button" disabled={editing} aria-label={t('queueDrag', { index: String(row.index + 1) })} title={t('queueDragHint')}
                  aria-keyshortcuts="ArrowUp ArrowDown Home End" onPointerDown={(event) => startDrag(event, entry, row.index)}
                  onKeyDown={(event) => {
                    const target = queueKeyboardTarget(queue.entries.length, row.index, event.key);
                    if (target === null || event.nativeEvent.isComposing) return;
                    event.preventDefault();
                    if (target !== row.index) {
                      focusAfterMove.current = { id: entry.id, index: target };
                      if (target >= shown) setExpanded(true);
                      void move(entry, target);
                    }
                  }}
                  className={`absolute -left-px flex h-6 w-4 touch-none select-none appearance-none items-center justify-center rounded-[6px] border-0 bg-transparent p-0 text-[var(--cmd-palette-item-meta)] transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] enabled:cursor-grab enabled:focus:opacity-100 enabled:active:cursor-grabbing disabled:cursor-default ${editing ? 'opacity-0' : controlsOpacity} ${controlsVisible ? '' : 'pointer-events-none'}`}>
                  <GripVertical size={12} strokeWidth={2} aria-hidden />
                </button>
                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                  <p title={title} className={`relative top-px min-w-0 truncate text-13 leading-[1.25] ${active ? 'text-[var(--msg-assistant-text)]' : 'text-[var(--settings-section-desc)]'}`}>
                    {entry.prompt || t('attachmentsOnly')}
                  </p>
                  {entry.attachments.length > 0 ? <span title={entry.attachments.map(({ name }) => name).join('\n')} className="flex shrink-0 items-center gap-1 text-12 leading-none text-[var(--cmd-palette-item-meta)]">
                    {preview ? <img src={preview} alt="" className="size-[18px] rounded border border-[var(--chat-input-chip-border)] object-cover" /> : null}
                    <span className="flex items-center gap-0.5"><Paperclip size={11} aria-hidden />{entry.attachments.length}</span>
                  </span> : null}
                </div>
                <div className={`flex w-[68px] shrink-0 items-center justify-end gap-1 transition-opacity ${editing ? 'pointer-events-none opacity-0' : `${controlsOpacity} ${controlsVisible ? '' : 'pointer-events-none'}`}`}>
                  <button type="button" aria-label={t('queueMoveFirst', { index: String(row.index + 1) })} title={t('queueMoveFirstHint')} disabled={editing || row.index === 0} onClick={() => { focusAfterMove.current = { id: entry.id, index: 0 }; void move(entry, 0); }} className={ICON_BUTTON}><ArrowUpToLine size={12} strokeWidth={2.25} aria-hidden /></button>
                  <button type="button" aria-label={t('queueEdit', { index: String(row.index + 1) })} title={t('queueEditing')} disabled={Boolean(editingId)} onClick={() => { setHoveredId(null); setFocusedId(null); onEdit(entry); }} className={`${ICON_BUTTON} ${editingId ? 'invisible' : ''}`}><Pencil size={11} strokeWidth={2.25} aria-hidden /></button>
                  <button type="button" aria-label={t('queueRemove', { index: String(row.index + 1) })} title={t('queueRemove', { index: String(row.index + 1) })} disabled={editing} onClick={() => void removeQueuedTurn(queue.taskId, entry.id).then(onChange).catch(onError)} className={ICON_BUTTON}><Trash2 size={11} strokeWidth={2.25} aria-hidden /></button>
                </div>
              </div>
            );
          })}
          {drag && drag.insertion !== queue.entries.findIndex(({ id }) => id === drag.id) && drag.insertion !== queue.entries.findIndex(({ id }) => id === drag.id) + 1 ? (
            <div aria-hidden className="pointer-events-none absolute inset-x-2 h-0.5 rounded-full bg-[var(--focus-ring)]" style={{ top: rows.measurementsCache[drag.insertion - 1]?.end ?? 6 }} />
          ) : null}
        </div>
        {queue.entries.length > 4 ? (
          <div role="listitem" className="flex h-8 items-center pl-5 pr-2 text-12">
            <button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} className="flex h-5 cursor-pointer items-center gap-1 rounded-full text-[var(--cmd-palette-item-meta)] hover:text-[var(--msg-assistant-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]">
              {expanded ? t('queueLess') : t('queueMore', { count: String(queue.entries.length - shown) })}
              {expanded ? <ChevronUp size={13} aria-hidden /> : <ChevronDown size={13} aria-hidden />}
            </button>
          </div>
        ) : null}
      </div>
      <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
    </section>
  );
}
