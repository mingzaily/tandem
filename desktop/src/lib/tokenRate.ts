import type { GenerationSpeed } from './api';

const MAX_SAMPLES = 60;
export const RATE_FRESH_MS = 60_000;

export interface RateSample { atMs: number; rate: number }
export interface RateHistory {
  samples: RateSample[];
  peak: number | null;
  average: number | null;
  latestRate: number | null;
  generatingMs: number;
  lastSampleAt: number | null;
  streaming: boolean;
}

export const emptyRateHistory = (): RateHistory => ({
  samples: [], peak: null, average: null, latestRate: null,
  generatingMs: 0, lastSampleAt: null, streaming: false,
});

/** The host pairs usage and model time. Rendering or burst delivery never creates a speed. */
export function recordSpeed(history: RateHistory, speed: GenerationSpeed, now: number): RateHistory {
  const measured = speed.rate !== null && speed.generationMs > history.generatingMs;
  return {
    samples: measured ? [...history.samples, { atMs: speed.generationMs, rate: speed.rate! }].slice(-MAX_SAMPLES) : history.samples,
    peak: speed.peak, average: speed.average, latestRate: speed.rate,
    generatingMs: speed.generationMs,
    lastSampleAt: measured ? now : history.lastSampleAt,
    streaming: speed.streaming,
  };
}

export function currentRate(history: RateHistory, now: number): number | null {
  return history.streaming && history.lastSampleAt !== null && now - history.lastSampleAt < RATE_FRESH_MS
    ? history.latestRate : null;
}

export const averageRate = (history: RateHistory): number | null => history.average;
export const formatRate = (rate: number) => (rate >= 100 ? Math.round(rate).toString() : rate.toFixed(1));
