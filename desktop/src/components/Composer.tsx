import { ArrowUp, FileText, ListPlus, Plus, Square, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  addPastedImage,
  onAttachmentDrag,
  onAttachmentsDropped,
  pickAttachments,
  removeAttachment,
  type AddResult,
  type Attachment,
  type QueuedMessage,
} from '../lib/api';
import { t } from '../lib/i18n';
import { canRestoreComposerFocus, isComposerBlankTarget } from '../lib/composerFocus';
import { ZoomableImage } from './ImageLightbox';

const MAX_HEIGHT_PX = 240;
const ACTION_BUTTON =
  'relative flex h-7 shrink-0 items-center justify-center rounded-full bg-[var(--send-btn-bg)] text-[var(--send-btn-icon)] transition-[color,background-color,transform] duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-soft)] focus-visible:ring-offset-2 enabled:hover:bg-[var(--send-btn-hover-bg)] enabled:active:scale-[0.98] enabled:active:bg-[var(--send-btn-pressed-bg)] disabled:cursor-default disabled:opacity-40';
const SEND_BUTTON = `${ACTION_BUTTON} w-7`;

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
  variant?: 'task' | 'new';
  running: boolean;
  queueing?: boolean;
  disabled?: boolean;
  placeholder: string;
  /** Replaces the draft whenever a new object arrives, so the same text can be filled twice. */
  fill?: { text: string };
  sendWithCmdEnter?: boolean;
  toolbarLeft: ReactNode;
  toolbarRight: ReactNode;
  queuePanel?: ReactNode;
  editing?: QueuedMessage;
  onSaveEdit?: (prompt: string) => Promise<void>;
  onCancelEdit?: () => void;
  onSend: (prompt: string, attachments: Attachment[]) => void | Promise<void>;
  onStop: () => void;
}

