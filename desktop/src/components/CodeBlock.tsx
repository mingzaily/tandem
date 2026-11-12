import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { t } from '../lib/i18n';

/** The button stays outside the scrollable pre and copies its current text, including live output. */
export function CodeBlock({ children }: { children?: ReactNode }) {
  const pre = useRef<HTMLPreElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = useRef(true);
  const [copyState, setCopyState] = useState<'ready' | 'copied' | 'failed'>('ready');
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; if (timer.current !== null) clearTimeout(timer.current); };
  }, []);
  const copy = async () => {
    const text = pre.current?.textContent;
    if (text === undefined || text === null) return;
    if (timer.current !== null) { clearTimeout(timer.current); timer.current = null; }
    try {
      await navigator.clipboard.writeText(text);
      if (!active.current) return;
      if (timer.current !== null) clearTimeout(timer.current);
      setCopyState('copied');
      timer.current = setTimeout(() => { setCopyState('ready'); timer.current = null; }, 1500);
    } catch {
      if (!active.current) return;
      if (timer.current !== null) { clearTimeout(timer.current); timer.current = null; }
      setCopyState('failed');
    }
  };
  const label = t(copyState === 'copied' ? 'messageCopied' : copyState === 'failed' ? 'messageCopyFailed' : 'codeCopy');
  return <div className="md-code-block">
    <pre ref={pre}>{children}</pre>
    <button type="button" onClick={() => void copy()} aria-label={t('codeCopy')} data-tooltip={label}
      className="absolute right-2 top-2 inline-flex size-7 items-center justify-center rounded-[6px] border border-[var(--msg-code-block-border)] bg-[var(--msg-code-block-bg)] text-[var(--text-secondary)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--cmd-palette-item-hover)] hover:text-[var(--msg-assistant-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] motion-reduce:transition-none">
      {copyState === 'copied' ? <Check size={14} strokeWidth={2} aria-hidden /> : <Copy size={14} strokeWidth={2} aria-hidden />}
    </button>
    <span role={copyState === 'failed' ? 'alert' : 'status'} className={copyState === 'failed' ? 'absolute right-11 top-2 inline-flex h-7 items-center text-12 text-[var(--text-danger)]' : 'sr-only'}>
      {copyState === 'ready' ? '' : label}
    </span>
  </div>;
}
