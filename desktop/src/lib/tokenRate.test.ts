import { describe, expect, it } from 'vitest';
import type { GenerationSpeed } from './api';
import { averageRate, currentRate, emptyRateHistory, formatRate, RATE_FRESH_MS, recordSpeed } from './tokenRate';

const speed = (overrides: Partial<GenerationSpeed> = {}): GenerationSpeed => ({
  rate: 50, average: 50, peak: 50, generationMs: 2_000, measuredTokens: 100, streaming: false, ...overrides,
});

describe('host measured token speed', () => {
  it('uses the host clock and paired usage even when whole requests arrive in the same UI tick', () => {
    let history = recordSpeed(emptyRateHistory(), speed(), 10);
    history = recordSpeed(history, speed({ rate: 100, average: 75, peak: 100, generationMs: 4_000, measuredTokens: 300 }), 10);
    expect(history.samples.map((sample) => sample.rate)).toEqual([50, 100]);
    expect(averageRate(history)).toBe(75);
    expect(history.peak).toBe(100);
  });

  it('phase changes retain the previous measured sample without creating a new peak', () => {
    const measured = recordSpeed(emptyRateHistory(), speed(), 1_000);
    const streaming = recordSpeed(measured, speed({ streaming: true }), 1_500);
    expect(streaming.samples).toBe(measured.samples);
    expect(currentRate(streaming, 1_500)).toBe(50);
    const waiting = recordSpeed(streaming, speed(), 2_000);
    expect(currentRate(waiting, 2_000)).toBeNull();
    expect(waiting.latestRate).toBe(50);
    expect(waiting.peak).toBe(50);
  });

  it('leaves unmeasured usage blank instead of dividing it by UI event spacing', () => {
    const history = recordSpeed(emptyRateHistory(), speed({ rate: null, average: null, peak: null, generationMs: 0, measuredTokens: 0 }), 200);
    expect(history.samples).toEqual([]);
    expect(averageRate(history)).toBeNull();
    expect(currentRate(history, 200)).toBeNull();
    expect(history.peak).toBeNull();
  });

  it('expires the current reading without replacing the last sample with zero', () => {
    const history = recordSpeed(emptyRateHistory(), speed({ streaming: true }), 1_000);
    expect(currentRate(history, 1_000 + RATE_FRESH_MS)).toBeNull();
    expect(history.latestRate).toBe(50);
  });

  it('keeps a bounded curve while retaining the host turn average and peak', () => {
    let history = emptyRateHistory();
    for (let count = 1; count <= 100; count++) history = recordSpeed(history, speed({ generationMs: count * 1_000, measuredTokens: count * 50 }), count * 1_000);
    expect(history.samples).toHaveLength(60);
    expect(history.generatingMs).toBe(100_000);
    expect(averageRate(history)).toBe(50);
  });
});

describe('formatRate', () => {
  it('keeps a decimal only for small numbers', () => {
    expect(formatRate(12.34)).toBe('12.3');
    expect(formatRate(123.4)).toBe('123');
  });
});
