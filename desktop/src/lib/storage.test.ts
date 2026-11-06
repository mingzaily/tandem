import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SNAPSHOT, difference, merge, PreferencesMemory, type PreferencesSnapshot } from './storage';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const snapshot = (): PreferencesSnapshot => structuredClone(DEFAULT_SNAPSHOT);
afterEach(() => { vi.doUnmock('./api'); vi.unstubAllGlobals(); vi.resetModules(); });

describe('backend-owned preferences', () => {
  it('reads the injected theme synchronously and never reads normal preferences from localStorage', async () => {
    const initial = snapshot();
    initial.config.theme = 'dark';
    initial.config.ui_font_size = 16;
    vi.stubGlobal('window', { __TANDEM_PREFERENCES__: initial });
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('legacy storage must not be read'); } });
    vi.resetModules();
    const { loadSettings } = await import('./settings');
    expect(loadSettings()).toMatchObject({ theme: 'dark', uiFontSize: 16 });
  });

  it('removes a local alias while preserving other aliases and shared state', () => {
    const before = { taskMeta: { pins: ['a'], archived: [], titles: { a: 'old', b: 'keep' } }, sidebarWidth: 260 };
    const after = { ...before, taskMeta: { ...before.taskMeta, titles: { b: 'keep' } } };
    const patch = difference(before, after);
    expect(patch).toEqual({ taskMeta: { titles: { a: null } } });
    expect(merge(before, patch)).toEqual(after);
  });

  it('serializes edits and keeps a pending edit visible when an earlier reply arrives', async () => {
    const first = deferred<PreferencesSnapshot>();
    const second = deferred<PreferencesSnapshot>();
    const write = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const memory = new PreferencesMemory(snapshot(), write);
    memory.change('config', { theme: 'dark' });
    memory.change('config', { ui_font_size: 16 });
    expect(write).toHaveBeenCalledTimes(1);
    expect(memory.get().config).toMatchObject({ theme: 'dark', ui_font_size: 16 });
    const saved = snapshot();
    saved.revision = 1;
    saved.config.theme = 'dark';
    first.resolve(saved);
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2));
    expect(memory.get().config.ui_font_size).toBe(16);
    second.resolve({ ...saved, revision: 2, config: { ...saved.config, ui_font_size: 16 } });
    await vi.waitFor(() => expect(memory.get().revision).toBe(2));
    expect(write.mock.calls[1][0]).toEqual({ target: 'config', patch: { ui_font_size: 16 } });
  });

  it('shows a failed save and rolls it back to the valid backend configuration', async () => {
    const change = deferred<PreferencesSnapshot>();
    const memory = new PreferencesMemory(snapshot(), () => change.promise);
    const notify = vi.fn();
    memory.subscribe(notify);
    memory.change('config', { theme: 'dark' });
    expect(notify).not.toHaveBeenCalled();
    expect(memory.get().config.theme).toBe('dark');
    expect(memory.confirmed().config.theme).toBe('system');
    change.reject('config.toml syntax error');
    await vi.waitFor(() => expect(memory.get().errors[0]).toContain('syntax error'));
    expect(memory.get().config.theme).toBe('system');
    expect(memory.confirmed().config.theme).toBe('system');
    expect(notify).toHaveBeenCalled();
  });

  it('ignores older events and overlays pending edits on a manual file change', async () => {
    const response = deferred<PreferencesSnapshot>();
    const memory = new PreferencesMemory(snapshot(), () => response.promise);
    memory.change('config', { theme: 'dark' });
    const manual = snapshot();
    manual.revision = 3;
    manual.config.ui_font_size = 17;
    memory.accept(manual);
    memory.accept(snapshot());
    expect(memory.get().config).toMatchObject({ theme: 'dark', ui_font_size: 17 });
    response.resolve({ ...manual, revision: 4, config: { ...manual.config, theme: 'dark' } });
    await vi.waitFor(() => expect(memory.get().revision).toBe(4));
    expect(memory.get().config.ui_font_size).toBe(17);
  });

  it('keeps project references stable for unrelated configuration and sidebar changes', () => {
    const initial = snapshot();
    initial.config.projects = ['/code/app'];
    const memory = new PreferencesMemory(initial, vi.fn());
    const changed = structuredClone(initial);
    changed.revision = 1;
    changed.config.theme = 'dark';
    changed.state.sidebarWidth = 300;
    memory.accept(changed);
    expect(memory.get().config.projects).toBe(initial.config.projects);
    expect(memory.get().state.taskMeta).toBe(initial.state.taskMeta);
  });

  it('only exports the migration allowlist and leaves the previous version intact', async () => {
    const values = { 'tandem.settings': '{"theme":"dark"}', 'unrelated': 'leave here' };
    const getItem = vi.fn((key: string) => values[key as keyof typeof values] ?? null);
    const setItem = vi.fn();
    const removeItem = vi.fn();
    vi.stubGlobal('localStorage', { getItem, setItem, removeItem });
    const { legacyPreferences } = await import('./storage');
    expect(legacyPreferences()).toEqual({ 'tandem.settings': '{"theme":"dark"}' });
    expect(getItem).not.toHaveBeenCalledWith('unrelated');
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
  });

  it('prepares the first appearance before painting and copies queue files without holding up startup', async () => {
    const copying = deferred<PreferencesSnapshot>();
    const initial = snapshot();
    initial.migrationPending = true;
    const preview = structuredClone(initial);
    preview.revision = 1;
    preview.config.theme = 'dark';
    const migrate = vi.fn(() => copying.promise);
    vi.doMock('./api', () => ({
      readPreferences: async () => initial, onPreferencesChanged: async () => () => {},
      setSystemLanguage: async () => {}, previewPreferences: async () => preview,
      migratePreferences: migrate, updatePreferences: vi.fn(),
    }));
    vi.stubGlobal('localStorage', { getItem: () => null });
    vi.stubGlobal('window', { __TANDEM_PREFERENCES__: initial, addEventListener: vi.fn() });
    vi.stubGlobal('navigator', { language: 'zh-CN' });
    vi.resetModules();
    const storage = await import('./storage');
    await storage.connectPreferences(true);
    expect(storage.preferencesMemory.confirmed().config.theme).toBe('dark');
    expect(storage.preferencesSnapshot().migrationPending).toBe(true);
    expect(migrate).toHaveBeenCalledTimes(1);
    copying.resolve({ ...preview, revision: 2, migrationPending: false });
    await vi.waitFor(() => expect(storage.preferencesSnapshot().migrationPending).toBe(false));
  });
});
