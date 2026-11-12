import { lazy, Suspense, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  CirclePause,
  CircleAlert,
  Check,
  ChevronRight,
  FileText,
  Layers,
  LoaderCircle,
  Sparkles,
  Terminal,
  X,
} from 'lucide-react';
import { buildRows, visibleWorkItems, type Item, type Row } from './lib/items';
import { t } from './lib/i18n';
import { toolPresentation } from './lib/tools';
const Markdown = lazy(() => import('./Markdown').then((m) => ({ default: m.Markdown })));

export const duration = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return seconds < 60
    ? `${seconds}${t('seconds')}`
    : `${Math.floor(seconds / 60)}${t('minutes')}${seconds % 60}${t('seconds')}`;
};

type Toggle = (id: string, defaultOpen?: boolean) => void;
const expandedMemory = new Map<string, Map<string, boolean>>();

export default function Stream({
  taskId,
  items,
  isRunning,
  isLoading,
}: {
  taskId: string;
  items: Item[];
  isRunning: boolean;
  isLoading: boolean;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const rows = useMemo(() => buildRows(items, isRunning), [items, isRunning]);
  // Explicit open and closed choices survive virtualized rows; absent entries use their default.
  const [expanded, setExpanded] = useState(() => expandedMemory.get(taskId) ?? new Map<string, boolean>());
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => 64,
    overscan: 5,
    getItemKey: (i) => rows[i].id,
  });
  const total = virtual.getTotalSize();
  useLayoutEffect(() => {
    if (follow.current && rows.length) virtual.scrollToIndex(rows.length - 1, { align: 'end' });
  }, [rows, total, virtual]);
  function toggle(id: string, defaultOpen = false) {
    setExpanded((old) => {
      const next = new Map(old);
      next.set(id, !(old.get(id) ?? defaultOpen));
      expandedMemory.set(taskId, next);
      return next;
    });
  }
  return (
    <div
      className="stream"
      ref={scroll}
      onScroll={(e) => {
        const el = e.currentTarget;
        follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
      }}
    >
      {!rows.length && (
        <div className="empty-task" role={isLoading ? 'status' : undefined}>
          {isLoading ? <LoaderCircle size={20} className="spin" /> : <Sparkles size={24} />}
          <p>{t(isLoading ? 'loadingTask' : 'startPrompt')}</p>
        </div>
      )}
      <div style={{ height: total, position: 'relative' }}>
        {virtual.getVirtualItems().map((row) => (
          <article
            key={row.key}
            data-index={row.index}
            ref={virtual.measureElement}
            className={'message-row message-' + rows[row.index].type}
            style={{ transform: `translateY(${row.start}px)` }}
          >
            <ItemRow item={rows[row.index]} expanded={expanded} toggle={toggle} />
          </article>
        ))}
      </div>
    </div>
  );
}

