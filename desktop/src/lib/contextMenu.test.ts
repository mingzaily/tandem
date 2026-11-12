import { describe, expect, it } from 'vitest';
import { shouldKeepNativeMenu } from './contextMenu';

describe('shouldKeepNativeMenu', () => {
  it('keeps the menu for selected text and drops it elsewhere', () => {
    expect(shouldKeepNativeMenu(null, 'copied words')).toBe(true);
    expect(shouldKeepNativeMenu(null, '  ')).toBe(false);
    expect(shouldKeepNativeMenu(null, '')).toBe(false);
    const field = { closest: (selector: string) => (selector.includes('textarea') ? {} : null) } as unknown as Element;
    expect(shouldKeepNativeMenu(field, '')).toBe(true);
  });
});
