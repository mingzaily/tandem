import { describe, expect, it } from 'vitest';
import type { ModelOption } from './api';
import { modelPrefsFor, modelRowsOf } from './modelRows';

function model(value: string, resolvedModel = value): ModelOption {
  return { value, resolvedModel, displayName: value, description: '', supportsEffort: false, supportedEffortLevels: [], defaultEffort: null, supportsAutoMode: false };
}

describe('CLI default model rows', () => {
  it('applies a model and its configured strength together while preserving permissions', () => {
    const option = { ...model('another'), supportsEffort: true, supportedEffortLevels: ['low', 'max'] };
    const prefs = { model: 'first', effort: 'low', permissionMode: 'auto' as const };
    expect(modelPrefsFor(prefs, option, false, 'max')).toEqual({ model: 'another', effort: 'max', permissionMode: 'auto' });
    expect(prefs.model).toBe('first');
    expect(prefs.effort).toBe('low');
  });

  it('keeps default model and default strength as references to CLI configuration', () => {
    const option = { ...model('default-model'), supportsEffort: true, supportedEffortLevels: ['low', 'max'] };
    expect(modelPrefsFor({ model: 'first', effort: 'max', permissionMode: 'ask' }, option, true, null))
      .toEqual({ model: null, effort: null, permissionMode: 'ask' });
  });

  it('clears strength when a newly chosen model cannot use the previous level', () => {
    const prefs = { model: 'first', effort: 'ultra', permissionMode: 'ask' as const };
    expect(modelPrefsFor(prefs, model('without-thinking'), false).effort).toBeNull();
    expect(modelPrefsFor(prefs, { ...model('other'), supportsEffort: true, supportedEffortLevels: ['low', 'high'] }, false).effort).toBeNull();
  });

  it.each([
    ['Claude Code', 'opus', 'claude-opus-5-5'],
    ['Codex', 'gpt-6.1-sol', 'gpt-6.1-sol'],
    ['Pi', 'provider/model', 'provider/model'],
  ])('%s marks its resolved default and keeps one model row', (_agent, value, resolved) => {
    const alias = model('default', resolved), actual = model(value, resolved), other = model('another');
    const { rows, followsConfig } = modelRowsOf([alias, actual, other]);
    expect(rows).toEqual([actual, other]);
    expect(rows.filter(followsConfig)).toEqual([actual]);
    expect(followsConfig(other)).toBe(false);
  });

  it('retains an unresolved default without treating unresolved models as the same model', () => {
    const alias = model('default', ''), first = model('first', ''), second = model('second', '');
    const { rows, followsConfig } = modelRowsOf([alias, first, second]);
    expect(rows).toEqual([alias, first, second]);
    expect(rows.filter(followsConfig)).toEqual([alias]);
  });

  it('leaves the default unknown when the CLI reports none', () => {
    const options = [model('first'), model('second')];
    const { rows, followsConfig } = modelRowsOf(options);
    expect(rows).toEqual(options);
    expect(rows.filter(followsConfig)).toEqual([]);
  });

  it('moves the default mark when a refreshed CLI snapshot names another model', () => {
    const first = model('first'), second = model('second');
    const original = modelRowsOf([model('default', 'first'), first, second]);
    const refreshed = modelRowsOf([model('default', 'second'), first, second]);
    expect(original.rows.filter(original.followsConfig)).toEqual([first]);
    expect(refreshed.rows.filter(refreshed.followsConfig)).toEqual([second]);
  });
});
