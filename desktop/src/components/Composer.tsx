import { ArrowUp, FileText, ListPlus, Plus, Square, X } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import { isImeKey } from '../lib/ime';
import { continueList } from '../lib/listContinuation';
import { codeRanges, completeCodeFence, codeKeyEdit, type CodeEdit } from '../lib/fencedCode';
import type { CodeComposerHandle, ComposerKeyEvent } from '../lib/composerEditor';
import { useComposerResize } from '../lib/useComposerResize';
import { browseInputHistory, inputHistoryDirection, type InputHistoryNavigation } from '../lib/recallInput';
import { revealTextareaCaret } from '../lib/textareaLayout';

const CodeComposer = lazy(() => import('./CodeComposer'));
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

import { composerDrafts as drafts } from '../lib/composerDrafts';

interface ComposerProps {
  /** Which draft this composer edits: a task's id, or the new-task page. */
  draftKey: string;
  variant?: 'task' | 'new';
  running: boolean;
  queueing?: boolean;
  disabled?: boolean;
  placeholder: string;
  /** Replaces the draft whenever a new object arrives, so the same text can be filled twice. */
  fill?: { text: string };
  inputHistory?: readonly string[];
  sendWithCmdEnter?: boolean;
  toolbarLeft: ReactNode;
  toolbarRight: ReactNode;
  queuePanel?: ReactNode;
  editing?: QueuedMessage;
  onSaveEdit?: (prompt: string, attachments: Attachment[]) => Promise<void>;
  onCancelEdit?: () => void;
  /** `alternate` is the second shortcut: while a turn runs it picks the other of adding to it and queueing. */
  onSend: (prompt: string, attachments: Attachment[], alternate?: boolean) => void | Promise<void>;
  onStop: () => void;
  /** What stopping ends, when it is more than the reply being written. */
  stopLabel?: string;
  /** Text to put back, such as a stopped prompt the CLI never recorded. An existing draft wins. */
  restored?: { id: string; text: string };
  onRestored?: () => void;
}

