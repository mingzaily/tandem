import { describe, expect, it } from 'vitest';
import type { Item } from './items';
import { browseInputHistory, deriveInputHistory, inputHistoryDirection, type InputHistoryNavigation } from './recallInput';

const up = { key: 'ArrowUp', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };
describe('task input history projection', () => {
  it('includes user and steering text newest first, preserves repeats and skips non-text inputs', () => {
    const items: Item[] = [
      { type: 'user', id: 'old', text: 'same' },
      { type: 'assistant', id: 'a', text: 'reply' },
      { type: 'user', id: 'image', text: '', images: ['data:image/png;base64,AA'] },
      { type: 'user', id: 'steer', text: 'steer\ntext', steered: true },
      { type: 'user', id: 'new', text: 'same' },
      { type: 'error', id: 'error', text: 'provider failed' },
    ];
    expect(deriveInputHistory(items)).toEqual(['same', 'steer\ntext', 'same']);
  });
  it('keeps the projection stable while assistant deltas arrive and replaces it for a new input', () => {
    const input: Item = { type: 'user', id: 'u', text: 'first' };
    const history = deriveInputHistory([input]);
    expect(deriveInputHistory([input, { type: 'assistant', id: 'a', text: 'streaming' }], history)).toBe(history);
    expect(deriveInputHistory([input, { type: 'user', id: 'n', text: 'next' }], history)).toEqual(['next', 'first']);
    expect(deriveInputHistory([], history)).toEqual([]);
  });
});

describe('input history navigation', () => {
  it('moves to older entries and back to the exact original draft with fixed browsing order', () => {
    let navigation: InputHistoryNavigation | null = null;
    let value = ' \n';
    const move = (direction: 'older' | 'newer', history = ['latest', 'older']) => {
      const result = browseInputHistory(history, navigation, value, direction);
      if (result) { navigation = result.navigation; value = result.value; }
      return result;
    };
    expect(move('newer')).toBeNull();
    move('older'); expect(value).toBe('latest');
    move('older', ['arrived later', 'latest', 'older']); expect(value).toBe('older');
    expect(move('older')).toBeNull();
    move('newer'); expect(value).toBe('latest');
    move('newer'); expect(value).toBe(' \n');
    expect(navigation).toBeNull();
  });
  it('keeps a typed draft and modified history text under normal cursor control', () => {
    expect(browseInputHistory(['old'], null, 'draft', 'older')).toBeNull();
    expect(browseInputHistory([], null, '', 'older')).toBeNull();
    const first = browseInputHistory(['latest', 'older'], null, '', 'older')!;
    expect(browseInputHistory(['latest', 'older'], first.navigation, 'changed', 'older')).toBeNull();
    expect(browseInputHistory(['latest', 'older'], first.navigation, 'changed', 'newer')).toBeNull();
  });
  it('uses plain up/down arrows while modifier shortcuts keep their existing meaning', () => {
    expect(inputHistoryDirection(up)).toBe('older');
    expect(inputHistoryDirection({ ...up, key: 'ArrowDown' })).toBe('newer');
    expect(inputHistoryDirection({ ...up, key: 'Enter' })).toBeNull();
    for (const key of ['metaKey', 'ctrlKey', 'altKey', 'shiftKey']) expect(inputHistoryDirection({ ...up, [key]: true })).toBeNull();
  });
});
