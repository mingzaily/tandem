import { describe, expect, it } from 'vitest';
import { attentionTaskCount, shouldMarkUnread } from './notifications';

describe('Dock attention count', () => {
  it('counts each task once across unread results and pending confirmations', () => {
    expect(attentionTaskCount(['a', 'a', 'b'], ['b', 'c'], ['a', 'b', 'c'], [])).toBe(3);
  });

  it('excludes archived, deleted and hidden tasks from the badge', () => {
    expect(attentionTaskCount(['archived', 'removed', 'hidden', 'visible'], [], ['archived', 'visible'], ['archived'])).toBe(1);
  });

  it('keeps an unresolved confirmation counted after reading the task and clears after settling it', () => {
    expect(attentionTaskCount(['task'], ['task'], ['task'], [])).toBe(1);
    expect(attentionTaskCount([], ['task'], ['task'], [])).toBe(1);
    expect(attentionTaskCount([], [], ['task'], [])).toBe(0);
  });

  it('marks the selected task unread when it finishes behind another application', () => {
    expect(shouldMarkUnread(false, 'task', 'task', false)).toBe(true);
    expect(shouldMarkUnread(false, 'task', 'task', true)).toBe(false);
    expect(shouldMarkUnread(false, 'task', 'other', true)).toBe(true);
    expect(shouldMarkUnread(true, 'task', 'other', false)).toBe(false);
  });
});
