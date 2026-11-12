import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { UpdateAction, UpdateDetails } from './AppUpdateControl';
import { AboutTab } from './SettingsView';
import { DEFAULT_SETTINGS } from '../lib/settings';
import type { UpdateState } from '../lib/appUpdate';
vi.hoisted(() => vi.stubGlobal('navigator', { language: 'zh-CN' }));
afterAll(() => vi.unstubAllGlobals());
const action = (phase: UpdateState['phase']) => renderToStaticMarkup(<UpdateAction state={{ phase, revision: 1 }} check={() => {}} download={() => {}} install={() => {}} />);
const details = (state: Omit<UpdateState, 'revision'>) => renderToStaticMarkup(<UpdateDetails state={{ revision: 1, ...state }} />);

describe('about page updates', () => {
  it('offers checks, downloads and restart as settings buttons in the correct phase', () => {
    expect(action('idle')).toContain('检查更新');
    expect(action('available')).toContain('下载更新');
    expect(action('available')).not.toContain('安装并重启');
    expect(action('ready')).toContain('安装并重启');
    for (const phase of ['checking', 'downloading', 'installing'] as const) expect(action(phase)).toContain('disabled=""');
  });
  it('puts update controls next to the version, with persistent automatic update options', () => {
    const html = renderToStaticMarkup(<AboutTab version="0.1.2026111101" settings={DEFAULT_SETTINGS} onChange={() => {}} />);
    expect(html).toContain('版本 0.1.2026111101');
    expect(html).toContain('检查更新');
    expect(html).toMatch(/role="switch"[^>]*aria-label="自动更新"[^>]*aria-checked="false"/);
    expect(html).toContain('aria-label="检查更新间隔"');
    expect(html).toContain('每 6 小时');
    expect(html).toContain('安装和重启由你确认');
    expect(html).not.toContain('role="menu"');
  });
  it('shows progress, escaped notes and the install confirmation hint', () => {
    const update = { version: '0.1.2026111102', notes: '<script>alert(1)</script>' };
    const html = details({ phase: 'downloading', progress: { downloaded: 50, total: 100 }, update });
    expect(html).toContain('50%');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(details({ phase: 'ready', update })).toContain('请先等待运行中的任务结束');
  });
  it('shows failures inline and keeps idle layout compact', () => {
    expect(details({ phase: 'idle', error: 'HTTP 404' })).toContain('role="alert"');
    expect(details({ phase: 'idle', error: 'HTTP 404' })).toContain('HTTP 404');
    expect(details({ phase: 'idle' })).toBe('');
  });
});
