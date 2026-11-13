import { ArrowLeft, Check } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Decision, PendingRequest, Question } from '../lib/api';
import { t } from '../lib/i18n';
import { isImeKey } from '../lib/ime';

const MULTI_SEPARATOR = ', ';
const SHORTCUT_DELAY_MS = 500;
const FOOTER_BUTTON = 'h-7 rounded-full px-2.5 text-12 text-[var(--text-secondary)] hover:bg-[var(--ask-option-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:opacity-50';
const OPTION_ROW = 'flex min-h-9 w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-[var(--ask-option-hover)] aria-pressed:bg-[var(--ask-option-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)]';
const BADGE = 'flex size-5 shrink-0 items-center justify-center rounded-[6px] bg-[var(--ask-badge-bg)] text-12 text-[var(--ask-badge-text)]';

interface QuestionPromptProps {
  request: Extract<PendingRequest, { type: 'question' }>;
  onAnswer: (decision: Decision) => void;
  submitting?: boolean;
}

function Checkbox({ checked }: { checked: boolean }) {
  return <span className={`flex size-4 shrink-0 items-center justify-center rounded-[4px] ${checked ? 'bg-[var(--ask-checkbox-checked-bg)]' : 'border-[1.5px] border-[var(--ask-checkbox-border)]'}`}>
    {checked ? <Check size={12} strokeWidth={3} aria-hidden className="text-[var(--ask-checkbox-checked-icon)]" /> : null}
  </span>;
}

