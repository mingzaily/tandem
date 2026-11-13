// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTaskArchive } from './useTaskArchive';
import { setTaskArchived, type TaskArchiveResult, type TaskSummary } from './api';
import { DEFAULT_SNAPSHOT, preferencesMemory } from './storage';
import { TaskRow } from '../components/Sidebar';
import { TaskMenu } from '../components/TaskMenu';
import { ArchivedTab } from '../components/SettingsView';

vi.mock('./api', async (original) => ({ ...await original<typeof import('./api')>(), setTaskArchived: vi.fn() }));
let root: Root;
let host: HTMLDivElement;
let archive: ReturnType<typeof useTaskArchive>;
const changed = vi.fn(), settled = vi.fn();
const task: TaskSummary = { id: 'one', agent: 'codex', title: 'Codex task', cwd: '/project', updatedAtMs: 0, archived: false };
const result = (id = 'one', archived = true): TaskArchiveResult => ({ taskId: id, archived, agent: 'codex', preferences: { ...DEFAULT_SNAPSHOT, revision: 1 } });
function Harness() { archive = useTaskArchive({ onChanged: changed, onSettled: settled }); return null; }

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperty(navigator, 'language', { configurable: true, value: 'zh-CN' });
  vi.spyOn(preferencesMemory, 'accept').mockImplementation(() => {});
  vi.spyOn(preferencesMemory, 'operation').mockImplementation(async (run) => { preferencesMemory.accept(await run()); });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.clearAllMocks(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('confirmed task archive actions', () => {
  it('waits for native confirmation, submits once and publishes only confirmed state', async () => {
    let resolve!: (value: TaskArchiveResult) => void;
    vi.mocked(setTaskArchived).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    await act(async () => root.render(<Harness />));
    let action!: Promise<void>;
    await act(async () => { action = archive.change(task, true); void archive.change(task, true); });
    expect(setTaskArchived).toHaveBeenCalledExactlyOnceWith('codex', 'one', true);
    expect(archive.archiving.has('one')).toBe(true);
    expect(changed).not.toHaveBeenCalled();
    expect(preferencesMemory.accept).not.toHaveBeenCalled();
    const confirmed = result();
    await act(async () => { resolve(confirmed); await action; });
    expect(changed).toHaveBeenCalledExactlyOnceWith(confirmed);
    expect(preferencesMemory.accept).toHaveBeenCalledExactlyOnceWith(confirmed.preferences);
    expect(archive.archiving.size).toBe(0);
    expect(settled).toHaveBeenCalledExactlyOnceWith(task);
  });

  it('keeps failed native state unconfirmed, reports the reason and permits an idempotent retry', async () => {
    vi.mocked(setTaskArchived).mockRejectedValueOnce(new Error('native archive failed')).mockResolvedValueOnce(result());
    await act(async () => root.render(<Harness />));
    await act(async () => archive.change(task, true));
    expect(changed).not.toHaveBeenCalled();
    expect(archive.archiveError).toContain('native archive failed');
    expect(archive.archiveError).toContain('Codex task');
    expect(archive.archiving.size).toBe(0);
    await act(async () => archive.change(task, true));
    expect(changed).toHaveBeenCalledOnce();
    expect(archive.archiveError).toBeNull();
    expect(settled).toHaveBeenCalledTimes(2);
  });

  it('keeps independent task requests isolated when their responses arrive in reverse order', async () => {
    let first!: (value: TaskArchiveResult) => void;
    vi.mocked(setTaskArchived).mockImplementationOnce(() => new Promise((done) => { first = done; })).mockResolvedValueOnce(result('two', false));
    await act(async () => root.render(<Harness />));
    let pending!: Promise<void>;
    await act(async () => { pending = archive.change(task, true); await archive.change({ ...task, id: 'two' }, false); });
    expect(archive.archiving.has('one')).toBe(true);
    expect(archive.archiving.has('two')).toBe(false);
    await act(async () => { first(result()); await pending; });
    expect(changed.mock.calls.map(([value]) => value.taskId)).toEqual(['two', 'one']);
    expect(archive.archiving.size).toBe(0);
  });
});

describe('archive entry points', () => {
  it('uses the shared native action from the sidebar and keeps busy controls disabled', async () => {
    const onArchive = vi.fn();
    const props: Parameters<typeof TaskRow>[0] = { task, depth: 0, now: 0, isRenaming: false, selectedId: 'one', running: new Set(), waiting: new Set(), unread: new Set(), external: new Map(),
      menuAnchor: null, meta: { pins: [], archived: [], titles: {} }, onSelect() {}, onMetaChange() {}, onRenameDone() {}, onOpenMenu() {}, onArchive };
    await act(async () => root.render(<TaskRow {...props} />));
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="归档"]')!.click());
    expect(onArchive).toHaveBeenCalledExactlyOnceWith(task, true);
    await act(async () => root.render(<TaskRow {...props} archiving={new Set(['one'])} />));
    expect(host.querySelector<HTMLButtonElement>('button[aria-label="归档"]')!.disabled).toBe(true);
  });

  it('restores native archived tasks from the menu without treating them as active', async () => {
    const onArchive = vi.fn();
    const archived = { ...task, archived: true };
    await act(async () => root.render(<TaskMenu task={archived} anchor={{ source: 'sidebar', id: 'one', x: 0, y: 0 }} meta={{ pins: [], archived: [], titles: {} }}
      onArchive={onArchive} onMetaChange={() => {}} onRename={() => {}} onGenerateTitle={() => {}} generatingTitle={false} onClose={() => {}} />));
    expect(document.body.querySelectorAll('[role="menuitem"]')).not.toHaveLength(0);
    const restore = [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((button) => button.textContent === '取消归档')!;
    await act(async () => restore.click());
    expect(onArchive).toHaveBeenCalledExactlyOnceWith(archived, false);
  });

  it('virtualizes long native archive lists and restores the task at the scrolled end', async () => {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.hasAttribute('data-archive-tasks') ? 520 : 76; });
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(520);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(600);
    const onUnarchive = vi.fn();
    const tasks = Array.from({ length: 100 }, (_, index) => ({ ...task, id: String(index), title: 'Task ' + index }));
    await act(async () => root.render(<ArchivedTab archivedGroups={[{ name: 'project', tasks }]} onUnarchive={onUnarchive} />));
    await act(async () => vi.dynamicImportSettled());
    expect(host.querySelectorAll('[role="listitem"]').length).toBeLessThan(30);
    expect(host.textContent).toContain('Task 0');
    const scroller = host.querySelector<HTMLElement>('[data-archive-tasks]')!;
    await act(async () => { scroller.scrollTop = 100 * 76 - 520; scroller.dispatchEvent(new Event('scroll')); });
    const last = host.querySelector<HTMLButtonElement>('[data-index="99"] button')!;
    expect(last).not.toBeNull();
    await act(async () => last.click());
    expect(onUnarchive).toHaveBeenCalledExactlyOnceWith('99');
  });

  it('keeps a failed restore visible in the archive page and supports busy feedback', async () => {
    const onUnarchive = vi.fn();
    const props = { archivedGroups: [{ name: 'project', tasks: [task] }], onUnarchive };
    await act(async () => root.render(<ArchivedTab {...props} archiving={new Set(['one'])} archiveError="Native restore failed" />));
    await act(async () => vi.dynamicImportSettled());
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Native restore failed');
    const restore = host.querySelector<HTMLButtonElement>('button')!;
    expect(restore.disabled).toBe(true);
    expect(restore.getAttribute('aria-busy')).toBe('true');
    await act(async () => root.render(<ArchivedTab {...props} />));
    await act(async () => host.querySelector<HTMLButtonElement>('button')!.click());
    expect(onUnarchive).toHaveBeenCalledExactlyOnceWith('one');
    expect(host.textContent).toContain('Codex task');
  });
});
