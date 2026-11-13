import { describe, expect, it } from 'vitest';
import { buildLabel } from './buildIdentity';

describe('build identity label', () => {
  it('shows the embedded commit for local release builds', () => {
    expect(buildLabel('0.1.0', { commit: 'bd5ae03f1234567890123456789012345678901234', dirty: false })).toBe('bd5ae03f');
  });
  it('marks uncommitted local source instead of claiming an exact clean commit', () => {
    expect(buildLabel('0.1.0', { commit: 'bd5ae03f1234567890123456789012345678901234', dirty: true })).toBe('bd5ae03f-dirty');
  });
  it('preserves official CI release versions', () => {
    expect(buildLabel('0.1.42', null)).toBe('0.1.42');
  });
});
