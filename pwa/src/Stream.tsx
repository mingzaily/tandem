import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  CirclePause,
  Check,
  ChevronRight,
  FileText,
  Layers,
  LoaderCircle,
  Sparkles,
  Terminal,
  X,
} from 'lucide-react';
import { buildRows, type Item, type WorkGroup } from './lib/items';
import { t } from './lib/i18n';
const Markdown = lazy(() => import('./Markdown').then((m) => ({ default: m.Markdown })));

export const duration = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return seconds < 60
    ? `${seconds}${t('seconds')}`
    : `${Math.floor(seconds / 60)}${t('minutes')}${seconds % 60}${t('seconds')}`;
};

export default function Stream({ items, isRunning }: { items: Item[]; isRunning: boolean }) {
  const scroll = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const rows = useMemo(() => buildRows(items, isRunning), [items, isRunning]);
  // Rows unmount outside the viewport, so expansion belongs to the stream.
  const [expanded, setExpanded] = useState(new Set<string>());
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => 64,
    overscan: 5,
    getItemKey: (i) => rows[i].id,
  });
  const total = virtual.getTotalSize();
  useEffect(() => {
    if (follow.current && rows.length) virtual.scrollToIndex(rows.length - 1, { align: 'end' });
  }, [rows, total, virtual]);
  function toggle(id: string) {
    setExpanded((old) => {
      const next = new Set(old);
      if (!next.delete(id)) next.add(id);
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
        <div className="empty-task">
          <Sparkles size={24} />
          <p>{t('startPrompt')}</p>
        </div>
      )}
      <div style={{ height: total, position: 'relative' }}>
        {virtual.getVirtualItems().map((row) => (
          <article
            key={row.key}
            data-index={row.index}
            ref={virtual.measureElement}
            className="message-row"
            style={{ transform: `translateY(${row.start}px)` }}
          >
            <ItemRow item={rows[row.index]} expanded={expanded} toggle={toggle} />
          </article>
        ))}
      </div>
    </div>
  );
}

function ItemRow({
  item,
  expanded,
  toggle,
}: {
  item: Item | WorkGroup;
  expanded: Set<string>;
  toggle: (id: string) => void;
}) {
  const open = expanded.has(item.id);
  switch (item.type) {
    case 'user':
      return (
        <div className="user-message">
          {item.images?.length || item.files?.length ? (
            <div className="attachments">
              <FileText size={14} />
              {item.images?.length ? t('image') : item.files?.map((f) => f.name).join('、')}
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
    case 'notice':
      return (
        <div className="notice">
          <span className="notice-icon" aria-hidden="true"><CirclePause size={13} /></span>
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
    case 'group':
      return (
        <div className="work-group">
          <button className="work-toggle" aria-expanded={open} onClick={() => toggle(item.id)}>
            <Layers size={14} />
            <span>
              {item.durationMs === null
                ? t('workDetails')
                : t('worked').replace('{duration}', duration(item.durationMs))}
            </span>
            <ChevronRight size={14} className={open ? 'turned' : ''} />
          </button>
          {open && (
            <div className="work-rail">
              {item.items.map((child) => (
                <ItemRow key={child.id} item={child} expanded={expanded} toggle={toggle} />
              ))}
            </div>
          )}
        </div>
      );
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
    case 'tool':
      return (
        <div className="tool-row">
          <button className="activity-row" aria-expanded={open} onClick={() => toggle(item.id)}>
            {item.result === null ? (
              <LoaderCircle size={13} className="spin" aria-label={t('running')} />
            ) : item.isError ? (
              <X size={13} />
            ) : (
              <Check size={13} />
            )}
            <span>
              {item.name}
              <small>{toolDetail(item.input)}</small>
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

function toolDetail(input: string) {
  try {
    const value = JSON.parse(input);
    return value.command ?? value.file_path ?? value.pattern ?? value.description ?? '';
  } catch {
    return input;
  }
}
