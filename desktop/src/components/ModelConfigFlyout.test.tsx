import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { ModelConfigFlyout } from './ModelConfigFlyout';

vi.hoisted(() => {
  vi.stubGlobal('navigator', { language: 'zh-CN' });
  vi.stubGlobal('document', { body: {} });
});
vi.mock('react-dom', async (original) => ({ ...await original<typeof import('react-dom')>(), createPortal: (children: unknown) => children }));
afterAll(() => vi.unstubAllGlobals());

function render(effort: string | null) {
  return renderToStaticMarkup(<ModelConfigFlyout
    model={{ value: 'audit', displayName: 'Audit', resolvedModel: 'audit', description: '', supportsEffort: true, supportedEffortLevels: ['low', 'high', 'max'], supportsAutoMode: false, defaultEffort: 'high' }}
    name="Audit" source="Codex" effort={effort} anchor={{} as HTMLElement} owner={{ id: 'menu', panel: { current: null } }} focusOnOpen={false}
    onChange={() => {}} onClose={() => {}} />);
}

describe('immediate model configuration', () => {
  it('offers reset as its only button while the slider owns applying changes', () => {
    const html = render('max');
    expect(html).toContain('role="slider"');
    expect(html).toContain('恢复默认');
    expect(html.match(/<button /g)).toHaveLength(1);
    expect(html).not.toContain('使用此模型');
    expect(html).not.toContain('disabled=');
  });

  it('disables reset while following the CLI default', () => {
    const html = render(null);
    expect(html).toContain('disabled=""');
    expect(html).toContain('高 · 默认');
  });
});
