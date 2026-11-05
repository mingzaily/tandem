import { useEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Message } from './lib/types';
import { t } from './lib/i18n';
export default function Stream({ messages }: { messages: Message[] }) {
  const scroll = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const virtual = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => 100,
    overscan: 5,
    getItemKey: (i) => messages[i].id,
  });
  useEffect(() => {
    if (follow.current && messages.length) virtual.scrollToIndex(messages.length - 1, { align: 'end' });
  }, [messages, virtual]);
  return (
    <div
      className="stream"
      ref={scroll}
      onScroll={(e) => {
        const el = e.currentTarget;
        follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
      }}
    >
      <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
        {virtual.getVirtualItems().map((row) => {
          const m = messages[row.index];
          return (
            <article
              key={row.key}
              data-index={row.index}
              ref={virtual.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${row.start}px)`,
              }}
            >
              <div className={'message ' + m.kind}>
                {m.toolName && <strong>{m.toolName}</strong>}
                <p>{m.text}</p>
                {m.image && <span className="chip">{t('image')}</span>}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