export function Composer({
  variant = 'task',
  running,
  queueing = running,
  disabled = false,
  placeholder,
  fill,
  sendWithCmdEnter = false,
  toolbarLeft,
  toolbarRight,
  queuePanel,
  editing,
  onSaveEdit,
  onCancelEdit,
  onSend,
  onStop,
}: ComposerProps) {
  const [value, setValue] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editValue, setEditValue] = useState('');
  const textarea = useRef<HTMLTextAreaElement>(null);
  const restoreFocus = useRef(false);
  const text = editing ? editValue : value;
  const displayedAttachments = editing?.attachments ?? attachments;
  const canSend = (text.trim().length > 0 || displayedAttachments.length > 0) && !disabled && !submitting;

  useEffect(() => {
    const editor = textarea.current!;
    const cancelRestore = (event: PointerEvent) => {
      if (!editor.contains(event.target as Node)) restoreFocus.current = false;
    };
    document.addEventListener('pointerdown', cancelRestore, true);
    return () => document.removeEventListener('pointerdown', cancelRestore, true);
  }, []);

  useLayoutEffect(() => {
    if (submitting || !restoreFocus.current) return;
    restoreFocus.current = false;
    const editor = textarea.current!;
    if (canRestoreComposerFocus(editor)) editor.focus({ preventScroll: true });
  }, [submitting]);

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
    if (!editing) return;
    setEditValue(editing.prompt);
    textarea.current?.focus();
  }, [editing]);

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
  }, [text]);

  const submit = async () => {
    if (!canSend) return;
    restoreFocus.current = document.activeElement === textarea.current;
    setSubmitting(true);
    try {
      if (editing) {
        await onSaveEdit?.(editValue);
      } else {
        await onSend(value, attachments);
        // The backend has them now, so an unmount must not release them.
        held.current = [];
        setAttachments([]);
        setValue('');
      }
      setAttachError(null);
    } catch (error) { setAttachError(String(error)); }
    finally { setSubmitting(false); }
  };

  return (
    <div
      className={`composer-card flex w-full cursor-text flex-col overflow-hidden rounded-[12px] border bg-[var(--chat-input-bg)] transition-colors duration-[var(--motion-fast)] focus-within:border-[var(--chat-input-border-focus)] ${
        isDragOver ? 'border-[var(--chat-input-border-focus)] ring-2 ring-[var(--focus-ring-soft)]' : 'border-[var(--chat-input-border)]'
      }`}
    >
      {queuePanel}
      {/* Two shared border pixels complete the card's 112/140px minimum. */}
      <div
        className={`composer-input flex flex-col justify-between ${variant === 'new' ? 'min-h-[138px]' : 'min-h-[110px]'}`}
        onMouseDown={(event) => {
          if (event.button !== 0 || !isComposerBlankTarget(event.currentTarget, event.target as Element)) return;
          event.preventDefault();
          textarea.current!.focus({ preventScroll: true });
        }}
      >
        {editing ? (
          <div className="flex items-center justify-between gap-2 px-6 pt-2 text-12 text-[var(--text-secondary)]">
            <span>{t('queueEditing')}</span>
            <button type="button" aria-label={t('queueCancelEdit')} title={t('queueCancelEdit')} disabled={submitting} onClick={() => {
              onCancelEdit?.();
              textarea.current!.focus({ preventScroll: true });
            }}
              className="flex size-6 shrink-0 items-center justify-center rounded-[6px] enabled:hover:bg-[var(--surface-hover)] enabled:hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:cursor-default disabled:opacity-40"><X size={13} aria-hidden /></button>
          </div>
        ) : null}
        {displayedAttachments.length > 0 ? (
          <div className="flex flex-wrap gap-2 px-6 pt-3">
            {displayedAttachments.map((attachment) => (
              <div key={attachment.id} className="relative" title={attachment.path ?? attachment.name}>
                {attachment.preview ? (
                  <ZoomableImage
                    src={attachment.preview}
                    alt={attachment.name}
                    className="size-14 rounded-lg border border-[var(--chat-input-chip-border)] object-cover"
                  />
                ) : (
                  <div className="flex h-14 max-w-[200px] items-center gap-2 rounded-lg border border-[var(--chat-input-chip-border)] bg-[var(--chat-input-chip-bg)] px-3 text-13 text-[var(--chat-input-chip-text)]">
                    <FileText size={16} strokeWidth={1.8} aria-hidden className="shrink-0" />
                    <span className="truncate">{attachment.name}</span>
                  </div>
                )}
                {editing ? null : <button
                  type="button"
                  aria-label={t('removeAttachment', { name: attachment.name })}
                  title={t('removeAttachment', { name: attachment.name })}
                  onClick={() => remove(attachment.id)}
                  className={REMOVE_BUTTON}
                >
                  <X size={10} strokeWidth={2.5} aria-hidden />
                </button>}
              </div>
            ))}
          </div>
        ) : null}
        <textarea
          ref={textarea}
          autoFocus
          rows={1}
          disabled={submitting}
          value={text}
          placeholder={placeholder}
          aria-label={editing ? t('queueEditing') : placeholder}
          onChange={(event) => editing ? setEditValue(event.target.value) : setValue(event.target.value)}
          onPaste={(event) => {
            const files = [...event.clipboardData.files];
            if (files.length === 0) return;
            event.preventDefault();
            if (editing) return;
            void paste(files);
          }}
          onKeyDown={(event) => {
            // Enter also confirms an input method's candidate, which must not send the message.
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
            if (sendWithCmdEnter ? event.metaKey : !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
          className="selectable min-h-[52px] w-full resize-none bg-transparent px-6 pb-1 pt-3 text-15 leading-[1.467] text-[var(--chat-input-text)] outline-none placeholder:text-[var(--chat-input-placeholder)]"
        />
        {attachError ? (
          <p role="alert" className="selectable whitespace-pre-wrap px-6 pb-1 text-12 text-[var(--text-danger)]">
            {attachError}
          </p>
        ) : null}
        <div className="flex items-center justify-between gap-2 px-3 pb-2.5">
          <div className="flex min-w-0 items-center gap-1">
            <button
              type="button"
              aria-label={t('attach')}
              title={t('attach')}
              disabled={Boolean(editing) || submitting}
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
            <div className="flex items-center gap-1" onMouseDown={(event) => {
              // Pointer activation keeps the caret; keyboard focus still belongs to the button.
              if (event.button === 0 && document.activeElement === textarea.current) event.preventDefault();
            }}>
              {running ? (
                <button type="button" aria-label={t('stop')} title={t('stop')} onClick={onStop} className={SEND_BUTTON}>
                  <Square size={11} fill="currentColor" aria-hidden />
                </button>
              ) : null}
              {editing || !running || text.trim() || displayedAttachments.length > 0 ? (
                <button
                  type="button"
                  aria-label={t(editing ? 'queueSave' : queueing ? 'queueSend' : 'send')}
                  title={t(editing ? 'queueSave' : queueing ? 'queueSend' : 'send')}
                  disabled={!canSend}
                  onClick={() => void submit()}
                  className={editing ? `${ACTION_BUTTON} px-3 text-12 font-medium` : SEND_BUTTON}
                >
                  {editing ? t('queueSave') : queueing ? <ListPlus size={15} aria-hidden /> : <ArrowUp size={15} strokeWidth={2.2} aria-hidden />}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
