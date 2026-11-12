import { afterEach, describe, expect, it, vi } from 'vitest';
import { TooltipDelay, tooltipPosition } from './tooltips';

afterEach(() => vi.useRealTimers());

describe('application tips', () => {
  it('opens after one second and moving inside the same target keeps the deadline', () => {
    vi.useFakeTimers();
    const show = vi.fn();
    const tips = new TooltipDelay<string>(show);
    tips.enter('generate');
    vi.advanceTimersByTime(600);
    tips.enter('generate');
    vi.advanceTimersByTime(399);
    expect(show).not.toHaveBeenCalledWith('generate');
    vi.advanceTimersByTime(1);
    expect(show).toHaveBeenLastCalledWith('generate');
    tips.close();
  });

  it('cancels a pending tooltip on exit and starts a new deadline for another control', () => {
    vi.useFakeTimers();
    const show = vi.fn();
    const tips = new TooltipDelay<string>(show);
    tips.enter('first');
    vi.advanceTimersByTime(900);
    tips.enter('second');
    vi.advanceTimersByTime(999);
    expect(show).not.toHaveBeenCalledWith('first');
    expect(show).not.toHaveBeenCalledWith('second');
    tips.close();
    vi.advanceTimersByTime(1000);
    expect(show).toHaveBeenLastCalledWith(null);
  });

  it('keeps tips within the viewport and flips them above a bottom-edge control', () => {
    expect(tooltipPosition({ left: 390, right: 410, top: 750, bottom: 770 }, { width: 150, height: 40 }, { width: 420, height: 800 })).toEqual({ left: 262, top: 704 });
  });
});
