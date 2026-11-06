import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import type { ModelOption } from './api';
import { effectiveEffort, effortStops } from './modelEffort';
import { EffortSlider } from '../components/EffortSlider';

const levels = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const model: ModelOption = { value: 'm', resolvedModel: 'm', displayName: 'Model', description: '', supportsEffort: true, supportsAutoMode: true, supportedEffortLevels: levels, defaultEffort: 'max' };

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('model effort', () => {
  it('keeps the CLI default and every advertised level, including ultra', () => {
    expect(effectiveEffort(model, null)).toBe('max');
    expect(effectiveEffort(model, 'ultra')).toBe('ultra');
    expect(effectiveEffort(model, 'retired')).toBe('max');
    expect(effortStops(levels, 'max')).toEqual(levels);
    expect(effortStops(levels, null)).toEqual([null, ...levels]);
  });

  it('renders all six Codex stops and leaves a fixed level as text', () => {
    const slider = renderToStaticMarkup(createElement(EffortSlider, { levels, value: null, defaultLevel: 'max', onChange: () => {} }));
    expect(slider).toContain('role="slider"');
    expect(slider).toContain('aria-valuemax="5"');
    expect(slider).toContain('aria-valuenow="4"');
    const fixed = renderToStaticMarkup(createElement(EffortSlider, { levels: ['high'], value: null, defaultLevel: 'high', onChange: () => {} }));
    expect(fixed).not.toContain('role="slider"');
    expect(fixed).not.toContain('NaN');
  });

  it('supports Pi off and keeps a default slot while its default is unknown', () => {
    const pi = { ...model, supportedEffortLevels: ['off', 'low', 'high', 'max'], defaultEffort: 'high' };
    expect(effectiveEffort(pi, 'off')).toBe('off');
    expect(effectiveEffort(pi, 'medium')).toBe('high');
    expect(effectiveEffort({ ...pi, defaultEffort: null }, null)).toBeNull();
  });

  it('gives each Chinese effort a distinct name and labels off', async () => {
    vi.stubGlobal('navigator', { language: 'zh-CN' });
    vi.resetModules();
    const { effortLabel } = await import('./modelEffort');
    expect(levels.map(effortLabel)).toEqual(['低', '中', '高', '超高', '最高', '极限']);
    expect(effortLabel('off')).toBe('关闭思考');
    expect(effortLabel('future')).toBe('future');
  });
});
