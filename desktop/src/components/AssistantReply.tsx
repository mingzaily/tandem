import { Check, Copy } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { currentLanguage, t } from '../lib/i18n';
import { Markdown } from './Markdown';

/** A completed reply's footer aligns the copy glyph and record time with its body. */
export function AssistantReply({ text, copyable, at, children }: { text: string; copyable: boolean; at?: number; children?: ReactNode }) {
  const date = at === undefined ? null : new Date(at);
  const time = date && Number.isFinite(date.getTime()) ? date : null;
  const locale = currentLanguage() === 'zh' ? 'zh-CN' : 'en-GB';
  const fullTime = time?.toLocaleString(locale, {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }) ?? '';
  const [copyState, setCopyState] = useState<'ready' | 'copied' | 'failed'>('ready');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  };
  const label = t(copyState === 'copied' ? 'messageCopied' : copyState === 'failed' ? 'messageCopyFailed' : 'messageCopy');

  return (
    <div className="assistant-reply flex w-full min-w-0 flex-col gap-1.5"
      onMouseEnter={() => setCopyState('ready')}
      onFocusCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setCopyState('ready');
      }}>
      <Markdown text={text} />
      {children}
      {copyable ? (
        <div data-reply-actions className="reply-actions -ml-[5px] flex h-6 items-center gap-2">
          <button type="button" aria-label={t('messageCopy')} data-tooltip={label}
            onClick={(event) => { event.stopPropagation(); void copy(); }}
            className="group inline-flex size-6 shrink-0 items-center justify-center rounded-full border-none bg-transparent text-[var(--cmd-palette-item-meta)] transition-colors duration-[var(--motion-fast)] ease-[var(--motion-ease-out)] hover:bg-[var(--cmd-palette-item-hover)] hover:text-[var(--msg-assistant-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] motion-reduce:transition-none">
            {copyState === 'copied' ? <Check size={14} strokeWidth={2} aria-hidden /> : <Copy size={14} strokeWidth={2} aria-hidden />}
          </button>
          {time ? <time dateTime={time.toISOString()} data-tooltip={fullTime} aria-label={t('messageTime', { time: fullTime })}
            className="inline-flex h-6 shrink-0 items-center whitespace-nowrap text-12 font-normal leading-6 tabular-nums text-[var(--settings-section-desc)]">
            {time.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}
          </time> : null}
          <span role={copyState === 'failed' ? 'alert' : 'status'} className={copyState === 'failed' ? 'text-12 text-[var(--text-danger)]' : 'sr-only'}>
            {copyState === 'ready' ? '' : label}
          </span>
        </div>
      ) : null}
    </div>
  );
}
