import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { UpdateAction, UpdateStatus } from './AppUpdateControl';
import { AboutTab } from './SettingsView';
import { DEFAULT_SETTINGS } from '../lib/settings';
import type { UpdateState } from '../lib/appUpdate';
vi.hoisted(() => vi.stubGlobal('navigator', { language: 'zh-CN' }));
afterAll(() => vi.unstubAllGlobals());
const action = (phase: UpdateState['phase']) => renderToStaticMarkup(<UpdateAction state={{ phase, revision: 1 }} check={() => {}} download={() => {}} install={() => {}} />);
const status = (state: Omit<UpdateState, 'revision'>) => renderToStaticMarkup(<UpdateStatus state={{ revision: 1, ...state }} />);

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
  it('keeps status and progress in one chip, with full notes and restart guidance in its tooltip', () => {
    const update = { version: '0.1.2026111102', notes: '<script>alert(1)</script>' };
    const html = status({ phase: 'downloading', progress: { downloaded: 50, total: 100 }, update });
    expect(html).toContain('50%');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('data-tooltip=');
    expect(html).not.toContain('<p');
    expect(html).not.toContain('<progress');
    expect(status({ phase: 'ready', update })).toContain('请先等待运行中的任务结束');
    expect(status({ phase: 'available', update })).toContain('<span class="truncate">发现新版本 0.1.2026111102</span>');
  });
  it('shows a compact failure with the full reason and keeps idle layout empty', () => {
    const html = status({ phase: 'idle', error: 'HTTP 404' });
    expect(html).toContain('role="alert"');
    expect(html).toContain('HTTP 404');
    expect(html).toContain('<span class="truncate">更新失败</span>');
    expect(status({ phase: 'idle' })).toBe('');
  });
});
