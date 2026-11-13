// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UpdateStatus } from './AppUpdateControl';
import { PendingQueuePanel } from './PendingQueuePanel';
import type { TaskQueue } from '../lib/api';
import type { UpdateState } from '../lib/appUpdate';

const transport = vi.hoisted(() => ({ state: { phase: 'ready', revision: 3, update: { version: '0.2.0', notes: '## 新增\n\n支持队列转新任务。' } } as UpdateState }));
vi.mock('../lib/api', async (original) => ({
  ...await original<typeof import('../lib/api')>(),
  readAppUpdate: async () => transport.state,
  onAppUpdateChanged: async () => () => {},
}));
vi.mock('../lib/useQueueDrag', () => ({ useQueueDrag: () => ({ drag: null, sorting: false, startDrag() {} }) }));
vi.mock('@tanstack/react-virtual', () => ({ useVirtualizer: ({ count }: { count: number }) => ({
  getTotalSize: () => 6 + count * 32,
  getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ key: index, index, start: 6 + index * 32 })),
  measureElement() {}, scrollToIndex() {}, measurementsCache: [],
}) }));
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperty(navigator, 'language', { configurable: true, value: 'zh-CN' });
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (this: HTMLDialogElement) { this.open = true; });
  vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (this: HTMLDialogElement) { this.open = false; });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const queue: TaskQueue = { taskId: 'source', agent: 'pi', paused: false, pausedAfterRestart: false, error: null, revision: 1,
  entries: [{ id: 'one', prompt: '待发送的完整消息', attachments: [], options: { model: 'chosen', effort: 'high', permissionMode: null } }] };

async function renderQueue(onNewTask = vi.fn(async () => {}), onError = vi.fn()) {
  await act(async () => root.render(<PendingQueuePanel queue={queue} onNewTask={onNewTask} onError={onError} onEdit={() => {}} onChange={() => {}} running onSteer={() => {}} />));
  const row = host.querySelector<HTMLElement>('[data-queue-entry]')!;
  return { row, onNewTask, onError };
}

describe('update details', () => {
  it('opens release notes from the capsule and closes with Escape without installing', async () => {
    await act(async () => root.render(<UpdateStatus state={transport.state} compact />));
    const capsule = host.querySelector<HTMLButtonElement>('button')!;
    expect(capsule.textContent).toBe('更新已就绪');
    await act(async () => { capsule.click(); await vi.dynamicImportSettled(); });
    const dialog = document.querySelector('dialog')!;
    expect(dialog.open).toBe(true);
    expect(dialog.textContent).toContain('Tandem 0.2.0');
    expect(dialog.querySelector('h2 + p')).not.toBeNull();
    expect(dialog.textContent).toContain('支持队列转新任务。');
    expect(dialog.textContent).toContain('安装并重启');
    await act(async () => { dialog.dispatchEvent(new Event('cancel', { cancelable: true })); });
    expect(document.querySelector('dialog')).toBeNull();
  });
});

describe('queue context menu', () => {
  it('keeps the three row actions and moves only through the context menu', async () => {
    const { row, onNewTask } = await renderQueue();
    expect(row.querySelectorAll('button')).toHaveLength(4); // Drag handle plus the original three actions.
    expect(document.querySelector('[role="menu"]')).toBeNull();
    await act(async () => { row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 50 })); });
    const item = document.querySelector<HTMLButtonElement>('[role="menuitem"]')!;
    expect(item.textContent).toBe('转为新任务');
    await act(async () => item.click());
    expect(onNewTask).toHaveBeenCalledExactlyOnceWith(queue.entries[0]);
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });
  it('supports Shift+F10 and keeps the message available after a failed transfer', async () => {
    const onNewTask = vi.fn(async () => { throw new Error('queue locked'); });
    const { row, onError } = await renderQueue(onNewTask);
    await act(async () => { row.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true })); });
    await act(async () => document.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click());
    expect(onError).toHaveBeenCalledOnce();
    expect(row.textContent).toContain('待发送的完整消息');
    expect(document.querySelector<HTMLButtonElement>('[role="menuitem"]')!.disabled).toBe(false);
  });
});
