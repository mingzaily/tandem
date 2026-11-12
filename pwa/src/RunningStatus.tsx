import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, Sparkles } from 'lucide-react';
import { t } from './lib/i18n';
import type { TurnEvent } from './lib/types';
import { duration } from './Stream';
import { applyTurnEvent, turnStatus, type Item } from './lib/items';
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
  const items = useMemo(() => events.reduce<Item[]>(applyTurnEvent, []), [events]);
  const status = turnStatus(items, waiting);
  const output = events.filter((e) => e.type === 'outputTokens').at(-1);
  const tokens = output?.type === 'outputTokens' ? output.total : 0;
  return (
    <div className="running-status">
      <span className="status-breath">
        <Sparkles size={14} />
        <span role="status">
          {status.key === 'statusCallingTool' ? `${status.toolName} ${t('toolRunning')}` : t(status.key)}
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
