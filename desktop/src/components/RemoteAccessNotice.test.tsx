import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { RemoteAccessIndicator, RemoteAccessNotice } from './RemoteAccessNotice';
import type { RemoteClient } from '../lib/api';

vi.hoisted(() => vi.stubGlobal('navigator', { language: 'zh-CN' }));
afterAll(() => vi.unstubAllGlobals());
const phone = (clientId: string, name: string): RemoteClient => ({ clientId, name, pairedAtMs: 0, isOnline: true });
const render = (clients: RemoteClient[], error: string | null = null) => renderToStaticMarkup(
  <RemoteAccessNotice clients={clients} error={error} onRetry={() => {}} onManage={() => {}} onCollapse={() => {}} onRevoke={async () => {}} />,
);

describe('remote access capsule', () => {
  it('leaves no layout when there are no connected phones', () => {
    expect(render([])).toBe('');
  });

  it('names one device and separates collapse from revoking access', () => {
    const html = render([phone('a', 'iPhone')]);
    expect(html).toContain('iPhone 已连接');
    expect(html).toContain('撤销访问');
    expect(html).toContain('aria-label="收起手机连接提示"');
    expect(html).not.toContain('管理设备');
    expect(html).not.toContain('Cindy');
  });

  it('offers device management when multiple phones are connected', () => {
    const html = render([phone('a', 'iPhone'), phone('b', 'Pixel')]);
    expect(html).toContain('2 台设备已连接');
    expect(html).toContain('管理设备');
    expect(html).toContain('iPhone · Pixel');
    expect(html).not.toContain('>撤销访问</button>');
  });

  it('retains complete escaped device names in the tooltip', () => {
    const name = '<工作手机> ' + '长名字'.repeat(30);
    expect(render([phone('a', name)])).toContain('&lt;工作手机&gt;');
    expect(render([phone('a', name)])).toContain('长名字'.repeat(30));
  });

  it('keeps a discoverable connection indicator when collapsed', () => {
    const html = renderToStaticMarkup(<RemoteAccessIndicator clients={[phone('a', 'iPhone')]} onExpand={() => {}} />);
    expect(html).toContain('aria-label="展开手机连接提示"');
    expect(html).toContain('iPhone 已连接');
    expect(html).not.toContain('>撤销访问<');
  });

  it('reports unreadable presence instead of claiming a stale device is online', () => {
    const html = render([phone('a', 'iPhone')], 'IPC unavailable');
    expect(html).toContain('role="alert"');
    expect(html).toContain('读取手机连接状态失败');
    expect(html).toContain('重新读取');
    expect(html).not.toContain('iPhone 已连接');
    expect(html).not.toContain('>撤销访问<');
  });
});