export function Composer({
  draftKey,
  variant = 'task',
  running,
  queueing = running,
  disabled = false,
  placeholder,
  fill,
  inputHistory = [],
  sendWithCmdEnter = false,
  toolbarLeft,
  toolbarRight,
  queuePanel,
  editing,
  onSaveEdit,
  onCancelEdit,
  onSend,
  onStop,
  stopLabel = t('stop'),
  restored,
  onRestored,
}: ComposerProps) {
  const [value, setValue] = useState(() => drafts.get(draftKey)?.value ?? '');
  const [attachments, setAttachments] = useState<Attachment[]>(() => drafts.get(draftKey)?.attachments ?? []);
  useEffect(() => {
    if (value || attachments.length) drafts.set(draftKey, { value, attachments });
    else drafts.delete(draftKey);
  }, [draftKey, value, attachments]);
  useEffect(() => {
    if (!restored) return;
    if (!value.trim() && !editing) setValue(restored.text);
    onRestored?.();
  }, [restored?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [attachError, setAttachError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editValue, setEditValue] = useState(editing?.prompt ?? '');
  const [editAttachments, setEditAttachments] = useState<Attachment[]>(editing?.attachments ?? []);
  const [addingAttachments, setAddingAttachments] = useState(0);
  const attachmentTarget = useRef({ editing: Boolean(editing), added: new Set<string>(), active: true, pending: 0 });
  const submittingRef = useRef(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const codeEditor = useRef<CodeComposerHandle | null>(null);
  const inputElement = () => codeEditor.current?.dom ?? textarea.current;
  const focusInput = () => codeEditor.current ? codeEditor.current.focus() : textarea.current?.focus({ preventScroll: true });
  const [activatedCodeEditor, setActivatedCodeEditor] = useState(false);
  const codeConversion = useRef<{ before: string; after: string } | null>(null);
  const inputArea = useRef<HTMLDivElement>(null);
  const resize = useComposerResize(inputArea, draftKey, variant);
  /** Programmatic edits restore the viewport and caret after the final height is measured. */
  const pendingCaret = useRef<{ at: number; scrollTop: number } | null>(null);
  const restoreFocus = useRef(false);
  const historyNavigation = useRef<InputHistoryNavigation | null>(null);
  const text = editing ? editValue : value;
  const hasCode = useMemo(() => codeRanges(text).some((range) => range.bodyFrom <= text.length), [text]);
  const structured = activatedCodeEditor || hasCode;
  useEffect(() => { if (hasCode) setActivatedCodeEditor(true); }, [hasCode]);
  const displayedAttachments = editing ? editAttachments : attachments;
  const canSend = (text.trim().length > 0 || displayedAttachments.length > 0) && !disabled && !submitting && addingAttachments === 0;

  useEffect(() => {
    const cancelRestore = (event: PointerEvent) => {
      if (!inputElement()?.contains(event.target as Node)) restoreFocus.current = false;
    };
    document.addEventListener('pointerdown', cancelRestore, true);
    return () => document.removeEventListener('pointerdown', cancelRestore, true);
  }, []);

  useLayoutEffect(() => {
    if (submitting || !restoreFocus.current) return;
    restoreFocus.current = false;
    const editor = inputElement();
    if (editor && canRestoreComposerFocus(editor)) focusInput();
  }, [submitting]);

  useEffect(() => { historyNavigation.current = null; }, [draftKey]);

  // The saved draft keeps its attachments, so the backend holds them until they are sent or removed.

  const addResult = useCallback(({ added, errors }: AddResult, target = attachmentTarget.current) => {
    if (!target.active || submittingRef.current) {
      for (const { id } of added) void removeAttachment(id);
      return;
    }
    if (added.length) historyNavigation.current = null;
    if (target.editing) {
      for (const { id } of added) target.added.add(id);
      setEditAttachments((current) => [...current, ...added]);
    } else setAttachments((current) => [...current, ...added]);
    setAttachError(errors.length > 0 ? errors.join('\n') : null);
    focusInput();
  }, []);

  useLayoutEffect(() => {
    historyNavigation.current = null;
    const target = { editing: Boolean(editing), added: new Set<string>(), active: true, pending: 0 };
    attachmentTarget.current = target;
    setAddingAttachments(0);
    setAttachError(null);
    if (editing) {
      setEditValue(editing.prompt);
      setEditAttachments(editing.attachments);
      focusInput();
    }
    return () => {
      target.active = false;
      if (target.editing) for (const id of target.added) void removeAttachment(id);
    };
  }, [editing]);

  const loadAttachments = async (load: () => Promise<AddResult>) => {
    const target = attachmentTarget.current;
    target.pending += 1;
    setAddingAttachments(target.pending);
    try { addResult(await load(), target); }
    catch (error) { if (target.active) setAttachError(String(error)); }
    finally {
      target.pending -= 1;
      if (target.active) setAddingAttachments(target.pending);
    }
  };

  useEffect(() => {
    const unlisten = [onAttachmentsDropped(addResult), onAttachmentDrag(setIsDragOver)];
    return () => {
      for (const stop of unlisten) void stop.then((run) => run());
    };
  }, [addResult]);

  const remove = (id: string) => {
    historyNavigation.current = null;
    const target = attachmentTarget.current;
    if (target.editing) {
      setEditAttachments((current) => current.filter((attachment) => attachment.id !== id));
      if (target.added.delete(id)) void removeAttachment(id);
    } else {
      setAttachments((current) => current.filter((attachment) => attachment.id !== id));
      void removeAttachment(id);
    }
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
    return { added, errors };
  };

  useEffect(() => {
    if (!fill) return;
    historyNavigation.current = null;
    setValue(fill.text);
    focusInput();
  }, [fill]);

  useLayoutEffect(() => {
    if (codeEditor.current) { pendingCaret.current = null; return; }
    const element = textarea.current;
    if (!element) return;
    const pending = pendingCaret.current;
    const scrollTop = pending?.scrollTop ?? element.scrollTop;
    if (resize.height !== null) element.style.height = '100%';
    else {
      element.style.height = 'auto';
      element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT_PX)}px`;
    }
    if (pending) element.setSelectionRange(pending.at, pending.at);
    element.scrollTop = scrollTop;
    if (pending) revealTextareaCaret(element, pending.at);
    if (!structured) pendingCaret.current = null;
  }, [text, resize.height, structured]);

  const applyEdit = (edit: CodeEdit) => {
    historyNavigation.current = null;
    if (codeEditor.current) { codeEditor.current.replaceSource(edit.value, edit.caret); return; }
    const element = textarea.current;
    const scrollTop = element?.scrollTop ?? 0;
    if (edit.value === text && element) {
      element.setSelectionRange(edit.caret, edit.caret);
      element.scrollTop = scrollTop;
      revealTextareaCaret(element, edit.caret);
      return;
    }
    pendingCaret.current = { at: edit.caret, scrollTop };
    if (editing) setEditValue(edit.value);
    else setValue(edit.value);
  };

  const handleKeyDown = (event: ComposerKeyEvent) => {
    // Enter also confirms an input method's candidate, which must not send the message.
    if (isImeKey(event)) return;
    const box = event.currentTarget;
    const direction = inputHistoryDirection(event);
    if (!disabled && !submitting && addingAttachments === 0 && displayedAttachments.length === 0 && !editing && direction) {
      const next = browseInputHistory(inputHistory, historyNavigation.current, text, direction);
      if (next) {
        event.preventDefault();
        historyNavigation.current = next.navigation;
        pendingCaret.current = { at: next.value.length, scrollTop: box.scrollTop };
        if (next.value === text) {
          box.setSelectionRange(next.value.length, next.value.length);
          pendingCaret.current = null;
        }
        if (codeEditor.current) codeEditor.current.replaceSource(next.value, next.value.length);
        else setValue(next.value);
        return;
      }
    }
    if (event.key !== 'Enter') {
      if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
        const edit = codeKeyEdit(box.value, box.selectionStart, box.selectionEnd, event.key);
        if (edit) { event.preventDefault(); applyEdit(edit); }
      }
      return;
    }
    // Resolve sending before code editing so the shortcut applies throughout the draft.
    const primary = sendWithCmdEnter ? event.metaKey && !event.shiftKey : !event.shiftKey && !event.metaKey;
    const alternate = sendWithCmdEnter ? event.metaKey && event.shiftKey : event.metaKey && !event.shiftKey;
    if (primary || alternate) {
      event.preventDefault();
      void submit(alternate);
      return;
    }
    if (!event.metaKey && !event.ctrlKey && !event.altKey) {
      const edit = codeKeyEdit(box.value, box.selectionStart, box.selectionEnd, 'Enter');
      if (edit) { event.preventDefault(); applyEdit(edit); return; }
    }
    // Newline shortcuts carry a typed list on to its next item.
    if (box.selectionStart !== box.selectionEnd) return;
    const edit = continueList(box.value, box.selectionStart);
    if (!edit) return;
    event.preventDefault();
    applyEdit(edit);
  };

  const submit = async (alternate = false) => {
    if (!canSend || attachmentTarget.current.pending > 0 || submittingRef.current) return;
    historyNavigation.current = null;
    restoreFocus.current = Boolean(inputElement()?.contains(document.activeElement));
    submittingRef.current = true;
    setSubmitting(true);
    try {
      if (editing) {
        await onSaveEdit?.(editValue, editAttachments);
      } else {
        await onSend(value, attachments, alternate);
        setAttachments([]);
        setValue('');
      }
      setAttachError(null);
    } catch (error) { setAttachError(String(error)); }
    finally { submittingRef.current = false; setSubmitting(false); }
  };

  const plainInput = (
        <textarea
          ref={textarea}
          autoFocus
          rows={1}
          disabled={submitting}
          value={text}
          placeholder={placeholder}
          aria-label={editing ? t('queueEditing') : placeholder}
          onChange={(event) => {
            historyNavigation.current = null;
            const box = event.currentTarget;
            const input = event.nativeEvent as InputEvent;
            const edit = !input.isComposing && input.inputType === 'insertText'
              ? completeCodeFence(text, box.value, box.selectionStart) : null;
            if (edit) {
              if (!structured) codeConversion.current = { before: text, after: edit.value };
              applyEdit(edit);
            } else {
              if (codeRanges(box.value).some((range) => range.bodyFrom <= box.value.length)) {
                if (!structured) codeConversion.current = { before: text, after: box.value };
                pendingCaret.current = { at: box.selectionStart, scrollTop: box.scrollTop };
              }
              if (editing) setEditValue(box.value); else setValue(box.value);
            }
          }}
          onPaste={(event) => {
            const files = [...event.clipboardData.files];
            if (files.length === 0) return;
            event.preventDefault();
            void loadAttachments(() => paste(files));
          }}
          onKeyDown={handleKeyDown}
          className="composer-content-inset composer-editor selectable relative block min-h-[52px] w-full resize-none bg-transparent pb-1 pt-3 text-15 leading-[1.467] text-[var(--chat-input-text)] outline-none placeholder:text-[var(--chat-input-placeholder)]"
        />
  );

  return (
    <div
      className={`composer-card relative flex w-full cursor-text flex-col overflow-hidden rounded-[12px] border bg-[var(--chat-input-bg)] transition-colors duration-[var(--motion-fast)] focus-within:border-[var(--chat-input-border-focus)] ${
        isDragOver ? 'border-[var(--chat-input-border-focus)] ring-2 ring-[var(--focus-ring-soft)]' : 'border-[var(--chat-input-border)]'
      }`}
    >
      <div role="separator" tabIndex={0} aria-orientation="horizontal" aria-label={t('composerResize')}
        aria-valuemin={resize.range.min + 2} aria-valuemax={resize.range.max + 2} aria-valuenow={(resize.height ?? inputArea.current?.offsetHeight ?? resize.range.min) + 2}
        onPointerDown={resize.start} onDoubleClick={() => resize.resize(null)}
        onKeyDown={(event) => {
          if (isImeKey(event) || event.metaKey || event.ctrlKey || event.altKey) return;
          const height = resize.height ?? inputArea.current?.offsetHeight ?? resize.range.min;
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); resize.resize(height + (event.key === 'ArrowUp' ? 16 : -16)); }
          else if (event.key === 'Home') { event.preventDefault(); resize.resize(null); }
          else if (event.key === 'End') { event.preventDefault(); resize.resize(resize.range.max); }
        }}
        className="absolute inset-x-0 top-0 z-10 h-1.5 cursor-ns-resize touch-none outline-none focus-visible:bg-[var(--focus-ring-soft)]" />
      {queuePanel}
      {/* Two shared border pixels complete the card's 112/140px minimum. */}
      <div
        ref={inputArea}
        style={resize.height === null ? undefined : { height: resize.height, minHeight: resize.range.min }}
        className={`composer-input flex flex-col justify-between ${variant === 'new' ? 'min-h-[138px]' : 'min-h-[110px]'}`}
        onMouseDown={(event) => {
          if (event.button !== 0 || !isComposerBlankTarget(event.currentTarget, event.target as Element)) return;
          event.preventDefault();
          focusInput();
        }}
      >
        {editing ? (
          <div className="composer-content-inset flex shrink-0 items-center justify-between gap-2 pt-2 text-12 text-[var(--text-secondary)]">
            <span>{t('queueEditing')}</span>
            <button type="button" aria-label={t('queueCancelEdit')} data-tooltip={t('queueCancelEdit')} disabled={submitting} onClick={() => {
              onCancelEdit?.();
              focusInput();
            }}
              className="flex size-6 shrink-0 items-center justify-center rounded-[6px] enabled:hover:bg-[var(--surface-hover)] enabled:hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:cursor-default disabled:opacity-40"><X size={13} aria-hidden /></button>
          </div>
        ) : null}
        {displayedAttachments.length > 0 ? (
          <div style={resize.height === null ? undefined : { maxHeight: 80, overflowY: 'auto' }} className="composer-content-inset flex flex-wrap gap-2 pt-3 shrink-0">
            {displayedAttachments.map((attachment) => (
              <div key={attachment.id} className="relative" data-tooltip={attachment.path ?? attachment.name}>
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
                <button
                  type="button"
                  aria-label={t('removeAttachment', { name: attachment.name })}
                  data-tooltip={t('removeAttachment', { name: attachment.name })}
                  disabled={submitting}
                  onClick={() => remove(attachment.id)}
                  className={REMOVE_BUTTON}
                >
                  <X size={10} strokeWidth={2.5} aria-hidden />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <div data-composer-editor className={`relative min-h-[52px] ${resize.height === null ? '' : 'flex-1 min-h-0'} ${structured ? 'composer-structured' : ''}`}>
          {structured ? <Suspense fallback={plainInput}>
            <CodeComposer value={text} label={editing ? t('queueEditing') : placeholder} placeholder={placeholder}
              disabled={submitting} resetKey={editing?.id ?? draftKey} editorRef={codeEditor}
              initialCaret={pendingCaret.current?.at}
              previousSource={codeConversion.current?.after === text ? codeConversion.current.before : undefined}
              onReady={() => { codeConversion.current = null; pendingCaret.current = null; }}
              onChange={(source, userInput) => {
                if (userInput) historyNavigation.current = null;
                if (editing) setEditValue(source); else setValue(source);
              }} onKeyDown={handleKeyDown} onPasteImages={(files) => void loadAttachments(() => paste(files))} />
          </Suspense> : plainInput}
        </div>
        {attachError ? (
          <p role="alert" className="composer-content-inset selectable max-h-[60px] shrink-0 overflow-y-auto whitespace-pre-wrap pb-1 text-12 text-[var(--text-danger)]">
            {attachError}
          </p>
        ) : null}
        <div className="composer-content-inset flex items-center justify-between gap-2 pb-2.5 shrink-0">
          <div className="flex min-w-0 items-center gap-1">
            <button
              type="button"
              aria-label={t('attach')}
              data-tooltip={t('attach')}
              disabled={submitting}
              onClick={() => void loadAttachments(pickAttachments)}
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
              if (event.button === 0 && inputElement()?.contains(document.activeElement)) event.preventDefault();
            }}>
              {running ? (
                <button type="button" aria-label={stopLabel} data-tooltip={stopLabel} onClick={onStop} className={SEND_BUTTON}>
                  <Square size={11} fill="currentColor" aria-hidden />
                </button>
              ) : null}
              {editing || !running || text.trim() || displayedAttachments.length > 0 ? (
                <button
                  type="button"
                  aria-label={t(editing ? 'queueSave' : queueing ? 'queueSend' : 'send')}
                  data-tooltip={t(editing ? 'queueSave' : queueing ? 'queueSend' : 'send')}
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
