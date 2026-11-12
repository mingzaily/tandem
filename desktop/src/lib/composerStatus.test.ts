import { describe, expect, it } from 'vitest';
import type { ModelOption } from './api';
import { contextPercent, DEFAULT_PREFS, describeUsage, formatElapsed, formatTokens, sessionPermissionMode, selectedModel, taskPreferences, titleOptions, turnOptions, usageExpired } from './composerStatus';

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

describe('task preferences', () => {
  it.each(['claude', 'codex', 'pi'])('keeps %s tasks on their native models when new-task defaults change', () => {
    const first = { model: 'model-a', effort: 'high' };
    const second = { model: 'model-b', effort: 'low' };
    const changedDefaults = { ...DEFAULT_PREFS, model: 'model-c', effort: 'max' };
    expect(taskPreferences(changedDefaults, first)).toEqual({ ...DEFAULT_PREFS, ...first });
    expect(taskPreferences(changedDefaults, second)).toEqual({ ...DEFAULT_PREFS, ...second });
  });

  it('keeps a manual task choice while older native metadata is read again', () => {
    const chosen = { model: 'chosen', effort: 'max', permissionMode: 'auto' as const };
    expect(taskPreferences(DEFAULT_PREFS, { model: 'native', effort: 'low' }, chosen, 'ask')).toEqual(chosen);
  });

  it('resumes a task with unknown metadata without injecting another task model or effort', () => {
    expect(taskPreferences({ model: 'other-task', effort: 'max', permissionMode: 'auto' }))
      .toEqual({ model: null, effort: null, permissionMode: 'auto' });
  });

  it('keeps native permission and an explicit follow-CLI choice scoped to the task', () => {
    expect(taskPreferences(DEFAULT_PREFS, { model: 'native', effort: 'low' }, undefined, 'auto').permissionMode).toBe('auto');
    expect(taskPreferences(DEFAULT_PREFS, { model: 'native', effort: 'low' }, { ...DEFAULT_PREFS }))
      .toEqual(DEFAULT_PREFS);
  });

  it('keeps an enqueued model snapshot after another task choice changes', () => {
    const chosen = { ...DEFAULT_PREFS, model: 'model-a', effort: 'high' };
    const queued = turnOptions(taskPreferences(DEFAULT_PREFS, undefined, chosen), []);
    const changed = { ...chosen, model: 'model-b', effort: 'low' };
    expect(taskPreferences(DEFAULT_PREFS, undefined, changed).model).toBe('model-b');
    expect(queued).toMatchObject({ model: 'model-a', effort: 'high' });
  });
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

  it('resolves a native model identity to the matching menu model and its capabilities', () => {
    const actual = model({ value: 'opus', resolvedModel: 'claude-opus-5-5', supportedEffortLevels: ['max'] });
    const prefs = { ...DEFAULT_PREFS, model: 'claude-opus-5-5', effort: 'max' };
    expect(selectedModel(prefs, [model({}), actual])).toBe(actual);
    expect(turnOptions(prefs, [actual])).toMatchObject({ model: 'claude-opus-5-5', effort: 'max' });
    expect(selectedModel({ model: null }, [model({}), actual])?.value).toBe('default');
    const defaultOnly = model({ resolvedModel: 'claude-opus-5-5' });
    expect(selectedModel(prefs, [defaultOnly])).toBe(defaultOnly);
  });

  it('keeps the choice while the model list has not loaded', () => {
    const prefs = { model: 'opus', effort: 'max', permissionMode: 'acceptEdits' as const };
    expect(turnOptions(prefs, [])).toEqual({ model: 'opus', effort: 'max', permissionMode: 'acceptEdits' });
  });
});

describe('titleOptions', () => {
  it('uses the selected model with a low supported effort', () => {
    const prefs = { ...DEFAULT_PREFS, model: 'opus', effort: 'max' };
    expect(titleOptions(prefs, [model({ value: 'opus', supportedEffortLevels: ['minimal', 'low', 'high'] })])).toEqual({ model: 'opus', effort: 'low' });
  });

  it('keeps unsupported effort out of a title request', () => {
    expect(titleOptions(DEFAULT_PREFS, [model({ supportsEffort: false })])).toEqual({ model: null, effort: null });
    expect(titleOptions(DEFAULT_PREFS, [])).toEqual({ model: null, effort: null });
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

  it('drops a window once it has reset and asks for a new reading', () => {
    const now = Date.parse('2026-11-09T01:20:00Z');
    const passed = { usedPercent: 31, resetsAt: '2026-11-08T21:50:00Z' };
    const current = { usedPercent: 6, resetsAt: '2026-11-15T08:00:00Z' };
    expect(describeUsage(passed, now)).toBeNull();
    expect(usageExpired({ fiveHour: passed, sevenDay: current }, now)).toBe(true);
    expect(usageExpired({ fiveHour: null, sevenDay: current }, now)).toBe(false);
    expect(usageExpired(null, now)).toBe(false);
  });

  it('caps context at 100 percent and handles an unknown window', () => {
    expect(contextPercent(50, 200)).toBe(25);
    expect(contextPercent(500, 200)).toBe(100);
    expect(contextPercent(50, 0)).toBe(0);
  });

  it('maps the mode Claude recorded onto the composer choices', () => {
    expect(sessionPermissionMode('auto')).toBe('auto');
    expect(sessionPermissionMode('default')).toBe('ask');
    expect(sessionPermissionMode('plan')).toBeNull();
    expect(sessionPermissionMode(undefined)).toBeNull();
  });
});
