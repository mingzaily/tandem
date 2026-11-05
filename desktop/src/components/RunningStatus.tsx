import { ArrowDown, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatElapsed, formatTokens } from '../lib/composerStatus';
import { t, type StringKey } from '../lib/i18n';
import type { TurnStatusKey } from '../lib/items';

interface RunningStatusProps {
  status: TurnStatusKey;
  startedAt: number;
  outputTokens: number;
  /** Changes whenever the agent produces something. */
  activity: number;
}

/**
 * The line above the input box. It breathes once per burst of activity instead of looping, so
 * movement means the agent is producing something and a long wait stays still.
 */
export function RunningStatus({ status, startedAt, outputTokens, activity }: RunningStatusProps) {
  const [now, setNow] = useState(() => Date.now());
  const [cycle, setCycle] = useState(0);
  const playing = useRef(false);
  const queued = useRef(false);

  useEffect(() => {
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(clock);
  }, []);

  const onBreathEnd = useCallback(() => {
    playing.current = false;
    if (queued.current) {
      queued.current = false;
      playing.current = true;
      setCycle((current) => current + 1);
    }
  }, []);

  useEffect(() => {
    if (playing.current) {
      queued.current = true;
      return;
    }
    playing.current = true;
    setCycle((current) => current + 1);
  }, [status, activity]);

  return (
    <div className="grid select-none grid-cols-[minmax(0,1fr)_auto] items-center px-2 py-[6px]">
      <div key={cycle} onAnimationEnd={onBreathEnd} className="status-bar-shimmer flex min-w-0 items-center gap-[6px]">
        <Sparkles size={14} aria-hidden className="shrink-0 -translate-y-px" />
        <span role="status" className="truncate text-13 font-medium">
          {t(status as StringKey)}
        </span>
      </div>
      <div className="flex items-center gap-[6px] text-13 font-medium tabular-nums text-[var(--status-bar-meta)]">
        <span>{formatElapsed(now - startedAt)}</span>
        {outputTokens > 0 ? (
          <>
            <span aria-hidden>·</span>
            <ArrowDown size={13} aria-hidden className="shrink-0" />
            <span>{t('tokenCount', { tokens: formatTokens(outputTokens) })}</span>
          </>
        ) : null}
      </div>
    </div>
  );
}
