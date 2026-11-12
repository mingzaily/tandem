import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { ArrowUp, Square } from 'lucide-react';
import { AgentMark } from './AgentMark';
import type { Agent } from './lib/types';
import { t } from './lib/i18n';

export function Composer({
  agent,
  value,
  creating,
  disabled,
  canSend,
  running,
  stopDisabled = disabled,
  onChange,
  onSend,
  onStop,
  children,
}: {
  agent: Agent;
  value: string;
  creating: boolean;
  disabled: boolean;
  canSend: boolean;
  running: boolean;
  stopDisabled?: boolean;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  children?: ReactNode;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const compositionEnded = useRef(Number.NEGATIVE_INFINITY);
  useLayoutEffect(() => {
    const element = input.current!;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 240)}px`;
  }, [value]);

  return (
    <div className={'composer' + (creating ? ' composer-new' : '')}>
      <textarea
        ref={input}
        aria-label={t('send')}
        placeholder={t('prompt')}
        disabled={disabled}
        value={value}
        rows={1}
        onChange={(event) => onChange(event.target.value)}
        onCompositionEnd={() => {
          compositionEnded.current = performance.now();
        }}
        onKeyDown={(event) => {
          const native = event.nativeEvent;
          const composing =
            native.isComposing || native.keyCode === 229 || performance.now() - compositionEnded.current < 80;
          if (event.key === 'Enter' && !event.shiftKey && !composing && canSend) {
            event.preventDefault();
            onSend();
          }
        }}
      />
      <div className="composer-bottom">
        <div className="composer-options">
          {children ?? (
            <span className="composer-agent" title={agent}>
              <AgentMark agent={agent} size={15} />
            </span>
          )}
        </div>
        <button
          className="send-button"
          disabled={running ? stopDisabled : !canSend}
          aria-label={t(running ? 'stop' : 'send')}
          onClick={running ? onStop : onSend}
        >
          {running ? <Square size={13} fill="currentColor" /> : <ArrowUp size={17} />}
        </button>
      </div>
    </div>
  );
}
