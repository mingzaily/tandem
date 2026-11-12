import { describe, expect, it } from 'vitest';
import { isImeKey } from './ime';

const enter = (fields: Partial<KeyboardEvent>) => ({ nativeEvent: { isComposing: false, keyCode: 13, ...fields } as KeyboardEvent });

describe('isImeKey', () => {
  it('treats the commit Enter that WebKit reports with key code 229 as the input method\'s', () => {
    expect(isImeKey(enter({}))).toBe(false);
    expect(isImeKey(enter({ isComposing: true }))).toBe(true);
    expect(isImeKey(enter({ keyCode: 229 }))).toBe(true);
  });
});
