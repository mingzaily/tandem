import { useVirtualizer } from '@tanstack/react-virtual';
import { Check, ChevronDown, ChevronRight, CirclePause, FileText, Layers, Loader2, Sparkles, X } from 'lucide-react';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { t } from '../lib/i18n';
import type { Item, TextItem, ToolItem, WorkGroup } from '../lib/items';
import { buildMessageRows } from '../lib/fileChanges';
import { describeTool, explorationSummary, formatDuration } from '../lib/tools';
import { ZoomableImage } from './ImageLightbox';
import { Markdown } from './Markdown';
import { FileChangeSummary } from './FileChangeSummary';

const BOTTOM_THRESHOLD_PX = 48;
const ESTIMATED_ROW_PX = 40;
const ACTIVITY_ROW =
  'group flex w-full items-center gap-1.5 rounded-[8px] px-2 py-[3px] text-left outline-none select-none cursor-pointer transition-colors duration-[var(--motion-fast)] ease-[var(--motion-ease-out)] hover:bg-[var(--msg-code-inline-bg)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] motion-reduce:transition-none';
const CHEVRON_SLOT =
  'ml-auto flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[8px] text-[var(--msg-tool-card-chevron)] transition-colors duration-[var(--motion-fast)] group-hover:bg-[var(--cmd-palette-item-hover)]';

type Toggle = (id: string) => void;

interface MessageStreamProps {
  items: Item[];
  isRunning: boolean;
  /** A long task takes a moment to read, and is not empty in the meantime. */
  isLoading: boolean;
  cwd: string | null;
  /** Includes the composer's gradient, status, queue, input and footer. */
  bottomPadding: number;
}

