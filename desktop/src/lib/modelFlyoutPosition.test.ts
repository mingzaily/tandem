import { describe, expect, it } from 'vitest';
import { modelFlyoutPosition } from './modelFlyoutPosition';

describe('model configuration placement', () => {
  const viewport = { width: 1200, height: 800 };
  const panel = { left: 700, right: 1120, top: 180, bottom: 650 };

  it('stays beside the entire panel and aligns to the configured row', () => {
    expect(modelFlyoutPosition({ left: 756, right: 1112, top: 320, bottom: 375 }, panel, 210, viewport))
      .toMatchObject({ left: 432, top: 308, width: 264, side: 'left' });
  });

  it('opens on the right when the panel has no room on the left', () => {
    expect(modelFlyoutPosition({ left: 28, right: 360, top: 300, bottom: 355 }, { left: 8, right: 380, top: 180, bottom: 650 }, 210, viewport))
      .toMatchObject({ left: 384, side: 'right' });
  });

  it('keeps the entire configuration visible in a narrow window, allowing overlap', () => {
    const result = modelFlyoutPosition({ left: 64, right: 404, top: 600, bottom: 655 }, { left: 8, right: 428, top: 150, bottom: 670 }, 250, { width: 440, height: 720 });
    expect(result.left).toBeGreaterThanOrEqual(8);
    expect(result.left + result.width).toBeLessThanOrEqual(432);
    expect(result.top + 250).toBeLessThanOrEqual(670);
  });

  it('follows a scrolled row while keeping the flyout within the panel bounds', () => {
    const first = modelFlyoutPosition({ ...panel, top: 300 }, panel, 210, viewport);
    const last = modelFlyoutPosition({ ...panel, top: 620 }, panel, 210, viewport);
    const scrolled = modelFlyoutPosition({ ...panel, top: 100 }, panel, 210, viewport);
    expect(first.top).toBe(288);
    expect(last.top).toBe(440);
    expect(scrolled.top).toBe(panel.top);
  });
});
