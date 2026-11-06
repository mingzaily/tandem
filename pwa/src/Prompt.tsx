import { useState } from 'react';
import { Hand, MessageCircle, Terminal } from 'lucide-react';
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
  const [index, setIndex] = useState(0);
  const answer = async (d: Decision) => {
    setSending(true);
    try {
      await onAnswer(d);
    } finally {
      setSending(false);
    }
  };
  if (request.type === 'permissionRequest')
    return (
      <section className="prompt-card permission-card" aria-label={t('confirmTool')}>
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
      </section>
    );
  const q = request.questions[index];
  const isLast = index === request.questions.length - 1;
  const value = [
    ...(selected[q.question] ?? []),
    ...(answers[q.question]?.trim() ? [answers[q.question].trim()] : []),
  ].join(', ');
  return (
    <section className="prompt-card question-card" aria-label={t('answerQuestion')}>
      <fieldset disabled={disabled || sending}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!value) return;
            if (!isLast) {
              setAnswers((old) => ({ ...old, [q.question]: value }));
              setIndex(index + 1);
              return;
            }
            void answer({ kind: 'answer', answers: { ...answers, [q.question]: value } });
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
          <h3>{q.question}</h3>
          <div className="question-options">
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
                  onChange={(e) =>
                    setSelected((old) => ({
                      ...old,
                      [q.question]: q.multiSelect
                        ? e.target.checked
                          ? [...(old[q.question] ?? []), o.label]
                          : old[q.question].filter((x) => x !== o.label)
                        : [o.label],
                    }))
                  }
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
            <input
              className="custom-answer"
              aria-label={q.question}
              placeholder={t('custom')}
              value={answers[q.question] ?? ''}
              onChange={(e) => setAnswers((old) => ({ ...old, [q.question]: e.target.value }))}
            />
          </div>
          <div className="prompt-actions">
            <button type="button" onClick={() => void answer({ kind: 'deny' })}>
              {t('cancel')}
            </button>
            <span />
            <button className="primary" disabled={!value}>
              {isLast ? t('answer') : t('next')}
            </button>
          </div>
        </form>
      </fieldset>
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
