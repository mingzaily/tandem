import { describe, expect, it } from 'vitest';
import { averageRate, currentRate, emptyRateHistory, formatRate, RATE_FRESH_MS, recordActivity } from './tokenRate';

describe('recordActivity', () => {
  it('measures speed over the time spent generating', () => {
    let history = emptyRateHistory(0);
    history = recordActivity(history, 1000, 50);
    expect(history.samples[0].rate).toBe(50);
    history = recordActivity(history, 2000, 150);
    expect(history.peak).toBe(100);
    expect(averageRate(history)).toBe(75);
  });

  it('leaves out a long silence such as a running tool', () => {
    let history = emptyRateHistory(0);
    history = recordActivity(history, 1000, 100);
    history = recordActivity(history, 61_000, 100);
    history = recordActivity(history, 62_000, 200);
    expect(history.generatingMs).toBe(2000);
    expect(history.samples.at(-1)?.rate).toBe(100);
  });

  it('waits for tokens and for enough time to divide by', () => {
    let history = emptyRateHistory(0);
    history = recordActivity(history, 50, 500);
    expect(history.samples).toHaveLength(0);
    history = recordActivity(history, 1000, 0);
    expect(history.samples).toHaveLength(0);
    expect(averageRate(history)).toBeNull();
  });
});

describe('currentRate', () => {
  it('goes blank once tokens stop arriving', () => {
    const history = recordActivity(emptyRateHistory(0), 1000, 50);
    expect(currentRate(history, 1500)).toBe(50);
    expect(currentRate(history, 1000 + RATE_FRESH_MS)).toBeNull();
  });
});

describe('formatRate', () => {
  it('keeps a decimal only for small numbers', () => {
    expect(formatRate(12.34)).toBe('12.3');
    expect(formatRate(123.4)).toBe('123');
  });
});
