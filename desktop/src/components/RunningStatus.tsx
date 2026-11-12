import { Activity, ArrowDown, Sparkles } from 'lucide-react';
import { ComposerStatusRow, type ComposerStatusSlots } from './ComposerStatusRow';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatElapsed, formatTokens } from '../lib/composerStatus';
import { t } from '../lib/i18n';
import type { TurnStatus } from '../lib/items';
import { averageRate, currentRate, formatRate, type RateHistory } from '../lib/tokenRate';
import { useAnchoredPosition } from '../lib/useAnchoredPosition';

interface RunningStatusProps extends ComposerStatusSlots {
  status: TurnStatus;
  startedAt: number;
  outputTokens: number;
  /** Changes whenever the agent produces something. */
  activity: number;
  rate: RateHistory;
}

const CHART_RIGHT = 112;
const CHART_BASE = 44;
const CHART_HEIGHT = 36;

function RateChart({ rate }: { rate: RateHistory }) {
  const { samples } = rate;
  const first = samples[0]?.atMs ?? 0;
  const span = (samples.at(-1)?.atMs ?? 0) - first;
  const ceiling = Math.max(1, ...samples.map((sample) => sample.rate));
  const points = samples.map((sample) => ({
    x: span > 0 ? 4 + ((sample.atMs - first) / span) * (CHART_RIGHT - 4) : CHART_RIGHT,
    y: CHART_BASE - (sample.rate / ceiling) * CHART_HEIGHT,
  }));
  const line = points.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(' ');
  const last = points.at(-1);
  return (
    <svg viewBox="0 0 120 48" role="img" aria-label={t('rateHistory')} className="h-12 w-32 shrink-0 text-[var(--text-primary)]">
      <path d={`M4 ${CHART_BASE}H${CHART_RIGHT}`} stroke="currentColor" opacity="0.12" />
      {points.length > 1 ? (
        <>
          <path d={`${line} L${CHART_RIGHT},${CHART_BASE} L${points[0].x},${CHART_BASE} Z`} fill="currentColor" opacity="0.08" />
          <path d={line} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </>
      ) : null}
      {last ? <circle cx={last.x} cy={last.y} r="2.5" fill="currentColor" /> : null}
    </svg>
  );
}

export function RateCard({ rate, outputTokens, now }: { rate: RateHistory; outputTokens: number; now: number }) {
  const recent = currentRate(rate, now);
  // Between generations (a tool running, waiting for an answer) the last speed stays, dimmed.
  const shown = recent ?? rate.latestRate;
  const average = averageRate(rate);
  const withUnit = (value: number | null) => (value === null ? '—' : `${formatRate(value)} ${t('rateUnit')}`);
  const stats: [string, string][] = [
    [t('rateAverage'), withUnit(average)],
    [t('rateTotal'), t('tokenCount', { tokens: formatTokens(outputTokens) })],
    [t('ratePeak'), withUnit(rate.peak)],
  ];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-1.5 text-12 text-[var(--text-secondary)]">
            <Activity size={14} aria-hidden />
            {t('rateCurrent')}
          </div>
          <div className={`flex items-baseline gap-1.5 tabular-nums ${recent === null ? 'text-[var(--text-tertiary)]' : 'text-[var(--text-primary)]'}`}>
            <span className="text-[28px] font-medium leading-none">{shown === null ? '—' : formatRate(shown)}</span>
            <span className="text-12 text-[var(--text-secondary)]">{t('rateUnit')}</span>
          </div>
          {recent === null && shown !== null ? <div className="mt-1 text-11 text-[var(--text-tertiary)]">{t('ratePaused')}</div> : null}
        </div>
        <RateChart rate={rate} />
      </div>
      <dl className="grid grid-cols-3 gap-2 text-12 tabular-nums">
        {stats.map(([label, value]) => (
          <div key={label} className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-[var(--text-secondary)]">{label}</dt>
            <dd className="truncate font-medium text-[var(--text-primary)]">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-11 leading-snug text-[var(--text-tertiary)]">{t('rateNote')}</p>
    </div>
  );
}

/**
 * The line above the input box. It breathes once per burst of activity instead of looping, so
 * movement means the agent is producing something and a long wait stays still.
 */
export function RunningStatus({ status, startedAt, outputTokens, activity, rate, center, indicator }: RunningStatusProps) {
  const label = status.key === 'statusCallingTool' && status.toolName
    ? t('statusToolRunning', { tool: status.toolName })
    : t(status.key);
  const [now, setNow] = useState(() => Date.now());
  const [cycle, setCycle] = useState(0);
  const playing = useRef(false);
  const queued = useRef(false);
  // Hovering or keyboard focus shows the card; it never stays open on its own.
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const open = isHovered || isFocused;
  // The card's bottom padding bridges hover from the trigger to its portaled content.
  const position = useAnchoredPosition(open, root, 320, 340, 'right', 'above', 0);

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
  }, [label, activity]);

  return (
    <ComposerStatusRow center={center} indicator={indicator} actions={
      <div ref={root} className="relative" onMouseEnter={() => setIsHovered(true)} onMouseLeave={() => setIsHovered(false)}>
        <button
          type="button"
          aria-label={t('rateCurrent')}
          aria-haspopup="dialog"
          aria-expanded={open}
          onFocus={(event) => setIsFocused(event.currentTarget.matches(':focus-visible'))}
          onBlur={() => setIsFocused(false)}
          className="flex h-6 items-center gap-[6px] rounded-full px-1.5 text-13 font-medium tabular-nums text-[var(--status-bar-meta)] transition-colors hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
        >
          <span>{formatElapsed(now - startedAt)}</span>
          {outputTokens > 0 ? (
            <>
              <span aria-hidden>·</span>
              <ArrowDown size={13} aria-hidden className="shrink-0" />
              <span>{t('tokenCount', { tokens: formatTokens(outputTokens) })}</span>
            </>
          ) : null}
        </button>
        {open && position ? createPortal(
          <div role="dialog" aria-label={t('rateCurrent')} style={position} className="fixed z-50 overflow-y-auto pb-2">
            <div className="relative rounded-xl border border-[var(--border-default)] bg-[var(--surface-elevated)] px-4 py-3 shadow-[shadow:var(--shadow-menu)]">
              <RateCard rate={rate} outputTokens={outputTokens} now={now} />
            </div>
          </div>, document.body,
        ) : null}
      </div>
    }>
      <div key={cycle} onAnimationEnd={onBreathEnd} className="status-bar-shimmer flex min-w-0 items-center gap-[6px]">
        <Sparkles size={14} aria-hidden className="shrink-0" />
        <span role="status" data-tooltip={label} className="truncate text-13 font-medium">
          {label}
        </span>
      </div>
    </ComposerStatusRow>
  );
}
