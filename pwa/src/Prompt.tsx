import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Hand, MessageCircle, Terminal } from 'lucide-react';
import type { Decision, PendingRequest } from './lib/types';
import { t } from './lib/i18n';

export function Prompt({
  request,
  onAnswer,
  disabled,
}: {
  request: PendingRequest;
  onAnswer: (d: Decision) => Promise<void>;
  disabled: boolean;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const compositionEnded = useRef(Number.NEGATIVE_INFINITY);
  const [index, setIndex] = useState(0);
  const [customOpen, setCustomOpen] = useState(false);
  const [commentOpen, setCommentOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [commentAnswer, setCommentAnswer] = useState('');
  const customInput = useRef<HTMLInputElement>(null);
  const customEntry = useRef<HTMLButtonElement>(null);
  const restoreOptions = useRef(false);
  const q = request.type === 'question' ? request.questions[index] : undefined;
  const showCustom = Boolean(q && !commentOpen && (!q.options?.length || customOpen));
  useEffect(() => {
    if (showCustom || commentOpen) customInput.current?.focus();
    else if (restoreOptions.current) { restoreOptions.current = false; customEntry.current?.focus(); }
  }, [index, showCustom, commentOpen]);
  const answer = async (d: Decision) => {
    if (disabled || inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    setError('');
    try {
      await onAnswer(d);
      // The settled event or the next snapshot removes the card.
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      inFlight.current = false;
      setSending(false);
    }
  };
  if (request.type === 'permissionRequest')
    return (
      <section className="prompt-card permission-card" aria-label={t('confirmTool')} aria-busy={sending}>
        <fieldset disabled={disabled || sending}>
          <div className="prompt-eyebrow">
            <Hand size={13} />
            {t('confirmTool')}
          </div>
          <h3>{request.toolName}</h3>
          {request.description && <p className="permission-description">{request.description}</p>}
          <div className="permission-code">
            <Terminal size={13} />
            <pre>{command(request.input)}</pre>
          </div>
          <div className="prompt-actions">
            <button onClick={() => void answer({ kind: 'deny' })}>{t('deny')}</button>
            <span />
            {request.rules.length > 0 && (
              <button title={request.rules.join('、')} onClick={() => void answer({ kind: 'allowForTask' })}>
                {t('allowTask')}
              </button>
            )}
            <button className="primary" onClick={() => void answer({ kind: 'allow' })}>
              {t('allow')}
            </button>
          </div>
        </fieldset>
        {error && (
          <p className="prompt-error" role="alert">
            {error}
          </p>
        )}
      </section>
    );
  if (!q) return null;
  const isLast = index === request.questions.length - 1;
  const closeCustom = () => { restoreOptions.current = true; setCustomOpen(false); setCommentOpen(false); };
  const advance = (value: string, custom = false, note = comment) => {
    if (!value || disabled || inFlight.current) return;
    if (q.allowComment && (!custom || q.multiSelect) && !commentOpen) {
      if (!q.multiSelect) setSelected((old) => ({ ...old, [q.question]: [value] }));
      setCommentAnswer(value);
      setCommentOpen(true); return;
    }
    if (!isLast) {
      setAnswers((old) => ({ ...old, [q.question]: value }));
      setCustomOpen(false);
      setIndex(index + 1);
    } else void answer({ kind: 'answer', answers: { ...answers, [q.question]: value }, ...(custom ? { custom: true } : {}), ...(commentOpen ? { comment: note.trim() } : {}) });
  };
  const value = commentOpen ? commentAnswer : [
    ...(selected[q.question] ?? []),
    ...(showCustom && answers[q.question]?.trim() ? [answers[q.question].trim()] : []),
  ].join(', ');
  const customAnswer = showCustom && Boolean(answers[q.question]?.trim());
  return (
    <section className="prompt-card question-card" aria-label={t('answerQuestion')} aria-busy={sending}>
      <fieldset disabled={disabled || sending}>
        <form
          onCompositionEnd={() => {
            compositionEnded.current = performance.now();
          }}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              (event.nativeEvent.isComposing ||
                event.nativeEvent.keyCode === 229 ||
                performance.now() - compositionEnded.current < 80)
            )
              event.preventDefault();
          }}
          onSubmit={(e) => {
            e.preventDefault();
            advance(value, customAnswer);
          }}
        >
          <div className="question-meta">
            <span className="question-chip">
              <MessageCircle size={12} />
              {q.header || t('answerQuestion')}
            </span>
            {request.questions.length > 1 && (
              <small>
                {index + 1} / {request.questions.length}
              </small>
            )}
          </div>
          <h3>{q.displayQuestion ?? q.question}</h3>
          {q.context ? <div className="question-context">
            <span>{t('questionContext')}</span>
            <p>{q.context}</p>
          </div> : null}
          <div className="question-options">
            {commentOpen ? <div className="question-note">
              <small>{t('questionSelected')}</small><p>{commentAnswer}</p>
              <label htmlFor={`note-${request.requestId}`}>{t('questionComment')}</label>
              <input id={`note-${request.requestId}`} ref={customInput} className="custom-answer" aria-label={t('questionComment')}
                placeholder={t('questionCommentHint')} value={comment} onChange={(event) => setComment(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); closeCustom(); } }} />
            </div> : <>
            {q.options?.map((o, i) => (
              <label
                className={
                  'question-option ' + ((selected[q.question] ?? []).includes(o.label) ? 'selected' : '')
                }
                key={o.label}
              >
                <input
                  type={q.multiSelect ? 'checkbox' : 'radio'}
                  name={q.question}
                  checked={(selected[q.question] ?? []).includes(o.label)}
                  onChange={(e) => {
                    setSelected((old) => ({
                      ...old,
                      [q.question]: q.multiSelect
                        ? e.target.checked
                          ? [...(old[q.question] ?? []), o.label]
                          : old[q.question].filter((x) => x !== o.label)
                        : [o.label],
                    }));
                    if (!q.multiSelect) advance(o.label);
                  }}
                />
                <span className="option-number" aria-hidden>
                  {i + 1}
                </span>
                <span className="option-copy">
                  <strong>{o.label}</strong>
                  {o.description && <small>{o.description}</small>}
                </span>
                <span className="option-indicator" aria-hidden />
              </label>
            ))}
            {!showCustom && q.allowCustom !== false && (
              <button
                ref={customEntry}
                type="button"
                className="question-option"
                aria-expanded={false}
                onClick={() => {
                  if (!q.multiSelect) setSelected((old) => ({ ...old, [q.question]: [] }));
                  setCustomOpen(true);
                }}
              >
                <span className="option-number" aria-hidden>
                  {(q.options?.length ?? 0) + 1}
                </span>
                <span className="option-copy">
                  <strong>{t('custom')}</strong>
                </span>
              </button>
            )}
            {showCustom && (
              <input
                ref={customInput}
                className="custom-answer"
                aria-label={q.displayQuestion ?? q.question}
                placeholder={t('custom')}
                value={answers[q.question] ?? ''}
                onKeyDown={(event) => {
                  if (event.key === 'Escape' && customOpen && q.options?.length && !event.nativeEvent.isComposing) {
                    event.preventDefault(); event.stopPropagation(); closeCustom();
                  }
                }}
                onChange={(e) => setAnswers((old) => ({ ...old, [q.question]: e.target.value }))}
              />
            )}
            </>}
          </div>
          <div className="prompt-actions">
            {(customOpen || commentOpen) && Boolean(q.options?.length) ? <button type="button" onClick={closeCustom}><ArrowLeft size={14} aria-hidden />{t('backOptions')}</button> : null}
            <button type="button" onClick={() => commentOpen ? advance(value, false, '') : void answer({ kind: 'deny' })}>
              {t(commentOpen ? 'questionSkipComment' : 'cancel')}
            </button>
            <span />
            <button className="primary" disabled={!value}>
              {isLast ? t('answer') : t('next')}
            </button>
          </div>
        </form>
      </fieldset>
      {error && (
        <p className="prompt-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
function command(input: string) {
  try {
    const value = JSON.parse(input);
    return value.command ?? value.file_path ?? JSON.stringify(value, null, 2);
  } catch {
    return input;
  }
}
