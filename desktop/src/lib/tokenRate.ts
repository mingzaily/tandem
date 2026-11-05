/** How fast a turn is generating, measured only while the agent is producing something. */

/** A longer silence is a tool running or a wait, which says nothing about generation speed. */
const IDLE_GAP_MS = 3000;
const MIN_SAMPLE_MS = 200;
const MAX_SAMPLES = 120;
/** After this long without new tokens there is no current speed to show. */
export const RATE_FRESH_MS = 8000;

export interface RateSample {
  atMs: number;
  rate: number;
}

export interface RateHistory {
  samples: RateSample[];
  peak: number;
  generatingMs: number;
  lastActivityAt: number;
  lastTokens: number;
  lastSampleGeneratingMs: number;
  lastSampleAt: number | null;
}

export const emptyRateHistory = (now: number): RateHistory => ({
  samples: [],
  peak: 0,
  generatingMs: 0,
  lastActivityAt: now,
  lastTokens: 0,
  lastSampleGeneratingMs: 0,
  lastSampleAt: null,
});

export function recordActivity(history: RateHistory, now: number, outputTokens: number): RateHistory {
  const gap = now - history.lastActivityAt;
  const generatingMs = history.generatingMs + (gap < IDLE_GAP_MS ? gap : 0);
  const next: RateHistory = { ...history, generatingMs, lastActivityAt: now };
  const tokens = outputTokens - history.lastTokens;
  const elapsed = generatingMs - history.lastSampleGeneratingMs;
  if (tokens <= 0 || elapsed < MIN_SAMPLE_MS) return next;
  const rate = tokens / (elapsed / 1000);
  return {
    ...next,
    samples: [...history.samples, { atMs: generatingMs, rate }].slice(-MAX_SAMPLES),
    peak: Math.max(history.peak, rate),
    lastTokens: outputTokens,
    lastSampleGeneratingMs: generatingMs,
    lastSampleAt: now,
  };
}

export function currentRate(history: RateHistory, now: number): number | null {
  const last = history.samples.at(-1);
  if (!last || history.lastSampleAt === null || now - history.lastSampleAt >= RATE_FRESH_MS) return null;
  return last.rate;
}

export function averageRate(history: RateHistory): number | null {
  if (history.samples.length === 0 || history.lastSampleGeneratingMs <= 0) return null;
  return history.lastTokens / (history.lastSampleGeneratingMs / 1000);
}

export const formatRate = (rate: number) => (rate >= 100 ? Math.round(rate).toString() : rate.toFixed(1));
