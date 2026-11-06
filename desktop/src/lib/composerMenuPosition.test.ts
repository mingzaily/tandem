import { describe, expect, it } from 'vitest';
import { composerMenuPosition } from './composerMenuPosition';

describe('composer menu position', () => {
  it('anchors the full model menu above the input in viewport coordinates', () => {
    const position = composerMenuPosition({ left: 860, right: 1100, top: 700, bottom: 730 }, { width: 1200, height: 800 }, 420, 440, 'right', 'above');
    expect(position).toEqual({ left: 680, width: 420, maxHeight: 440, bottom: 106 });
    expect(800 - position.bottom! - position.maxHeight).toBeGreaterThanOrEqual(56);
  });

  it('keeps both sides inside a narrow window and bounds the scrolling body', () => {
    const position = composerMenuPosition({ left: 5, right: 105, top: 260, bottom: 290 }, { width: 360, height: 480 }, 420, 440, 'right', 'above');
    expect(position.left).toBe(8);
    expect(position.width).toBe(344);
    expect(position.maxHeight).toBe(198);
  });

  it('places a project menu below its trigger and follows a scrolled input', () => {
    const bounds = { left: 100, right: 200, top: 180, bottom: 210 };
    const before = composerMenuPosition(bounds, { width: 800, height: 480 }, 280, 340, 'left', 'below');
    const after = composerMenuPosition({ ...bounds, top: 150, bottom: 180 }, { width: 800, height: 480 }, 280, 340, 'left', 'below');
    expect(before).toMatchObject({ left: 100, top: 216, maxHeight: 248 });
    expect(after).toMatchObject({ top: 186, maxHeight: 278 });
  });

  it('flips below an input near the top so a compact window still shows model rows', () => {
    const position = composerMenuPosition({ left: 320, right: 660, top: 150, bottom: 180 }, { width: 720, height: 480 }, 420, 440, 'right', 'above');
    expect(position).toEqual({ left: 240, width: 420, top: 186, maxHeight: 278 });
  });

  it('shrinks a model menu above its trigger even when more space is available below', () => {
    const position = composerMenuPosition({ left: 320, right: 660, top: 300, bottom: 330 }, { width: 720, height: 900 }, 420, 440, 'right', 'above', 6, false);
    expect(position).toEqual({ left: 240, width: 420, bottom: 606, maxHeight: 238 });
  });

  it('keeps a hover card touching its trigger across the portal boundary', () => {
    const position = composerMenuPosition({ left: 960, right: 1100, top: 700, bottom: 730 }, { width: 1200, height: 800 }, 320, 340, 'right', 'above', 0);
    expect(position).toEqual({ left: 780, width: 320, bottom: 100, maxHeight: 340 });
  });
});
