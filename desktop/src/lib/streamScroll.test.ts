import { describe, expect, it } from 'vitest';
import { countAddedMessages, followTailAfterScroll } from './streamScroll';

const viewport = (scrollTop: number, scrollHeight = 1200, clientHeight = 600) => ({ scrollTop, scrollHeight, clientHeight });

describe('new message counts while reading history', () => {
  it('counts a repeated new answer but treats native replacement of a live ID as the same message', () => {
    const before = [{ type: 'assistant' as const, id: 'a', text: 'same' }];
    expect(countAddedMessages(before, [...before, { type: 'assistant', id: 'b', text: 'same' }])).toBe(1);
    expect(countAddedMessages(before, [{ type: 'assistant', id: 'native-a', text: 'same' }])).toBe(0);
    expect(countAddedMessages(before, [{ type: 'assistant', id: 'a', text: 'same, still streaming' }])).toBe(0);
  });
});

describe('message tail follow intent', () => {
  it('keeps following when rows or composer padding grow without user movement', () => {
    expect(followTailAfterScroll(true, 600, viewport(600, 1500))).toBe(true);
    expect(followTailAfterScroll(true, 0, viewport(0, 1400))).toBe(true);
  });
  it('releases on an upward movement away from the tail', () => {
    expect(followTailAfterScroll(true, 600, viewport(500))).toBe(false);
  });
  it('restores follow only when the reader scrolls down into the tail', () => {
    expect(followTailAfterScroll(false, 500, viewport(590))).toBe(true);
    expect(followTailAfterScroll(false, 590, viewport(590))).toBe(false);
    expect(followTailAfterScroll(false, 595, viewport(590))).toBe(false);
  });
  it('follows again when all content fits in the viewport', () => {
    expect(followTailAfterScroll(false, 300, viewport(0, 400))).toBe(true);
  });
  it('keeps upward reading independent of further content growth', () => {
    expect(followTailAfterScroll(false, 300, viewport(300, 1800))).toBe(false);
    expect(followTailAfterScroll(false, 300, viewport(350, 1800))).toBe(false);
  });
});
