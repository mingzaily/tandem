import { ArrowUp, FileText, Plus, Square, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  addPastedImage,
  onAttachmentDrag,
  onAttachmentsDropped,
  pickAttachments,
  removeAttachment,
  type AddResult,
  type Attachment,
} from '../lib/api';
import { t } from '../lib/i18n';

const MAX_HEIGHT_PX = 240;
const SEND_BUTTON =
  'relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--send-btn-bg)] text-[var(--send-btn-icon)] transition-[color,background-color,transform] duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-soft)] focus-visible:ring-offset-2 enabled:hover:bg-[var(--send-btn-hover-bg)] enabled:active:scale-[0.98] enabled:active:bg-[var(--send-btn-pressed-bg)] disabled:cursor-not-allowed disabled:opacity-40';

const ATTACH_BUTTON =
  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]';
const REMOVE_BUTTON =
  'absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-[var(--send-btn-bg)] text-[var(--send-btn-icon)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]';

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.readAsDataURL(file);
  });
}

interface ComposerProps {
  running: boolean;
  disabled?: boolean;
  placeholder: string;
  /** Replaces the draft whenever a new object arrives, so the same text can be filled twice. */
  fill?: { text: string };
  toolbarLeft: ReactNode;
  toolbarRight: ReactNode;
  onSend: (prompt: string, attachments: Attachment[]) => void;
  onStop: () => void;
}

export function Composer({
  running,
  disabled = false,
  placeholder,
  fill,
  toolbarLeft,
  toolbarRight,
  onSend,
  onStop,
}: ComposerProps) {
  const [value, setValue] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const canSend = (value.trim().length > 0 || attachments.length > 0) && !running && !disabled;

  // What the backend still holds for this draft, released if the draft is abandoned.
  const held = useRef<Attachment[]>([]);
  held.current = attachments;
  useEffect(
    () => () => {
      for (const attachment of held.current) void removeAttachment(attachment.id);
    },
    [],
  );

  const addResult = useCallback(({ added, errors }: AddResult) => {
    setAttachments((current) => [...current, ...added]);
    setAttachError(errors.length > 0 ? errors.join('\n') : null);
    textarea.current?.focus();
  }, []);

  useEffect(() => {
    const unlisten = [onAttachmentsDropped(addResult), onAttachmentDrag(setIsDragOver)];
    return () => {
      for (const stop of unlisten) void stop.then((run) => run());
    };
  }, [addResult]);

  const remove = (id: string) => {
    setAttachments((current) => current.filter((attachment) => attachment.id !== id));
    void removeAttachment(id);
  };

  const paste = async (files: File[]) => {
    const images = files.filter((file) => file.type.startsWith('image/'));
    const errors = images.length < files.length ? [t('pasteOnlyImages')] : [];
    const added: Attachment[] = [];
    for (const image of images) {
      try {
        added.push(await addPastedImage(await readAsBase64(image)));
      } catch (error) {
        errors.push(String(error));
      }
    }
    addResult({ added, errors });
  };

  useEffect(() => {
    if (!fill) return;
    setValue(fill.text);
    textarea.current?.focus();
  }, [fill]);

  useLayoutEffect(() => {
    const element = textarea.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [value]);

  const submit = () => {
    if (!canSend) return;
    onSend(value, attachments);
    // The backend has them now, so an unmount must not release them.
    held.current = [];
    setAttachments([]);
    setAttachError(null);
    setValue('');
  };

  return (
    <div
      className={`flex w-full cursor-text flex-col rounded-[12px] border bg-[var(--chat-input-bg)] transition-colors duration-[var(--motion-fast)] focus-within:border-[var(--chat-input-border-focus)] ${
        isDragOver ? 'border-[var(--chat-input-border-focus)] ring-2 ring-[var(--focus-ring-soft)]' : 'border-[var(--chat-input-border)]'
      }`}
      onMouseDown={(event) => {
        // Clicking the card's empty space keeps the caret in the text box.
        if (event.target === event.currentTarget) {
          event.preventDefault();
          textarea.current?.focus();
        }
      }}
    >
      {attachments.length > 0 ? (
        <div className="flex flex-wrap gap-2 px-4 pt-3">
          {attachments.map((attachment) => (
            <div key={attachment.id} className="relative" title={attachment.path ?? attachment.name}>
              {attachment.preview ? (
                <img src={attachment.preview} alt={attachment.name} className="size-14 rounded-lg border border-[var(--chat-input-chip-border)] object-cover" />
              ) : (
                <div className="flex h-14 max-w-[200px] items-center gap-2 rounded-lg border border-[var(--chat-input-chip-border)] bg-[var(--chat-input-chip-bg)] px-3 text-13 text-[var(--chat-input-chip-text)]">
                  <FileText size={16} strokeWidth={1.8} aria-hidden className="shrink-0" />
                  <span className="truncate">{attachment.name}</span>
                </div>
              )}
              <button
                type="button"
                aria-label={t('removeAttachment', { name: attachment.name })}
                title={t('removeAttachment', { name: attachment.name })}
                onClick={() => remove(attachment.id)}
                className={REMOVE_BUTTON}
              >
                <X size={10} strokeWidth={2.5} aria-hidden />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <textarea
        ref={textarea}
        autoFocus
        rows={1}
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(event) => setValue(event.target.value)}
        onPaste={(event) => {
          const files = [...event.clipboardData.files];
          if (files.length === 0) return;
          event.preventDefault();
          void paste(files);
        }}
        onKeyDown={(event) => {
          // Enter also confirms an input method's candidate, which must not send the message.
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            submit();
          }
        }}
        className="selectable min-h-[52px] w-full resize-none bg-transparent px-4 pb-1 pt-3 text-15 leading-[1.467] text-[var(--chat-input-text)] outline-none placeholder:text-[var(--chat-input-placeholder)]"
      />
      {attachError ? (
        <p role="alert" className="selectable whitespace-pre-wrap px-4 pb-1 text-12 text-[var(--text-danger)]">
          {attachError}
        </p>
      ) : null}
      <div className="flex items-center justify-between gap-2 px-2.5 pb-2.5">
        <div className="flex min-w-0 items-center gap-1">
          <button
            type="button"
            aria-label={t('attach')}
            title={t('attach')}
            onClick={() => {
              pickAttachments()
                .then(addResult)
                .catch((error) => setAttachError(String(error)));
            }}
            className={ATTACH_BUTTON}
          >
            <Plus size={16} strokeWidth={1.8} aria-hidden />
          </button>
          {toolbarLeft}
        </div>
        <div className="flex min-w-0 items-center gap-1">
          {toolbarRight}
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
    </div>
  );
}
