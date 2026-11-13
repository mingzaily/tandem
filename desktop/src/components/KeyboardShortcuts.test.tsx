// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsView, ShortcutsTab } from './SettingsView';
import { DEFAULT_SETTINGS } from '../lib/settings';
import { APP_SHORTCUTS } from '../lib/keyboardShortcuts';
import { t } from '../lib/i18n';

vi.mock('../lib/api', async (original) => ({
  ...await original<typeof import('../lib/api')>(),
  notificationStatus: async () => ({ authorization: 'unsupported', badgeEnabled: false }),
}));
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperty(navigator, 'language', { configurable: true, value: 'zh-CN' });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

function keysFor(label: string) {
  const title = [...host.querySelectorAll('span')].find((node) => node.textContent === label && node.children.length === 0)!;
  const row = title.parentElement!.parentElement!;
  return [...row.querySelectorAll('kbd')].map((key) => key.textContent);
}

describe('settings keyboard shortcuts', () => {
  it('offers a shortcuts tab in settings and returns to it after switching tabs', async () => {
    await act(async () => root.render(<SettingsView settings={DEFAULT_SETTINGS} onChange={() => {}} extraProjects={[]} onExtraProjectsChange={() => {}}
      defaultConversationDir="/conversations" sidebarOptions={{ groupByCli: false, sort: 'time' }} onSidebarOptionsChange={() => {}}
      archivedGroups={[]} onUnarchive={() => {}} hiddenAgents={[]} onHiddenAgentsChange={() => {}} version="0.1.0" onBack={() => {}} currentProject={null} />));
    expect(host.querySelector('[role="switch"][aria-label="使用 ⌘Enter 发送"]')).toBeNull();
    const tab = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((node) => node.textContent === '快捷键')!;
    await act(async () => tab.click());
    expect(tab.getAttribute('aria-selected')).toBe('true');
    expect(host.querySelector('[role="tabpanel"]')!.getAttribute('aria-label')).toBe('快捷键');
    expect(host.querySelectorAll('[role="switch"][aria-label="使用 ⌘Enter 发送"]')).toHaveLength(1);
    for (const { label, key } of APP_SHORTCUTS) expect(keysFor(t(label))).toEqual(['⌘', key.toUpperCase()]);
    const appearance = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((node) => node.textContent === '外观')!;
    await act(async () => appearance.click());
    expect(host.querySelector('[role="tabpanel"]')!.getAttribute('aria-label')).toBe('外观');
    await act(async () => tab.click());
    expect(host.textContent).toContain('待发送队列');
  });
  it('changes send, steer and newline key hints immediately when the send preference changes', async () => {
    const save = vi.fn();
    function Fixture() {
      const [settings, setSettings] = useState(DEFAULT_SETTINGS);
      return <ShortcutsTab settings={settings} onChange={(next) => { save(next); setSettings(next); }} />;
    }
    await act(async () => root.render(<Fixture />));
    expect(keysFor('发送消息')).toEqual(['Enter']);
    expect(keysFor('向当前轮次插话')).toEqual(['⌘', 'Enter']);
    expect(keysFor('输入换行')).toEqual(['⇧', 'Enter']);
    await act(async () => host.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
    expect(save).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, sendWithCmdEnter: true });
    expect(keysFor('发送消息')).toEqual(['⌘', 'Enter']);
    expect(keysFor('向当前轮次插话')).toEqual(['⌘', '⇧', 'Enter']);
    expect(keysFor('输入换行')).toEqual(['Enter']);
  });
  it('renders the same shortcut reference in English', async () => {
    Object.defineProperty(navigator, 'language', { configurable: true, value: 'en-US' });
    await act(async () => root.render(<ShortcutsTab settings={DEFAULT_SETTINGS} onChange={() => {}} />));
    expect(host.textContent).toContain('App navigation');
    expect(keysFor('Open settings')).toEqual(['⌘', ',']);
    expect(keysFor('Send message')).toEqual(['Enter']);
    expect(host.textContent).toContain('Focus the drag handle');
  });
  it('describes context and focus requirements for actions that reuse the same keys', async () => {
    await act(async () => root.render(<ShortcutsTab settings={DEFAULT_SETTINGS} onChange={() => {}} />));
    expect(keysFor('打开消息右键菜单')).toEqual(['⇧', 'F10']);
    expect(host.textContent).toContain('再从菜单选择“转为新任务”');
    expect(host.textContent).toContain('先聚焦该条消息左侧的拖动把手');
    expect(host.textContent).toContain('任务输入框为空且没有附件时使用');
    expect(host.textContent).toContain('权限确认卡出现并可操作时生效');
  });
});
