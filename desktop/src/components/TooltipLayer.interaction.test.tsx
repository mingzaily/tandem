// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Attachment, TaskQueue } from '../lib/api';
import { PendingQueuePanel } from './PendingQueuePanel';
import { TooltipLayer } from './TooltipLayer';

vi.mock('../lib/useQueueDrag', () => ({ useQueueDrag: () => ({ drag: null, sorting: false, startDrag() {} }) }));
vi.mock('@tanstack/react-virtual', () => ({ useVirtualizer: ({ count }: { count: number }) => ({
  getTotalSize: () => 6 + count * 32,
  getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ key: index, index, start: 6 + index * 32 })),
  measureElement() {}, scrollToIndex() {}, measurementsCache: [],
}) }));
let root: Root;
let host: HTMLDivElement;
const images = (count: number): Attachment[] => Array.from({ length: count }, (_, id) => ({ id: String(id), kind: 'image', name: 'image', preview: 'data:image/png;base64,test' }));
const file = (name: string): Attachment => ({ id: name, kind: 'file', name, path: '/project/' + name });
const queue = (attachments: Attachment[], prompt = '第一行正文\n第二行正文'): TaskQueue => ({ taskId: 'task', agent: 'pi', revision: 1, paused: true, pausedAfterRestart: false, error: null,
  entries: [{ id: 'one', prompt, attachments, options: { model: null, effort: null, permissionMode: null } }],
});
const tooltip = () => document.querySelector<HTMLElement>('[role="tooltip"]');
const tags = () => [...document.querySelectorAll('.app-tooltip-tag')].map((tag) => tag.textContent);
const body = () => host.querySelector<HTMLElement>('[data-queue-entry] p')!;

function Fixture({ state }: { state?: TaskQueue }) {
  return <>
    {state ? <PendingQueuePanel queue={state} onNewTask={async () => {}} onError={() => {}} onEdit={() => {}} onChange={() => {}} running onSteer={() => {}} /> : null}
    <button data-tooltip="正常按钮说明" data-tooltip-tags="{invalid" aria-describedby="existing">普通按钮</button>
    <TooltipLayer />
  </>;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  Object.defineProperty(navigator, 'language', { configurable: true, value: 'zh-CN' });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function hover(target: HTMLElement) {
  await act(async () => { target.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' })); });
  await act(async () => vi.advanceTimersByTimeAsync(1000));
}

describe('queue attachment tooltip labels', () => {
  it('keeps the complete body and groups pasted images into one tag while rendering file names as text', async () => {
    const name = '预算<draft>&"原稿".md';
    await act(async () => root.render(<Fixture state={queue([...images(4), file(name)])} />));
    const anchor = body();
    await act(async () => anchor.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' })));
    await act(async () => vi.advanceTimersByTimeAsync(999));
    expect(tooltip()).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(tooltip()?.firstElementChild?.textContent).toBe('第一行正文\n第二行正文');
    expect(tags()).toEqual(['图片 × 4', name]);
    expect(tooltip()?.querySelector('draft')).toBeNull();
    expect(tooltip()?.textContent).not.toContain('image\nimage');
    expect(anchor.getAttribute('aria-describedby')).toBe(tooltip()?.id);
    const image = host.querySelector<HTMLElement>('[aria-label="4 张图片"]')!;
    expect(image.dataset.tooltip).toBe('4 张图片');
    expect(host.querySelectorAll('[data-queue-entry] img')).toHaveLength(1);
  });

  it.each([
    { language: 'zh-CN', bodyLabel: '附件', imageLabel: '图片 × 1' },
    { language: 'en-US', bodyLabel: 'Attachments', imageLabel: 'Images × 1' },
  ])('shows attachment-only queues in $language', async ({ language, bodyLabel, imageLabel }) => {
    Object.defineProperty(navigator, 'language', { configurable: true, value: language });
    await act(async () => root.render(<Fixture state={queue(images(1), '')} />));
    await hover(body());
    expect(tooltip()?.firstElementChild?.textContent).toBe(bodyLabel);
    expect(tags()).toEqual([imageLabel]);
  });

  it('updates the open attachment tags when only attachments change and closes when the row is removed', async () => {
    await act(async () => root.render(<Fixture state={queue(images(4))} />));
    const anchor = body();
    await hover(anchor);
    expect(tags()).toEqual(['图片 × 4']);
    await act(async () => { root.render(<Fixture state={queue([...images(2), file('notes.txt')])} />); });
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(tags()).toEqual(['图片 × 2', 'notes.txt']);
    await act(async () => root.render(<Fixture />));
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(tooltip()).toBeNull();
    expect(anchor.hasAttribute('aria-describedby')).toBe(false);
  });

  it('keeps ordinary keyboard tooltips and their original accessible descriptions intact', async () => {
    await act(async () => root.render(<Fixture />));
    const button = host.querySelector<HTMLButtonElement>('button')!;
    await act(async () => button.focus());
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(tooltip()?.textContent).toBe('正常按钮说明');
    expect(tags()).toEqual([]);
    expect(button.getAttribute('aria-describedby')).toBe('existing ' + tooltip()?.id);
    await act(async () => button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(tooltip()).toBeNull();
    expect(button.getAttribute('aria-describedby')).toBe('existing');
  });
});
