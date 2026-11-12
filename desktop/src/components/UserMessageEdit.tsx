import { Pencil } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { t } from '../lib/i18n';
import { isImeKey } from '../lib/ime';

const BUTTON = 'inline-flex h-7 shrink-0 items-center justify-center rounded-full border px-3 text-13 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-60';
const SECONDARY = `${BUTTON} border-[var(--border-default)] bg-[var(--surface-elevated)] text-[var(--text-primary)] enabled:hover:bg-[var(--button-secondary-hover)] enabled:active:bg-[var(--button-secondary-pressed)]`;
const CTA = `${BUTTON} border-[var(--accent-cta-bg-pure)] bg-[var(--accent-cta-bg-pure)] text-[var(--accent-pure-cta-fg)] enabled:hover:border-[var(--button-cta-hover)] enabled:hover:bg-[var(--button-cta-hover)]`;

/** The last prompt's hover action, placed like the reference's bubble hover toolbar. */
export function EditableUserMessage({ text, sendWithCmdEnter, onSend, children }: {
  text: string;
  sendWithCmdEnter: boolean;
  onSend: (text: string) => Promise<void>;
  children: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) return <EditBox text={text} sendWithCmdEnter={sendWithCmdEnter} onCancel={() => setEditing(false)} onSend={onSend} />;
  // Hangs beside the bubble on its outer side, level with its top, so it takes no room in the column.
  return <div className="group/message relative ml-auto w-fit max-w-full">
    {children}
    <div data-edit-actions className="absolute right-full top-0 mr-1 flex opacity-0 transition-opacity duration-[var(--motion-enter)] ease-[var(--motion-ease-out)] focus-within:opacity-100 group-hover/message:opacity-100 motion-reduce:transition-none [@media(hover:none)]:opacity-100">
      <button type="button" aria-label={t('messageEdit')} data-tooltip={t('messageEdit')} onClick={() => setEditing(true)}
        className="group inline-flex size-6 items-center justify-center rounded-full transition-colors hover:bg-[var(--cmd-palette-item-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]">
        <Pencil size={14} strokeWidth={2} aria-hidden className="text-[var(--cmd-palette-item-meta)] transition-colors group-hover:text-[var(--msg-assistant-text)]" />
      </button>
    </div>
  </div>;
}

/**
 * Edits in place and sends from here. Cancelling leaves the history as it was; the history is
 * only cut when the edited prompt goes out.
 */
function EditBox({ text: original, sendWithCmdEnter, onCancel, onSend }: {
  text: string;
  sendWithCmdEnter: boolean;
  onCancel: () => void;
  onSend: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState(original);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const canSend = !sending && text.trim().length > 0 && text !== original;

  useLayoutEffect(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
  }, [text]);
  useLayoutEffect(() => {
    const element = field.current;
    element?.focus();
    element?.setSelectionRange(element.value.length, element.value.length);
  }, []);

  const send = () => {
    if (!canSend) return;
    setSending(true);
    setError(null);
    onSend(text).catch((reason) => {
      setError(String(reason));
      setSending(false);
    });
  };

  return <div className="w-full rounded-[12px] border border-[var(--msg-user-border)] bg-[var(--msg-user-bg)] px-4 pb-2.5 pt-3">
    <textarea
      ref={field}
      value={text}
      rows={1}
      spellCheck={false}
      disabled={sending}
      aria-label={t('messageEdit')}
      onChange={(event) => setText(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          if (!sending) onCancel();
          return;
        }
        if (event.key !== 'Enter' || isImeKey(event)) return;
        const wantsSend = sendWithCmdEnter ? event.metaKey : !event.shiftKey;
        if (wantsSend) {
          event.preventDefault();
          send();
        }
      }}
      className="selectable block max-h-[40vh] w-full resize-none overflow-y-auto border-none bg-transparent p-0 text-15 font-normal leading-[1.6] text-[var(--msg-user-text)] outline-none disabled:opacity-60"
    />
    <div className="mt-2 flex items-center justify-end gap-2">
      <span role={error ? 'alert' : undefined} className={`min-w-0 flex-1 truncate text-left text-11 ${error ? 'text-[var(--text-danger)]' : 'text-[var(--text-tertiary)]'}`} data-tooltip={error ?? undefined}>
        {error ?? t('messageEditFilesKept')}
      </span>
      <button type="button" disabled={sending} onClick={onCancel} className={SECONDARY}>{t('messageEditCancel')}</button>
      <button type="button" disabled={!canSend} aria-busy={sending || undefined} onClick={send} className={CTA}>{t('messageEditSend')}</button>
    </div>
  </div>;
}