function ItemRow({ item, expanded, toggle }: { item: Row; expanded: Map<string, boolean>; toggle: Toggle }) {
  const open = expanded.get(item.id) ?? (item.type === 'group' && item.isRunning);
  switch (item.type) {
    case 'user':
      return (
        <div className="user-message">
          {item.images?.length || item.files?.length ? (
            <div className="attachments">
              <FileText size={14} />
              {[...(item.images?.length ? [t('image')] : []), ...(item.files?.map((f) => f.name) ?? [])].join(
                '、',
              )}
            </div>
          ) : null}
          {item.text && <div className="user-bubble">{item.text}</div>}
        </div>
      );
    case 'assistant':
      return (
        <div className="assistant-message">
          <Suspense fallback={<p className="plain-message">{item.text}</p>}>
            <Markdown text={item.text} />
          </Suspense>
        </div>
      );
    case 'error':
      return <div className="reply-error">
        <div><CircleAlert size={14} aria-hidden /><span>{t('replyFailed')}</span></div>
        {item.text ? <details><summary>{t('showDetails')}</summary><pre>{item.text}</pre></details> : null}
      </div>;
    case 'notice':
      return (
        <div className="notice">
          <span className="notice-icon" aria-hidden="true">
            <CirclePause size={13} />
          </span>
          {t('interrupted')}
        </div>
      );
    case 'compaction':
      return (
        <div className="compaction" role="separator" aria-label={t('compacted')}>
          <span />
          <div>
            <Layers size={12} />
            {t('compacted')}
          </div>
          <span />
        </div>
      );
    case 'group': {
      const visible = visibleWorkItems(item, expanded.get(item.id));
      const label = item.isRunning
        ? t('workRunning')
        : item.durationMs === null
          ? t('workDetails')
          : t(item.isSummary ? 'processed' : 'worked').replace('{duration}', duration(item.durationMs));
      return (
        <div className="work-group">
          <button
            className="work-toggle"
            data-work-group={item.isRunning ? 'running' : 'completed'}
            aria-expanded={open}
            onClick={() => toggle(item.id, item.isRunning)}
          >
            {item.isRunning ? <LoaderCircle size={14} className="spin" /> : <Layers size={14} />}
            <span>{label}</span>
            <ChevronRight size={14} className={open ? 'turned' : ''} />
          </button>
          {visible.length > 0 && (
            <div className="work-rail">
              <WorkChildren rows={visible} expanded={expanded} toggle={toggle} />
            </div>
          )}
        </div>
      );
    }
    case 'thinking':
      return (
        <button
          className={'activity-row thinking ' + (open ? 'opened' : '')}
          aria-label={t('thinking')}
          aria-expanded={open}
          onClick={() => toggle(item.id)}
        >
          <Sparkles size={13} />
          <span>{open ? item.text : item.text.replace(/\s+/g, ' ')}</span>
          <ChevronRight size={13} className={open ? 'turned' : ''} />
        </button>
      );
    case 'tool': {
      const display = toolPresentation(item.name, item.input);
      return (
        <div className="tool-row">
          <button
            className="activity-row"
            title={display.title}
            aria-label={`${item.name} ${display.label} ${display.detail}`}
            aria-expanded={open}
            onClick={() => toggle(item.id)}
          >
            {item.result === null ? (
              <LoaderCircle size={13} className="spin" aria-label={t('running')} />
            ) : item.isError ? (
              <X size={13} />
            ) : (
              <Check size={13} />
            )}
            <span>
              {display.label}
              {display.detail && <small>{display.detail}</small>}
            </span>
            <ChevronRight size={13} className={open ? 'turned' : ''} />
          </button>
          {open && (
            <div className="tool-detail">
              <div>
                <Terminal size={12} />
                {item.name}
              </div>
              <pre>{item.input}</pre>
              {item.result !== null && <pre className={item.isError ? 'tool-error' : ''}>{item.result}</pre>}
              {item.truncated && <small>{t('truncated')}</small>}
            </div>
          )}
        </div>
      );
    }
  }
}

function WorkChildren({
  rows,
  expanded,
  toggle,
}: {
  rows: Row[];
  expanded: Map<string, boolean>;
  toggle: Toggle;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const virtualized = rows.length > 80;
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => 36,
    overscan: 5,
    getItemKey: (index) => rows[index].id,
    enabled: virtualized,
  });
  if (!virtualized)
    return (
      <>
        {rows.map((row) => (
          <ItemRow key={row.id} item={row} expanded={expanded} toggle={toggle} />
        ))}
      </>
    );
  return (
    <div ref={scroll} className="work-scroll">
      <div style={{ position: 'relative', height: virtual.getTotalSize() }}>
        {virtual.getVirtualItems().map((row) => (
          <div
            key={row.key}
            data-index={row.index}
            ref={virtual.measureElement}
            className="work-virtual-row"
            style={{ transform: `translateY(${row.start}px)` }}
          >
            <ItemRow item={rows[row.index]} expanded={expanded} toggle={toggle} />
          </div>
        ))}
      </div>
    </div>
  );
}
