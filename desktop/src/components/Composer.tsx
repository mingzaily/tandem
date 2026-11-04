import { ArrowUp, Check, ChevronDown, Folder, Square } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { t } from '../lib/i18n';
import { projectName } from '../lib/items';
import { AgentMark } from './AgentMark';

const MAX_HEIGHT_PX = 240;
const SEND_BUTTON =
  'relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--send-btn-bg)] text-[var(--send-btn-icon)] transition-[color,background-color,transform] duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-soft)] focus-visible:ring-offset-2 enabled:hover:bg-[var(--send-btn-hover-bg)] enabled:active:scale-[0.98] enabled:active:bg-[var(--send-btn-pressed-bg)] disabled:cursor-not-allowed disabled:opacity-40';

interface ProjectPicker {
  value: string | null;
  options: string[];
  onChange: (cwd: string) => void;
}

interface ComposerProps {
  running: boolean;
  disabled?: boolean;
  projects?: ProjectPicker;
  onSend: (prompt: string) => void;
  onStop: () => void;
}

export function Composer({ running, disabled = false, projects, onSend, onStop }: ComposerProps) {
  const [value, setValue] = useState('');
  const textarea = useRef<HTMLTextAreaElement>(null);
  const canSend = value.trim().length > 0 && !running && !disabled;

  useLayoutEffect(() => {
    const element = textarea.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [value]);

  const submit = () => {
    if (!canSend) return;
    onSend(value);
    setValue('');
  };

  return (
    <div
      className="flex w-full cursor-text flex-col rounded-[12px] border border-[var(--chat-input-border)] bg-[var(--chat-input-bg)] transition-colors duration-[var(--motion-fast)] focus-within:border-[var(--chat-input-border-focus)]"
      onMouseDown={(event) => {
        // Clicking the card's empty space keeps the caret in the text box.
        if (event.target === event.currentTarget) {
          event.preventDefault();
          textarea.current?.focus();
        }
      }}
    >
      <textarea
        ref={textarea}
        autoFocus
        rows={1}
        value={value}
        placeholder={t('placeholder')}
        aria-label={t('placeholder')}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          // Enter also confirms an input method's candidate, which must not send the message.
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            submit();
          }
        }}
        className="selectable min-h-[52px] w-full resize-none bg-transparent px-4 pb-1 pt-3 text-15 leading-[1.467] text-[var(--chat-input-text)] outline-none placeholder:text-[var(--chat-input-placeholder)]"
      />
      <div className="flex items-center justify-between gap-2 px-2.5 pb-2.5">
        <div className="flex min-w-0 items-center gap-1">
          {projects ? <ProjectSelect {...projects} /> : null}
          <span className="inline-flex h-7 items-center gap-1.5 px-2 text-13 text-[var(--text-secondary)]">
            <AgentMark size={13} />
            Claude Code
          </span>
        </div>
        {running ? (
          <button type="button" aria-label={t('stop')} title={t('stop')} onClick={onStop} className={SEND_BUTTON}>
            <Square size={11} fill="currentColor" aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            aria-label={t('send')}
            title={t('send')}
            disabled={!canSend}
            onClick={submit}
            className={SEND_BUTTON}
          >
            <ArrowUp size={15} strokeWidth={2.2} aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}

function ProjectSelect({ value, options, onChange }: ProjectPicker) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div ref={root} className="relative min-w-0">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={options.length === 0}
        onClick={() => setOpen((current) => !current)}
        className="inline-flex h-7 max-w-[220px] items-center gap-1.5 rounded-full px-2 text-13 text-[var(--text-secondary)] transition-colors duration-[var(--motion-fast)] enabled:hover:bg-[var(--model-trigger-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:opacity-40"
      >
        <Folder size={14} strokeWidth={1.8} aria-hidden className="shrink-0" />
        <span className="min-w-0 truncate">{value ? projectName(value) : t('chooseProject')}</span>
        <ChevronDown size={13} aria-hidden className="shrink-0" />
      </button>
      {open ? (
        <ul
          role="listbox"
          aria-label={t('chooseProject')}
          className="absolute bottom-full left-0 z-20 mb-1 max-h-72 w-[280px] overflow-y-auto rounded-[12px] border border-[var(--cmd-palette-border)] bg-[var(--cmd-palette-bg)] p-1.5 shadow-[var(--shadow-menu)]"
        >
          {options.map((cwd) => (
            <li key={cwd} role="option" aria-selected={cwd === value}>
              <button
                type="button"
                title={cwd}
                onClick={() => {
                  onChange(cwd);
                  setOpen(false);
                }}
                className="flex h-8 w-full items-center gap-2 rounded-[8px] px-2 text-left text-13 text-[var(--cmd-palette-item-text)] hover:bg-[var(--cmd-palette-item-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
              >
                <Folder size={14} strokeWidth={1.8} aria-hidden className="shrink-0 text-[var(--cmd-palette-item-icon)]" />
                <span className="min-w-0 flex-1 truncate">{projectName(cwd)}</span>
                {cwd === value ? <Check size={14} aria-hidden className="shrink-0" /> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
