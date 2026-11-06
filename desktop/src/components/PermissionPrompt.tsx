import { useEffect, useRef } from 'react';
import type { Decision, PendingRequest } from '../lib/api';
import { t } from '../lib/i18n';
import { describePermission } from '../lib/tools';

/** An Enter meant for the input box must not approve a request that has just appeared. */
const SHORTCUT_DELAY_MS = 500;

const BUTTON =
  'inline-flex min-h-9 max-w-full items-center gap-2 rounded-full border border-[var(--chat-input-border)] px-3 py-1.5 text-13 font-medium transition-colors duration-[var(--motion-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:opacity-50';
const SECONDARY = `${BUTTON} text-[var(--chat-input-text)] hover:bg-[var(--perm-code-bg)]`;
const KBD =
  'shrink-0 rounded-[4px] border border-[var(--chat-input-border)] bg-[var(--perm-code-bg)] px-1.5 py-[1px] text-11 font-normal';

interface PermissionPromptProps {
  request: Extract<PendingRequest, { type: 'permissionRequest' }>;
  onAnswer: (decision: Decision) => void;
  submitting?: boolean;
}

/** Replaces the input box while the agent waits for permission to use a tool. */
export function PermissionPrompt({ request, onAnswer, submitting = false }: PermissionPromptProps) {
  const { title, detail } = describePermission(request.toolName, request.input);
  const scope = request.rules.join('、');
  const card = useRef<HTMLDivElement>(null);
  const answer = useRef(onAnswer);
  answer.current = onAnswer;
  const canAllowForTask = request.rules.length > 0;

  useEffect(() => {
    if (submitting) return;
    const shownAt = Date.now();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.repeat || Date.now() - shownAt < SHORTCUT_DELAY_MS) return;
      const focus = document.activeElement;
      // Enter on a focused button already presses that button.
      if (event.key === 'Enter' && focus instanceof HTMLButtonElement && card.current?.contains(focus)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        answer.current({ kind: 'deny' });
      } else if (event.key === 'Enter') {
        event.preventDefault();
        if (event.metaKey || event.ctrlKey) {
          if (canAllowForTask) answer.current({ kind: 'allowForTask' });
        } else {
          answer.current({ kind: 'allow' });
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canAllowForTask, request.requestId, submitting]);

  return (
    <div
      ref={card}
      aria-busy={submitting}
      className="w-full rounded-xl border border-[var(--chat-input-border)] bg-[var(--chat-input-bg)] p-4"
    >
      <p className="text-15 font-semibold leading-tight text-[var(--chat-input-text)]">{title}</p>
      {request.description ? (
        <p className="selectable mt-1.5 whitespace-pre-wrap break-words text-13 leading-tight text-[var(--status-bar-meta)]">
          {request.description}
        </p>
      ) : null}
      <div className="mt-3 max-h-[120px] overflow-auto rounded-[8px] border border-[var(--perm-code-border)] bg-[var(--perm-code-bg)] px-3.5 py-2.5 font-mono text-[length:calc(var(--app-code-font-size)_-_1px)] leading-relaxed text-[var(--chat-input-text)]">
        <pre className="selectable whitespace-pre-wrap break-all">{detail}</pre>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <button type="button" disabled={submitting} onClick={() => onAnswer({ kind: 'deny' })} className={SECONDARY}>
          <span>{t('permissionDeny')}</span>
          <kbd className={KBD}>Esc</kbd>
        </button>
        {canAllowForTask ? (
          <button
            type="button"
            disabled={submitting}
            title={`${scope}\n${t('permissionAllowForTaskHint')}`}
            onClick={() => onAnswer({ kind: 'allowForTask' })}
            className={`${SECONDARY} min-w-0 max-w-[min(100%,460px)]`}
          >
            <span className="min-w-0 truncate">{t('permissionAllowForTask', { scope })}</span>
            <kbd className={KBD}>⌘</kbd>
            <kbd className={`${KBD} -ml-1`}>Enter</kbd>
          </button>
        ) : null}
        <button
          type="button"
          disabled={submitting}
          onClick={() => onAnswer({ kind: 'allow' })}
          className={`${BUTTON} bg-[var(--perm-allow-btn-bg)] text-[var(--perm-allow-btn-text)] hover:opacity-90`}
        >
          <span>{t('permissionAllowOnce')}</span>
          <kbd className="rounded-[4px] border border-[var(--perm-allow-kbd-border)] bg-[var(--perm-allow-kbd-bg)] px-1.5 py-[1px] text-11 font-normal">
            Enter
          </kbd>
        </button>
      </div>
    </div>
  );
}
