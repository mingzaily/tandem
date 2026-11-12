import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { codeRanges } from '../lib/fencedCode';

/** The textarea owns native editing; this inert mirror only measures block backgrounds. */
export function CodeFenceBackdrop({ value, editor }: { value: string; editor: RefObject<HTMLTextAreaElement | null> }) {
  const ranges = useMemo(() => codeRanges(value), [value]);
  if (ranges.length === 0) return null;
  return <Backdrop value={value} editor={editor} ranges={ranges} />;
}

function Backdrop({ value, editor, ranges }: { value: string; editor: RefObject<HTMLTextAreaElement | null>; ranges: ReturnType<typeof codeRanges> }) {
  const root = useRef<HTMLDivElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const [boxes, setBoxes] = useState<{ top: number; height: number }[]>([]);
  useLayoutEffect(() => {
    const input = editor.current;
    const content = mirror.current;
    if (!input || !content || !root.current) return;
    const measure = () => {
      content.style.width = `${input.clientWidth}px`;
      content.style.transform = `translateY(${-input.scrollTop}px)`;
      const top = root.current!.getBoundingClientRect().top;
      const next = [...content.querySelectorAll('[data-code-fence]')].map((span) => {
        const rect = span.getBoundingClientRect();
        return { top: rect.top - top - 2, height: rect.height + 4 };
      });
      setBoxes((old) => old.length === next.length && old.every((box, index) => box.top === next[index].top && box.height === next[index].height) ? old : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(input);
    input.addEventListener('scroll', measure, { passive: true });
    return () => { observer.disconnect(); input.removeEventListener('scroll', measure); };
  }, [value, ranges, editor]);
  let offset = 0;
  const parts = ranges.flatMap((range) => {
    const nodes = [value.slice(offset, range.from), <span key={range.from} data-code-fence>{value.slice(range.from, range.to)}</span>];
    offset = range.to;
    return nodes;
  });
  return (
    <div ref={root} aria-hidden className="composer-code-backdrop">
      {boxes.map((box, index) => <div key={index} className="composer-code-surface" style={box} />)}
      <div ref={mirror} className="composer-content-inset composer-code-mirror text-15 leading-[1.467]">{parts}{value.slice(offset)}{'\u200b'}</div>
    </div>
  );
}
