import { useEffect, useState } from 'react';
import { ArrowDown, Sparkles } from 'lucide-react';
import { t } from './lib/i18n';
import type { TurnEvent } from './lib/types';
import { duration } from './Stream';
export function RunningStatus({
  events,
  startedAt,
  waiting,
}: {
  events: TurnEvent[];
  startedAt: number;
  waiting: boolean;
}) {
  const [now, setNow] = useState(performance.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(performance.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const last = events
    .filter((e) => ['textDelta', 'thinkingDelta', 'toolUse', 'toolResult'].includes(e.type))
    .at(-1);
  const output = events.filter((e) => e.type === 'outputTokens').at(-1);
  const tokens = output?.type === 'outputTokens' ? output.total : 0;
  return (
    <div className="running-status">
      <span className="status-breath">
        <Sparkles size={14} />
        <span role="status">
          {waiting
            ? t('statusAwaitingYou')
            : last?.type === 'toolUse'
              ? t('statusCallingTool')
              : last?.type === 'textDelta'
                ? t('statusReplying')
                : t('statusThinking')}
        </span>
      </span>
      <span className="run-meta">
        {duration(now - startedAt)}
        <span>·</span>
        <ArrowDown size={12} />
        {t('tokenCount').replace('{tokens}', tokens.toLocaleString())}
      </span>
    </div>
  );
}
