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
  it('reads the injected theme synchronously and never reads normal preferences from browser persistence', async () => {
    const initial = snapshot();
    initial.config.theme = 'dark';
    initial.config.ui_font_size = 16;
    vi.stubGlobal('window', { __TANDEM_PREFERENCES__: initial });
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('browser persistence must not be read'); } });
    vi.resetModules();
    const { loadSettings } = await import('./settings');
    expect(loadSettings()).toMatchObject({ theme: 'dark', uiFontSize: 16 });
  });

  it('saves automatic update and debug log settings through the normal backend configuration patch', async () => {
    const initial = snapshot();
    vi.stubGlobal('window', { __TANDEM_PREFERENCES__: initial });
    const write = vi.fn(async (_target: string, patch: object) => ({ ...initial, revision: 1, config: { ...initial.config, ...patch } }));
    vi.doMock('./api', () => ({ updatePreferences: write }));
    vi.resetModules();
    const { loadSettings, saveSettings } = await import('./settings');
    expect(loadSettings()).toMatchObject({ autoUpdate: false, updateCheckIntervalHours: 6 });
    saveSettings({ ...loadSettings(), autoUpdate: true, updateCheckIntervalHours: 12 });
    await vi.waitFor(() => expect(write).toHaveBeenCalledWith('config', { auto_update: true, update_check_interval_hours: 12 }));
    expect(loadSettings()).toMatchObject({ autoUpdate: true, updateCheckIntervalHours: 12, debugLog: false });
    saveSettings({ ...loadSettings(), debugLog: true });
    await vi.waitFor(() => expect(write).toHaveBeenLastCalledWith('config', { debug_log: true }));
    expect(loadSettings()).toMatchObject({ debugLog: true });
  });

  it('reads saved sidebar folds before first render and writes them through the backend state patch', async () => {
    const initial = snapshot();
    initial.state.collapsedSidebarGroups = ['/code/alpha'];
    initial.state.pinnedProjects = ['/code/beta'];
    vi.stubGlobal('window', { __TANDEM_PREFERENCES__: initial });
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('sidebar folds belong to state.json'); } });
    const write = vi.fn(async (_target: string, patch: object) => ({ ...initial, revision: 1, state: { ...initial.state, ...patch } }));
    vi.doMock('./api', () => ({ updatePreferences: write }));
    vi.resetModules();
    const { preferencesSnapshot, saveViewState } = await import('./storage');
    expect(preferencesSnapshot().state.collapsedSidebarGroups).toEqual(['/code/alpha']);
    saveViewState({ collapsedSidebarGroups: ['/code/alpha', '/code/beta:pi'] });
    await vi.waitFor(() => expect(write).toHaveBeenCalledExactlyOnceWith('state', { collapsedSidebarGroups: ['/code/alpha', '/code/beta:pi'] }));
    expect(preferencesSnapshot().state.pinnedProjects).toEqual(['/code/beta']);
    expect(preferencesSnapshot().state.collapsedSidebarGroups).toEqual(['/code/alpha', '/code/beta:pi']);
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

  it('serializes native archive operations with view writes and rebases queued pin changes', async () => {
    const initial = snapshot();
    initial.state.taskMeta.pins = ['archiving', 'other'];
    const first = deferred<PreferencesSnapshot>(), native = deferred<PreferencesSnapshot>();
    const write = vi.fn().mockReturnValueOnce(first.promise).mockImplementationOnce(async ({ patch }) => ({
      ...archived, revision: 3, state: { ...archived.state, taskMeta: { ...archived.state.taskMeta, pins: patch.taskMeta.pins } },
    }));
    const run = vi.fn(() => native.promise);
    const memory = new PreferencesMemory(initial, write);
    memory.change('config', { theme: 'dark' });
    const archived = structuredClone(initial);
    archived.revision = 2; archived.config.theme = 'dark'; archived.state.taskMeta.pins = ['other'];
    const operation = memory.operation(run);
    memory.change('state', { taskMeta: { ...memory.get().state.taskMeta, pins: ['new', 'archiving', 'other'] } });
    expect(run).not.toHaveBeenCalled();
    first.resolve({ ...initial, revision: 1, config: { ...initial.config, theme: 'dark' } });
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    expect(write).toHaveBeenCalledTimes(1);
    native.resolve(archived);
    await operation;
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2));
    expect(write.mock.calls[1][0]).toEqual({ target: 'state', patch: { taskMeta: { pins: ['new', 'other'] } } });
    await vi.waitFor(() => expect(memory.get().state.taskMeta.pins).toEqual(['new', 'other']));
  });

  it('releases the preference writer after a native archive failure and keeps confirmed state', async () => {
    const native = deferred<PreferencesSnapshot>();
    const initial = snapshot();
    const write = vi.fn(async ({ patch }) => ({ ...initial, revision: 1, config: { ...initial.config, ...patch } }));
    const memory = new PreferencesMemory(initial, write);
    const operation = memory.operation(() => native.promise);
    const rejected = expect(operation).rejects.toThrow('native failed');
    memory.change('config', { theme: 'dark' });
    expect(write).not.toHaveBeenCalled();
    native.reject(new Error('native failed'));
    await rejected;
    await vi.waitFor(() => expect(memory.get().config.theme).toBe('dark'));
    expect(memory.get().state.taskMeta.archived).toEqual([]);
    expect(write).toHaveBeenCalledOnce();
  });

  it('saves a late alias change without bringing back archive marks or pins from its stale source', async () => {
    const initial = snapshot();
    const previous = { pins: ['one'], archived: ['older'], titles: { one: 'old' } };
    initial.state.taskMeta = { pins: ['other'], archived: [], titles: { one: 'old', two: 'newer alias' } };
    vi.stubGlobal('window', { __TANDEM_PREFERENCES__: initial });
    const write = vi.fn(async (_target: string, patch: object) => ({ ...initial, revision: 1, state: merge(initial.state, patch) }));
    vi.doMock('./api', () => ({ updatePreferences: write }));
    vi.resetModules();
    const { saveTaskMeta } = await import('./preferences');
    saveTaskMeta({ ...previous, titles: { one: 'saved title' } }, previous);
    await vi.waitFor(() => expect(write).toHaveBeenCalledExactlyOnceWith('state', { taskMeta: { titles: { one: 'saved title' } } }));
    const { preferencesSnapshot } = await import('./storage');
    expect(preferencesSnapshot().state.taskMeta).toEqual({ pins: ['other'], archived: [], titles: { one: 'saved title', two: 'newer alias' } });
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

});
