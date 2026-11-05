import { Check } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Decision, PendingRequest, Question } from '../lib/api';
import { t } from '../lib/i18n';

const MULTI_SEPARATOR = ', ';

/** A key press meant for the input box must not answer a question that has just appeared. */
const SHORTCUT_DELAY_MS = 500;

const FOOTER_BUTTON =
  'h-8 rounded-full px-3 text-13 font-medium text-[var(--text-secondary)] hover:bg-[var(--ask-option-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]';

interface QuestionPromptProps {
  request: Extract<PendingRequest, { type: 'question' }>;
  onAnswer: (decision: Decision) => void;
}

function Checkbox({ checked }: { checked: boolean }) {
  return (
    <span
      className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] ${
        checked ? 'bg-[var(--ask-checkbox-checked-bg)]' : 'border-[1.5px] border-[var(--ask-checkbox-border)]'
      }`}
    >
      {checked ? <Check size={13} strokeWidth={3} aria-hidden className="text-[var(--ask-checkbox-checked-icon)]" /> : null}
    </span>
  );
}

/** Replaces the input box while the agent waits for an answer. */
export function QuestionPrompt({ request, onAnswer }: QuestionPromptProps) {
  const questions: Question[] = request.questions;
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [custom, setCustom] = useState('');
  const current = questions[index];
  const options = current?.options ?? [];
  const isMulti = current?.multiSelect === true;
  const isLast = index >= questions.length - 1;

  const advance = (answer: string) => {
    if (!current) return;
    const next = { ...answers, [current.question]: answer };
    if (isLast) {
      onAnswer({ kind: 'answer', answers: next });
      return;
    }
    setAnswers(next);
    setIndex(index + 1);
    setSelected([]);
    setCustom('');
  };

  const chooseOption = (label: string) => {
    if (!isMulti) {
      advance(label);
      return;
    }
    setSelected((labels) => (labels.includes(label) ? labels.filter((item) => item !== label) : [...labels, label]));
  };

  const shortcuts = useRef({ chooseOption, options, onAnswer });
  shortcuts.current = { chooseOption, options, onAnswer };
  useEffect(() => {
    const shownAt = Date.now();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.repeat || Date.now() - shownAt < SHORTCUT_DELAY_MS) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        shortcuts.current.onAnswer({ kind: 'deny' });
        return;
      }
      // Digits typed into the answer box are part of the answer.
      if (document.activeElement instanceof HTMLInputElement) return;
      const option = shortcuts.current.options[Number(event.key) - 1];
      if (option) {
        event.preventDefault();
        shortcuts.current.chooseOption(option.label);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [request.requestId]);

  const multiAnswer = [...selected, ...(custom.trim() ? [custom.trim()] : [])].join(MULTI_SEPARATOR);
  const typedAnswer = isMulti ? multiAnswer : custom.trim();

  return (
    <div className="w-full rounded-xl border border-[var(--ask-card-border)] bg-[var(--ask-card-bg)] p-4">
      {current?.header ? (
        <span className="mb-3 inline-block max-w-full truncate rounded-[6px] bg-[var(--ask-header-chip-bg)] px-2 py-0.5 text-12 font-medium text-[var(--ask-badge-text)]">
          {current.header}
        </span>
      ) : null}
      <div className="flex items-start justify-between gap-4">
        <p className="selectable min-w-0 whitespace-pre-wrap break-words text-15 font-medium text-[var(--ask-header-text)]">
          {current?.question}
        </p>
        {questions.length > 1 ? (
          <span className="shrink-0 text-13 text-[var(--ask-page-text)]">
            {index + 1} / {questions.length}
          </span>
        ) : null}
      </div>
      <div className="mt-4 overflow-hidden rounded-[12px] border border-[var(--ask-option-border)] bg-[var(--ask-option-list-bg)]">
        {options.map((option, optionIndex) => (
          <div key={option.label}>
            {optionIndex > 0 ? <div className="h-px bg-[var(--ask-option-divider)]" /> : null}
            <button
              type="button"
              aria-pressed={isMulti ? selected.includes(option.label) : undefined}
              onClick={() => chooseOption(option.label)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--ask-option-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)]"
            >
              {isMulti ? <Checkbox checked={selected.includes(option.label)} /> : null}
              <span className="min-w-0 flex-1">
                <span className="block text-14 text-[var(--ask-option-label)]">{option.label}</span>
                {option.description ? (
                  <span className="mt-0.5 block text-13 text-[var(--ask-option-desc)]">{option.description}</span>
                ) : null}
              </span>
              <span
                aria-hidden
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-[var(--ask-badge-bg)] text-13 font-medium text-[var(--ask-badge-text)]"
              >
                {optionIndex + 1}
              </span>
            </button>
          </div>
        ))}
        {options.length > 0 ? <div className="h-px bg-[var(--ask-option-divider)]" /> : null}
        <div className="flex items-center gap-2 px-4 py-2.5">
          <input
            value={custom}
            placeholder={t('questionOther')}
            aria-label={t('questionOther')}
            onChange={(event) => setCustom(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing && typedAnswer) {
                event.preventDefault();
                advance(typedAnswer);
              }
            }}
            className="selectable min-w-0 flex-1 bg-transparent text-14 text-[var(--ask-input-text)] outline-none placeholder:italic placeholder:text-[var(--ask-input-placeholder)]"
          />
        </div>
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        <button type="button" onClick={() => onAnswer({ kind: 'deny' })} className={FOOTER_BUTTON}>
          {t('questionSkip')}
        </button>
        <button
          type="button"
          disabled={!typedAnswer}
          onClick={() => advance(typedAnswer)}
          className="h-8 rounded-full bg-[var(--ask-send-bg)] px-3 text-13 font-medium text-[var(--ask-send-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:bg-[var(--ask-send-disabled-bg)] disabled:text-[var(--ask-send-disabled-text)]"
        >
          {isLast ? t('questionSubmit') : t('questionNext')}
        </button>
      </div>
    </div>
  );
}
