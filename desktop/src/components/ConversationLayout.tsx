import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';

/** The stream extends behind the composer; its measured inset keeps the last row readable. */
export function ConversationLayout({ messages, children }: {
  messages: (bottomPadding: number) => ReactNode;
  children: ReactNode;
}) {
  const overlay = useRef<HTMLDivElement>(null);
  const [bottomPadding, setBottomPadding] = useState(0);

  useLayoutEffect(() => {
    const element = overlay.current!;
    let height = element.offsetHeight;
    setBottomPadding(height);
    const observer = new ResizeObserver(() => {
      const next = element.offsetHeight;
      if (next === height) return;
      height = next;
      // Commit the inset before paint when a status, queue or multiline draft changes height.
      flushSync(() => setBottomPadding(next));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <section className="conversation-layout relative min-h-0 flex-1 overflow-hidden">
      {messages(bottomPadding)}
      <div ref={overlay} className="conversation-composer pointer-events-none absolute bottom-0 flex max-h-full flex-col">
        <div aria-hidden className="pointer-events-none h-8 shrink-0 bg-gradient-to-t from-[hsl(var(--content-area))] to-transparent" />
        <div className="pointer-events-auto min-h-0 overflow-y-auto bg-[hsl(var(--content-area))] pb-5">
          <div className="composer-column">{children}</div>
        </div>
      </div>
    </section>
  );
}
