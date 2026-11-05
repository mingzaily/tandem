import { describe, expect, it } from 'vitest';
import { scaledFontTokens } from './settings';

describe('scaledFontTokens', () => {
  it('leaves sizes alone at the default', () => {
    expect(scaledFontTokens(14)).toContainEqual(['--text-13', '13px']);
  });

  it('scales every size in proportion', () => {
    const tokens = new Map(scaledFontTokens(16));
    expect(tokens.get('--text-14')).toBe('16px');
    expect(tokens.get('--text-sm')).toBe('16px');
    expect(tokens.get('--text-24')).toBe('27px');
  });
});
