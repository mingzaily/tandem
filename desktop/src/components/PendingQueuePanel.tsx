import { useVirtualizer } from '@tanstack/react-virtual';
import { createPortal } from 'react-dom';
import { ArrowUp, ChevronDown, ChevronUp, GripVertical, ListEnd, Paperclip, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { removeQueuedTurn, reorderQueuedTurn, type QueuedMessage, type TaskQueue } from '../lib/api';
import { t } from '../lib/i18n';
import { QUEUE_ROW_ESTIMATE, queuePreviewStart, queueKeyboardTarget, visibleQueueCount } from '../lib/pendingQueue';
import { useQueueDrag } from '../lib/useQueueDrag';
import { isImeKey } from '../lib/ime';

const ICON_BUTTON = 'flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full border border-[var(--chat-input-border)] bg-[var(--chat-input-bg)] text-[var(--settings-section-desc)] enabled:hover:text-[var(--msg-assistant-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:cursor-default disabled:opacity-30';

interface Props {
  queue: TaskQueue;
  editingId?: string;
  onEdit: (entry: QueuedMessage) => void;
  onChange: (queue: TaskQueue) => void;
  onError: (error: unknown) => void;
  /** Whether a turn is running that a message can be added to. */
  running: boolean;
  /** The reference's row 插话: into the running turn, or first in line and resumed when idle. */
  onSteer: (entry: QueuedMessage) => void;
}

export function PendingQueuePanel({ queue, editingId, onEdit, onChange, onError, running, onSteer }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [queueHovered, setQueueHovered] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const focusAfterMove = useRef<{ id: string; index: number } | null>(null);
  const shown = visibleQueueCount(queue.entries.length, expanded);
  const rows = useVirtualizer({ count: shown, getScrollElement: () => scroller.current, getItemKey: (index) => queue.entries[index].id, estimateSize: () => QUEUE_ROW_ESTIMATE, paddingStart: 6, overscan: 3 });

  const { drag, sorting, startDrag } = useQueueDrag({ queue, editingId, scroller, measurements: () => rows.measurementsCache,
    onExpand: () => setExpanded(true), onChange, onError,
    onMoved: (index) => setAnnouncement(t('queuePosition', { index: String(index + 1) })),
  });
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

  const dragPreview = drag?.entry.attachments.find(({ preview }) => preview)?.preview;

  return (
    <>
    <section aria-label={t('queueRegion')} onMouseEnter={() => setQueueHovered(true)} onMouseLeave={() => { setQueueHovered(false); setHoveredId(null); }}
      className="w-full cursor-default overflow-hidden border-b border-[var(--chat-input-border)]">
      <div ref={scroller} role="list" aria-label={t('queueRegion')} className="pending-queue-scroll max-h-[196px] overflow-y-auto overscroll-contain px-1 pb-1.5 [scrollbar-gutter:stable]">
        <div className="relative w-full" style={{ height: rows.getTotalSize() }}>
          {rows.getVirtualItems().map((row) => {
            const entry = queue.entries[row.index];
            const editing = entry.id === editingId;
            const active = entry.id === hoveredId || entry.id === focusedId;
            const dragging = entry.id === drag?.entry.id;
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
                className={`pending-queue-row absolute left-0 top-0 flex min-h-[32px] w-full items-center gap-1.5 rounded-[8px] py-0.5 ${drag ? 'transition-transform duration-[var(--motion-fast)] motion-reduce:transition-none' : ''} ${active || editing ? 'bg-[var(--chat-input-chip-bg)]' : ''} ${dragging ? 'opacity-30' : ''}`}
                style={{ transform: `translateY(${drag ? queuePreviewStart(rows.measurementsCache, row.index, drag.from, drag.target) : row.start}px)` }}>
                <button type="button" disabled={editing || sorting || Boolean(editingId) || queue.entries.length < 2} aria-label={t('queueDrag', { index: String(row.index + 1) })} data-tooltip={t('queueDragHint')}
                  aria-keyshortcuts="ArrowUp ArrowDown Home End" onPointerDown={(event) => startDrag(event, entry, row.index)}
                  onKeyDown={(event) => {
                    const target = queueKeyboardTarget(queue.entries.length, row.index, event.key);
                    if (target === null || isImeKey(event)) return;
                    event.preventDefault();
                    if (target !== row.index) {
                      focusAfterMove.current = { id: entry.id, index: target };
                      if (target >= shown) setExpanded(true);
                      void move(entry, target);
                    }
                  }}
                  className="group/handle pending-queue-leading absolute flex size-5 touch-none select-none appearance-none items-center justify-center rounded-[6px] border-0 bg-transparent p-0 text-[var(--cmd-palette-item-meta)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] enabled:cursor-grab enabled:active:cursor-grabbing disabled:cursor-default">
                  <ListEnd size={13} strokeWidth={1.8} aria-hidden className={`absolute ${active && !editing ? 'opacity-0' : 'opacity-60'} group-focus-visible/handle:opacity-0`} />
                  <GripVertical size={12} strokeWidth={2} aria-hidden className={`absolute ${active && !editing ? 'opacity-100' : 'opacity-0'} group-focus-visible/handle:opacity-100`} />
                </button>
                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                  <p data-tooltip={title} className={`min-w-0 truncate text-13 leading-5 ${active ? 'text-[var(--msg-assistant-text)]' : 'text-[var(--settings-section-desc)]'}`}>
                    {entry.prompt || t('attachmentsOnly')}
                  </p>
                  {entry.attachments.length > 0 ? <span data-tooltip={entry.attachments.map(({ name }) => name).join('\n')} className="flex shrink-0 items-center gap-1 text-12 leading-none text-[var(--cmd-palette-item-meta)]">
                    {preview ? <img src={preview} alt="" className="size-[18px] rounded border border-[var(--chat-input-chip-border)] object-cover" /> : null}
                    <span className="flex items-center gap-0.5"><Paperclip size={11} aria-hidden />{entry.attachments.length}</span>
                  </span> : null}
                </div>
                <div className={`flex w-[68px] shrink-0 items-center justify-end gap-1 transition-opacity ${editing ? 'pointer-events-none opacity-0' : `${controlsOpacity} ${controlsVisible ? '' : 'pointer-events-none'}`}`}>
                  <button type="button" aria-label={t('queueSteer', { index: String(row.index + 1) })} data-tooltip={t(running ? 'queueSteerRunningTip' : 'queueSteerPausedTip')} disabled={editing || sorting} onClick={() => onSteer(entry)} className={ICON_BUTTON}><ArrowUp size={12} strokeWidth={2.25} aria-hidden /></button>
                  <button type="button" aria-label={t('queueEdit', { index: String(row.index + 1) })} data-tooltip={t('queueEditing')} disabled={Boolean(editingId) || sorting} onClick={() => { setHoveredId(null); setFocusedId(null); onEdit(entry); }} className={`${ICON_BUTTON} ${editingId ? 'invisible' : ''}`}><Pencil size={11} strokeWidth={2.25} aria-hidden /></button>
                  <button type="button" aria-label={t('queueRemove', { index: String(row.index + 1) })} data-tooltip={t('queueRemove', { index: String(row.index + 1) })} disabled={editing || sorting} onClick={() => void removeQueuedTurn(queue.taskId, entry.id).then(onChange).catch(onError)} className={ICON_BUTTON}><Trash2 size={11} strokeWidth={2.25} aria-hidden /></button>
                </div>
              </div>
            );
          })}
        </div>
        {queue.entries.length > 4 ? (
          <div role="listitem" className="pending-queue-more flex h-8 items-center text-12">
            <button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} className="flex h-5 cursor-pointer items-center gap-1 rounded-full text-[var(--cmd-palette-item-meta)] hover:text-[var(--msg-assistant-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]">
              {expanded ? t('queueLess') : t('queueMore', { count: String(queue.entries.length - shown) })}
              {expanded ? <ChevronUp size={13} aria-hidden /> : <ChevronDown size={13} aria-hidden />}
            </button>
          </div>
        ) : null}
      </div>
      <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
    </section>
    {drag ? createPortal(
      <div aria-hidden className="pending-queue-row pointer-events-none fixed z-50 flex items-center gap-1.5 rounded-[8px] bg-[var(--chat-input-chip-bg)] text-[var(--msg-assistant-text)] shadow-[shadow:var(--shadow-menu)] ring-1 ring-inset ring-[var(--chat-input-chip-border)]"
        style={{ left: drag.left, top: drag.top, width: drag.width, height: drag.height }}>
        <span className="pending-queue-leading absolute flex size-5 items-center justify-center"><GripVertical size={12} aria-hidden /></span>
        <span className="min-w-0 flex-1 truncate text-13 leading-5">{drag.entry.prompt || t('attachmentsOnly')}</span>
        {dragPreview ? <img src={dragPreview} alt="" className="size-[18px] shrink-0 rounded object-cover" /> : null}
        <span className="w-[68px] shrink-0" />
      </div>, document.body,
    ) : null}
    </>
  );
}