export default function MessageStream({ items, isRunning, isLoading, cwd, bottomPadding }: MessageStreamProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const followBottom = useRef(true);
  const rows = useMemo(() => buildMessageRows(items, isRunning, cwd), [items, isRunning, cwd]);
  // Expansion lives here because rows unmount when they scroll out of view.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ESTIMATED_ROW_PX,
    getItemKey: (index) => rows[index].id,
    overscan: 8,
    paddingEnd: bottomPadding,
    scrollPaddingEnd: bottomPadding,
  });
  const totalSize = virtualizer.getTotalSize();

  useLayoutEffect(() => {
    if (followBottom.current && rows.length > 0) {
      virtualizer.scrollToIndex(rows.length - 1, { align: 'end' });
    }
  }, [rows, totalSize, virtualizer]);

  const toggle = useCallback((id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  if (rows.length === 0) {
    if (isLoading) return null;
    return (
      <div className="flex h-full items-center justify-center text-14 text-[var(--text-secondary)]">
        {t('empty')}
      </div>
    );
  }

  return (
    <div
      ref={scroller}
      className="message-scroll h-full overflow-y-auto"
      onScroll={(event) => {
        const element = event.currentTarget;
        followBottom.current =
          element.scrollHeight - element.scrollTop - element.clientHeight < BOTTOM_THRESHOLD_PX;
      }}
    >
      <div className="relative w-full" style={{ height: totalSize }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const row = rows[virtualRow.index];
          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              className="absolute left-0 top-0 w-full"
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              <div
                className={`message-column ${
                  row.type === 'user' ? 'pb-2 pt-5' : 'py-1'
                }`}
              >
                {row.type === 'changes' ? (
                  <FileChangeSummary summary={row} cwd={cwd} expanded={expanded.has(row.id)} onToggle={() => toggle(row.id)} />
                ) : row.type === 'group' ? (
                  <Group group={row} expanded={expanded} onToggle={toggle} />
                ) : (
                  <ItemRow item={row} expanded={expanded} onToggle={toggle} />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface RowProps {
  expanded: Set<string>;
  onToggle: Toggle;
}

function ItemRow({ item, expanded, onToggle }: RowProps & { item: Item }) {
  switch (item.type) {
    case 'user':
      return (
        <div className="flex flex-col items-end gap-2">
          {item.images?.length || item.files?.length ? (
            <div className="flex max-w-[488px] flex-wrap justify-end gap-2">
              {item.images?.map((src, index) => (
                <ZoomableImage key={index} src={src} className="max-h-[160px] max-w-[240px] rounded-lg border border-[var(--msg-user-border)] object-contain" />
              ))}
              {item.files?.map((file) => (
                <span
                  key={file.path ?? file.name}
                  title={file.path}
                  className="inline-flex h-[30px] min-w-0 max-w-full items-center gap-1.5 rounded-lg border border-[var(--msg-user-border)] bg-[var(--msg-user-bg)] px-2.5 text-13 text-[var(--msg-user-text)]"
                >
                  <FileText size={14} strokeWidth={1.8} aria-hidden className="shrink-0" />
                  <span className="truncate">{file.name}</span>
                </span>
              ))}
            </div>
          ) : null}
          {item.text ? (
            <div className="selectable relative min-w-0 max-w-[488px] whitespace-pre-wrap rounded-xl border border-[var(--msg-user-border)] bg-[var(--msg-user-bg)] px-4 py-3 text-15 font-normal leading-[1.6] text-[var(--msg-user-text)] [overflow-wrap:anywhere]">
              {item.text}
            </div>
          ) : null}
        </div>
      );
    case 'assistant':
      return <Markdown text={item.text} />;
    case 'notice':
      return (
        <div className="flex items-center gap-1.5 px-2 py-[3px] text-14 text-[var(--status-paused)]">
          <span aria-hidden className="inline-flex h-[18px] w-4 shrink-0 items-center justify-center">
            <CirclePause size={13} />
          </span>
          {t('interrupted')}
        </div>
      );
    case 'compaction':
      return (
        <div role="separator" aria-label={t('compacted')} className="flex w-full select-none items-center gap-3 py-2">
          <div className="h-px flex-1 bg-[var(--msg-tool-card-border)]" />
          <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--msg-tool-card-border)] px-2.5 py-1 text-12 text-[var(--msg-tool-card-chevron)]">
            <Layers size={12} aria-hidden className="shrink-0" />
            {t('compacted')}
          </div>
          <div className="h-px flex-1 bg-[var(--msg-tool-card-border)]" />
        </div>
      );
    case 'thinking':
      return <ThinkingRow item={item} isOpen={expanded.has(item.id)} onToggle={onToggle} />;
    case 'tool':
      return <ToolRow item={item} isOpen={expanded.has(item.id)} onToggle={onToggle} />;
  }
}

function Group({ group, expanded, onToggle }: RowProps & { group: WorkGroup }) {
  const isOpen = expanded.has(group.id);
  const base = group.durationMs !== null
    ? t('worked', { duration: formatDuration(group.durationMs) })
    : t('workDetails');
  const exploration = explorationSummary(group.items);
  return (
    <div className="w-full min-w-0">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => onToggle(group.id)}
        className="flex w-full cursor-pointer select-none items-center gap-1.5 rounded-[8px] py-[2px] text-left transition-opacity duration-[var(--motion-fast)] hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
      >
        <Layers size={14} aria-hidden className="shrink-0 text-[var(--msg-tool-card-chevron)]" />
        <span className="min-w-0 translate-y-[1px] truncate text-14 text-[var(--msg-tool-card-chevron)]">
          {exploration ? `${base} · ${exploration}` : base}
        </span>
        <div className="flex-1" />
        <ChevronRight
          size={14}
          aria-hidden
          className={`shrink-0 text-[var(--msg-tool-card-chevron)] transition-transform duration-[var(--motion-fast)] ease-[var(--motion-ease-out)] motion-reduce:transition-none ${
            isOpen ? 'rotate-90' : ''
          }`}
        />
      </button>
      {isOpen ? (
        <div className="mt-1 flex min-w-0 flex-col gap-0.5 border-l-2 border-[var(--agent-actions-rail)] py-[2px] pl-3">
          {group.items.map((item) => (
            <ItemRow key={item.id} item={item} expanded={expanded} onToggle={onToggle} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ThinkingRow({ item, isOpen, onToggle }: { item: TextItem; isOpen: boolean; onToggle: Toggle }) {
  return (
    <button
      type="button"
      aria-expanded={isOpen}
      aria-label={t('thinking')}
      onClick={() => onToggle(item.id)}
      className={`${ACTIVITY_ROW} ${isOpen ? '!items-start' : ''}`}
    >
      <span aria-hidden className="inline-flex h-[18px] w-4 shrink-0 items-center justify-center text-[var(--msg-tool-card-chevron)]">
        <Sparkles size={13} />
      </span>
      <span
        className={`min-w-0 flex-1 text-14 italic text-[var(--thinking-body-text)] ${
          isOpen ? 'selectable whitespace-pre-wrap break-words' : 'truncate'
        }`}
      >
        {isOpen ? item.text : item.text.replace(/\s+/g, ' ')}
      </span>
      <span aria-hidden className={CHEVRON_SLOT}>
        <ChevronRight size={13} className={`transition-transform duration-[var(--motion-fast)] ${isOpen ? 'rotate-90' : ''}`} />
      </span>
    </button>
  );
}

function ToolRow({ item, isOpen, onToggle }: { item: ToolItem; isOpen: boolean; onToggle: Toggle }) {
  const display = useMemo(() => describeTool(item), [item]);
  const isDone = item.result !== null;
  const status = !isDone ? t('running') : item.isError ? t('failed') : t('done');
  return (
    <div className="w-full min-w-0">
      <button type="button" aria-expanded={isOpen} onClick={() => onToggle(item.id)} className={ACTIVITY_ROW}>
        <span
          role="img"
          aria-label={status}
          className={`inline-flex h-[18px] w-4 shrink-0 items-center justify-center ${
            item.isError ? 'text-[var(--text-danger)]' : 'text-[var(--msg-tool-card-chevron)]'
          }`}
        >
          {!isDone ? (
            <Loader2 size={13} className="animate-spin motion-reduce:animate-none" />
          ) : item.isError ? (
            <X size={13} />
          ) : (
            <Check size={13} />
          )}
        </span>
        {display.verb ? (
          <span className="shrink-0 text-14 text-[var(--msg-tool-card-chevron)]">{display.verb}</span>
        ) : null}
        {display.fileName ? (
          <span
            title={display.text}
            className="inline-flex h-[22px] min-w-0 items-center gap-1 rounded-md border border-[var(--chat-input-chip-border)] bg-[var(--chat-input-chip-bg)] px-1.5 text-13 text-[var(--chat-input-chip-text)]"
          >
            <FileText size={12} aria-hidden className="shrink-0 text-[var(--chat-input-chip-icon)]" />
            <span className="min-w-0 truncate">{display.fileName}</span>
          </span>
        ) : (
          <span title={display.title ?? display.text} className="min-w-0 truncate text-14 font-medium text-[var(--msg-tool-card-chevron)]">
            {display.text}
          </span>
        )}
        <span className="flex-1" />
        {display.stats ? (
          <span className="flex shrink-0 gap-1 font-mono text-13 font-medium">
            <span className="text-[var(--diff-add-fg)]">+{display.stats.added}</span>
            <span className="text-[var(--diff-del-fg)]">-{display.stats.removed}</span>
          </span>
        ) : null}
        <span aria-hidden className={CHEVRON_SLOT}>
          {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
      </button>
      {display.command && !isOpen ? (
        <div
          title={display.command}
          className="min-w-0 truncate px-2 pb-[3px] pl-[30px] font-mono text-12 leading-[1.5] text-[var(--msg-tool-card-chevron)]"
        >
          {display.command}
        </div>
      ) : null}
      {isOpen ? (
        <div className="mb-1 ml-[30px] mt-1 rounded-[8px] border border-[var(--msg-tool-card-border)] bg-[var(--msg-tool-card-bg)] px-3.5 py-2.5">
          <ToolText label={t('input')} text={item.input} />
          {item.result !== null ? <ToolText label={t('output')} text={item.result} /> : null}
          {item.truncated ? (
            <p className="mt-2 text-12 text-[var(--text-tertiary)]">{t('truncated')}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ToolText({ label, text }: { label: string; text: string }) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1 text-xs font-medium text-[var(--msg-tool-card-chevron)]">{label}</div>
      <pre className="selectable max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-normal text-[var(--msg-tool-text)]">
        {text}
      </pre>
    </div>
  );
}
