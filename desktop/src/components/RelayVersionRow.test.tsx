import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { RelayVersionRow } from './SettingsView';
vi.hoisted(() => vi.stubGlobal('navigator', { language: 'zh-CN' }));
afterAll(() => vi.unstubAllGlobals());

describe('connected relay version', () => {
  it('shows the relay version separately from the desktop version', () => {
    const html = renderToStaticMarkup(<RelayVersionRow state={{ status: 'online', relayVersion: '0.1.2026111102' }} />);
    expect(html).toContain('中转版本');
    expect(html).toContain('0.1.2026111102');
  });
  it('does not show an old server version while disconnected', () => {
    const html = renderToStaticMarkup(<RelayVersionRow state={{ status: 'connecting', relayVersion: '0.1.2026111102' }} />);
    expect(html).toContain('连接后查看版本');
    expect(html).not.toContain('0.1.2026111102');
  });
  it('states when the connected relay omits version information', () => {
    const html = renderToStaticMarkup(<RelayVersionRow state={{ status: 'online', relayVersion: null }} />);
    expect(html).toContain('当前中转未提供版本');
  });
});
