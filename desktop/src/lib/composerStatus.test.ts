import { describe, expect, it } from 'vitest';
import type { ModelOption } from './api';
import { contextPercent, DEFAULT_PREFS, describeUsage, formatElapsed, formatTokens, turnOptions } from './composerStatus';

const model = (overrides: Partial<ModelOption>): ModelOption => ({
  value: 'default',
  displayName: 'Default',
  description: '',
  resolvedModel: 'claude-x',
  supportsEffort: true,
  supportedEffortLevels: ['high'],
  supportsAutoMode: true,
  ...overrides,
});

describe('turnOptions', () => {
  it('passes nothing for the defaults, so the CLI settings still apply', () => {
    expect(turnOptions(DEFAULT_PREFS, [model({})])).toEqual({ model: null, effort: null, permissionMode: null });
  });

  it('passes what the model supports', () => {
    const prefs = { model: 'opus', effort: 'high', permissionMode: 'auto' as const };
    expect(turnOptions(prefs, [model({ value: 'opus' })])).toEqual({
      model: 'opus',
      effort: 'high',
      permissionMode: 'auto',
    });
  });

  it('drops effort and auto when the model cannot use them', () => {
    const prefs = { model: 'haiku', effort: 'high', permissionMode: 'auto' as const };
    const models = [model({ value: 'haiku', supportsEffort: false, supportedEffortLevels: [], supportsAutoMode: false })];
    expect(turnOptions(prefs, models)).toEqual({ model: 'haiku', effort: null, permissionMode: null });
  });

  it('keeps the choice while the model list has not loaded', () => {
    const prefs = { model: 'opus', effort: 'max', permissionMode: 'acceptEdits' as const };
    expect(turnOptions(prefs, [])).toEqual({ model: 'opus', effort: 'max', permissionMode: 'acceptEdits' });
  });
});

describe('formatting', () => {
  it('formats elapsed time and tokens compactly', () => {
    expect(formatElapsed(9_400)).toContain('9');
    expect(formatTokens(950)).toBe('950');
    expect(formatTokens(1_234)).toBe('1.2k');
    expect(formatTokens(45_600)).toBe('46k');
    expect(formatTokens(1_500_000)).toBe('1.5M');
  });

  it('counts down to the reset and flags a nearly used window', () => {
    const now = Date.parse('2026-11-04T00:00:00Z');
    const seconds = (hours: number) => now / 1000 + hours * 3600;
    const soon = describeUsage({ usedPercent: 3, resetsAt: seconds(4.5) }, now);
    expect(soon?.text).toContain('4');
    expect(soon?.text).toContain('97%');
    expect(soon?.low).toBe(false);
    const later = describeUsage({ usedPercent: 85, resetsAt: '2026-11-10T12:00:00Z' }, now);
    expect(later?.text).toContain('6');
    expect(later?.low).toBe(true);
    expect(describeUsage({ usedPercent: 0, resetsAt: null }, now)).toBeNull();
  });

  it('caps context at 100 percent and handles an unknown window', () => {
    expect(contextPercent(50, 200)).toBe(25);
    expect(contextPercent(500, 200)).toBe(100);
    expect(contextPercent(50, 0)).toBe(0);
  });
});
