import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, it, vi } from 'vitest';
import ModelPickerPanel, { type ModelAgentChoice } from './ModelPickerPanel';

vi.hoisted(() => {
  vi.stubGlobal('navigator', { language: 'zh-CN' });
});
afterAll(() => vi.unstubAllGlobals());

describe('model selection and configuration controls', () => {
  it('uses separate buttons for selecting and configuring each model', () => {
    const choice: ModelAgentChoice = {
      agent: 'codex', prefs: { model: 'audit', effort: null, permissionMode: 'ask' }, usage: null,
      models: [{ value: 'audit', displayName: 'Audit', resolvedModel: 'audit', description: 'Model description', supportsEffort: true, supportedEffortLevels: ['low', 'high'], supportsAutoMode: false, defaultEffort: 'high' }],
      status: { loading: false, error: null }, onRefresh: () => {}, onChoose: () => {},
    };
    const html = renderToStaticMarkup(<ModelPickerPanel current={choice} others={[]} owner={{ id: 'menu', panel: { current: null } }} onClose={() => {}} />);
    expect(html).toContain('role="list"');
    expect(html).toContain('role="listitem"');
    expect(html).not.toContain('role="option"');
    expect(html).toMatch(/<button[^>]*data-model-select[^>]*aria-pressed="true"/);
    expect(html).toContain('aria-keyshortcuts="ArrowLeft"');
    expect(html).toContain('data-row-customize');
    expect(html).toContain('aria-label="配置模型：Audit"');
  });
});
