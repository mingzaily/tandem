import { describe, expect, it } from 'vitest';
import { canGoBack, canGoForward, currentEntry, goBack, goForward, pushEntry, replaceEntry, startHistory } from './navHistory';

describe('navHistory', () => {
  it('walks back and forward', () => {
    let history = pushEntry(pushEntry(startHistory('a'), 'b'), 'c');
    history = goBack(goBack(history));
    expect(currentEntry(history)).toBe('a');
    expect(canGoBack(history)).toBe(false);
    history = goForward(history);
    expect(currentEntry(history)).toBe('b');
    expect(canGoForward(history)).toBe(true);
  });

  it('drops the forward entries when a new page opens', () => {
    const history = pushEntry(goBack(pushEntry(startHistory('a'), 'b')), 'c');
    expect(history.entries).toEqual(['a', 'c']);
    expect(canGoForward(history)).toBe(false);
  });

  it('does not add the page that is already open', () => {
    const history = pushEntry(startHistory({ kind: 'task', id: '1' }), { kind: 'task', id: '1' });
    expect(history.entries).toHaveLength(1);
  });

  it('replaces the current page without adding a step', () => {
    const history = replaceEntry(pushEntry(startHistory('a'), 'b'), 'c');
    expect(history.entries).toEqual(['a', 'c']);
    expect(history.index).toBe(1);
  });
});