/** Choice, free text and optional notes stay in one card until their native answer is submitted. */
export function QuestionPrompt({ request, onAnswer, submitting = false }: QuestionPromptProps) {
  const questions: Question[] = request.questions;
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [custom, setCustom] = useState('');
  const [customOpen, setCustomOpen] = useState(false);
  const [commentOpen, setCommentOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [commentAnswer, setCommentAnswer] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const customEntry = useRef<HTMLButtonElement>(null);
  const selectedEntry = useRef<HTMLButtonElement>(null);
  const restoreOptions = useRef(false);
  const current = questions[index];
  const options = current?.options ?? [];
  const allowCustom = current?.allowCustom !== false;
  const showCustom = !commentOpen && (options.length === 0 || customOpen);
  const isMulti = current?.multiSelect === true;
  const isLast = index >= questions.length - 1;
  useEffect(() => {
    if (showCustom || commentOpen) input.current?.focus();
    else if (restoreOptions.current) { restoreOptions.current = false; (selectedEntry.current ?? customEntry.current)?.focus(); }
  }, [index, showCustom, commentOpen]);

  const advance = (answer: string, customAnswer = false, note = comment) => {
    if (!current || submitting) return;
    if (current.allowComment && (!customAnswer || isMulti) && !commentOpen) {
      if (!isMulti) setSelected([answer]);
      setCommentAnswer(answer);
      setCommentOpen(true);
      return;
    }
    const next = { ...answers, [current.question]: answer };
    if (isLast) {
      onAnswer({ kind: 'answer', answers: next, ...(customAnswer ? { custom: true } : {}), ...(commentOpen ? { comment: note.trim() } : {}) });
      return;
    }
    setAnswers(next); setIndex(index + 1); setSelected([]); setCustom(''); setCustomOpen(false); setCommentOpen(false); setComment('');
  };
  const chooseOption = (label: string) => {
    if (!isMulti) { advance(label); return; }
    setSelected((labels) => labels.includes(label) ? labels.filter((item) => item !== label) : [...labels, label]);
  };
  const openCustom = () => setCustomOpen(true);
  const closeCustom = () => { restoreOptions.current = true; setCustomOpen(false); setCommentOpen(false); };
  const shortcuts = useRef({ chooseOption, options, onAnswer, openCustom, closeCustom, customOpen, commentOpen, allowCustom });
  shortcuts.current = { chooseOption, options, onAnswer, openCustom, closeCustom, customOpen, commentOpen, allowCustom };
  useEffect(() => {
    if (submitting) return;
    const shownAt = Date.now();
    const onKeyDown = (event: KeyboardEvent) => {
      if (isImeKey(event) || event.repeat || Date.now() - shownAt < SHORTCUT_DELAY_MS) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        if ((shortcuts.current.customOpen || shortcuts.current.commentOpen) && shortcuts.current.options.length > 0) shortcuts.current.closeCustom();
        else shortcuts.current.onAnswer({ kind: 'deny' });
        return;
      }
      if (shortcuts.current.commentOpen) return;
      const focus = document.activeElement;
      if (focus instanceof HTMLInputElement || focus instanceof HTMLTextAreaElement || (focus instanceof HTMLElement && focus.isContentEditable)) return;
      const number = Number(event.key);
      const option = shortcuts.current.options[number - 1];
      if (option) { event.preventDefault(); shortcuts.current.chooseOption(option.label); }
      else if (shortcuts.current.allowCustom && number === shortcuts.current.options.length + 1) { event.preventDefault(); shortcuts.current.openCustom(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [request.requestId, submitting]);

  const multiAnswer = [...selected, ...(showCustom && custom.trim() ? [custom.trim()] : [])].join(MULTI_SEPARATOR);
  const typedAnswer = commentOpen ? commentAnswer : isMulti ? multiAnswer : showCustom ? custom.trim() : '';
  const isCustomAnswer = showCustom && Boolean(custom.trim());
  const inputKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (isImeKey(event)) return;
    if (event.key === 'Escape' && options.length > 0) { event.preventDefault(); event.stopPropagation(); closeCustom(); }
    if (event.key === 'Enter' && typedAnswer) { event.preventDefault(); advance(typedAnswer, isCustomAnswer); }
  };

  return <div aria-busy={submitting} className="mb-2.5 flex max-h-[min(520px,55vh)] w-full flex-col rounded-xl border border-[var(--ask-card-border)] bg-[var(--ask-card-bg)] p-3">
    {current?.header ? <span className="mb-2 w-fit max-w-full truncate rounded-[6px] bg-[var(--ask-header-chip-bg)] px-2 py-0.5 text-12 font-medium text-[var(--ask-badge-text)]">{current.header}</span> : null}
    <div className="flex shrink-0 items-start justify-between gap-4">
      <p className="selectable min-w-0 whitespace-pre-wrap break-words text-15 font-medium leading-5 text-[var(--ask-header-text)]">{current?.displayQuestion ?? current?.question}</p>
      {questions.length > 1 ? <span className="shrink-0 text-12 text-[var(--ask-page-text)]">{index + 1} / {questions.length}</span> : null}
    </div>
    {current?.context ? <div className="mt-2 max-h-20 shrink-0 overflow-y-auto text-[var(--ask-option-desc)]">
      <p className="text-12 font-medium">{t('questionContext')}</p>
      <p className="selectable mt-1 whitespace-pre-wrap break-words text-13 font-normal leading-5">{current.context}</p>
    </div> : null}
    <div className="mt-3 min-h-0 overflow-y-auto rounded-[8px] border border-[var(--ask-option-border)] bg-[var(--ask-option-list-bg)]">
      {commentOpen ? <div className="p-3">
        <p className="text-12 text-[var(--ask-option-desc)]">{t('questionSelected')}</p>
        <p className="mt-1 whitespace-pre-wrap text-13 font-medium text-[var(--ask-option-label)]">{commentAnswer}</p>
        <label className="mt-3 block text-12 text-[var(--ask-option-desc)]" htmlFor={`comment-${request.requestId}`}>{t('questionComment')}</label>
        <input ref={input} id={`comment-${request.requestId}`} disabled={submitting} value={comment} onChange={(event) => setComment(event.target.value)}
          placeholder={t('questionCommentHint')} aria-label={t('questionComment')} onKeyDown={inputKey}
          className="selectable mt-1 w-full rounded-[6px] border border-[var(--ask-input-border)] bg-[var(--ask-input-bg)] px-2 py-1.5 text-13 text-[var(--ask-input-text)] outline-none focus:border-[var(--chat-input-border-focus)]" />
      </div> : <>
        {options.map((option, optionIndex) => <div key={option.label}>
          {optionIndex > 0 ? <div className="h-px bg-[var(--ask-option-divider)]" /> : null}
          <button ref={option.label === selected[0] ? selectedEntry : undefined} type="button" disabled={submitting} aria-pressed={selected.includes(option.label)} onClick={() => chooseOption(option.label)} className={OPTION_ROW}>
            {isMulti ? <Checkbox checked={selected.includes(option.label)} /> : null}
            <span className="min-w-0 flex-1"><span className="block text-14 leading-5 text-[var(--ask-option-label)]">{option.label}</span>
              {option.description ? <span className="mt-0.5 block text-13 leading-5 text-[var(--ask-option-desc)]">{option.description}</span> : null}</span>
            <span aria-hidden className={BADGE}>{optionIndex + 1}</span>
          </button>
        </div>)}
        {options.length > 0 && (allowCustom || showCustom) ? <div className="h-px bg-[var(--ask-option-divider)]" /> : null}
        {!showCustom && allowCustom ? <button ref={customEntry} type="button" disabled={submitting} onClick={openCustom} aria-expanded={false} className={OPTION_ROW}>
          {isMulti ? <Checkbox checked={false} /> : null}<span className="min-w-0 flex-1 text-14 italic text-[var(--ask-option-custom)]">{t('questionOther')}</span>
          <span aria-hidden className={BADGE}>{options.length + 1}</span>
        </button> : null}
        {showCustom ? <div className="flex min-h-9 items-center gap-2 px-3 py-1.5"><input ref={input} disabled={submitting} value={custom} placeholder={t('questionOther')} aria-label={t('questionOther')}
          onChange={(event) => setCustom(event.target.value)} onKeyDown={inputKey}
          className="selectable min-w-0 flex-1 bg-transparent text-14 text-[var(--ask-input-text)] outline-none placeholder:italic placeholder:text-[var(--ask-input-placeholder)]" /></div> : null}
      </>}
    </div>
    <div className="mt-2 flex shrink-0 items-center justify-end gap-2">
      {(customOpen || commentOpen) && options.length > 0 ? <button type="button" disabled={submitting} onClick={closeCustom} className={`mr-auto inline-flex items-center gap-1.5 ${FOOTER_BUTTON}`}><ArrowLeft size={14} aria-hidden />{t('questionBackOptions')}</button> : null}
      <button type="button" disabled={submitting} onClick={() => commentOpen ? advance(typedAnswer, false, '') : onAnswer({ kind: 'deny' })} className={FOOTER_BUTTON}>{t(commentOpen ? 'questionSkipComment' : 'questionSkip')}</button>
      <button type="button" disabled={submitting || !typedAnswer} onClick={() => advance(typedAnswer, isCustomAnswer)}
        className="h-7 rounded-full bg-[var(--ask-send-bg)] px-2.5 text-12 font-medium text-[var(--ask-send-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:bg-[var(--ask-send-disabled-bg)] disabled:text-[var(--ask-send-disabled-text)]">{isLast ? t('questionSubmit') : t('questionNext')}</button>
    </div>
  </div>;
}
