import { useState } from 'react';
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
  const answer = async (d: Decision) => {
    setSending(true);
    try {
      await onAnswer(d);
    } finally {
      setSending(false);
    }
  };
  return (
    <section className="card">
      <fieldset disabled={disabled || sending}>
        {request.type === 'permissionRequest' ? (
          <>
            <h3>{request.toolName}</h3>
            <p>{request.description}</p>
            <pre>{request.input}</pre>
            <div className="actions">
              <button onClick={() => void answer({ kind: 'deny' })}>{t('deny')}</button>
              {request.rules.length > 0 && (
                <button onClick={() => void answer({ kind: 'allowForTask' })}>{t('allowTask')}</button>
              )}
              <button className="primary" onClick={() => void answer({ kind: 'allow' })}>
                {t('allow')}
              </button>
            </div>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const values = Object.fromEntries(
                request.questions.map((q) => [
                  q.question,
                  [
                    ...(selected[q.question] ?? []),
                    ...(answers[q.question]?.trim() ? [answers[q.question].trim()] : []),
                  ].join(', '),
                ]),
              );
              void answer({ kind: 'answer', answers: values });
            }}
          >
            {request.questions.map((q) => (
              <div key={q.question}>
                <h3>{q.header}</h3>
                <p>{q.question}</p>
                {q.options?.map((o) => (
                  <label className="option" key={o.label}>
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
                    {o.label}
                    <small>{o.description}</small>
                  </label>
                ))}
                <input
                  aria-label={q.question}
                  placeholder={t('custom')}
                  value={answers[q.question] ?? ''}
                  onChange={(e) => setAnswers((old) => ({ ...old, [q.question]: e.target.value }))}
                />
              </div>
            ))}
            <div className="actions">
              <button type="button" onClick={() => void answer({ kind: 'deny' })}>
                {t('deny')}
              </button>
              <button
                className="primary"
                disabled={request.questions.some(
                  (q) => !(selected[q.question]?.length || answers[q.question]?.trim()),
                )}
              >
                {t('answer')}
              </button>
            </div>
          </form>
        )}
      </fieldset>
    </section>
  );
}
