// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MessageStream from './MessageStream';
import { ConversationLayout } from './ConversationLayout';
import type { Item } from '../lib/items';

const observers = new Set<{ callback: ResizeObserverCallback; targets: Set<Element> }>();
const measured: number[] = [];
const heights = new Map<number, number>();
let overlayHeight = 180;
const roots: Root[] = [];
const height = (element: Element) => element.hasAttribute('data-index') ? heights.get(Number(element.getAttribute('data-index'))) ?? 80
  : element.classList.contains('message-scroll') ? 600 : element.classList.contains('conversation-composer') ? overlayHeight : 0;

beforeEach(() => {
  measured.length = 0; heights.clear(); observers.clear(); overlayHeight = 180;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('navigator', { language: 'zh-CN' });
  vi.stubGlobal('ResizeObserver', class {
    targets = new Set<Element>();
    constructor(public callback: ResizeObserverCallback) { observers.add(this); }
    observe(element: Element) { this.targets.add(element); }
    unobserve(element: Element) { this.targets.delete(element); }
    disconnect() { observers.delete(this); }
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.hasAttribute('data-index')) measured.push(Number(this.dataset.index));
    return new DOMRect(0, 0, 900, height(this));
  });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) { return height(this); });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) { return height(this); });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(900);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(900);
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('message-scroll') ? Number.parseFloat((this.firstElementChild as HTMLElement)?.style.height || '0') : height(this);
  });
  vi.spyOn(HTMLElement.prototype, 'scrollTo').mockImplementation(function (this: HTMLElement, options: number | ScrollToOptions) {
    const top = typeof options === 'number' ? options : options.top ?? this.scrollTop;
    this.scrollTop = Math.max(0, Math.min(top, this.scrollHeight - this.clientHeight));
    queueMicrotask(() => this.dispatchEvent(new Event('scroll')));
  });
});
afterEach(async () => {
  await act(async () => { for (const root of roots.splice(0)) root.unmount(); });
  document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

function notifySizes() {
  for (const observer of observers) observer.callback([...observer.targets].map((target) => ({
    target, contentRect: target.getBoundingClientRect(), borderBoxSize: [{ inlineSize: 900, blockSize: height(target) }],
    contentBoxSize: [{ inlineSize: 900, blockSize: height(target) }],
    devicePixelContentBoxSize: [{ inlineSize: 900, blockSize: height(target) }],
  })), observer as unknown as ResizeObserver);
}
const turns = (prefix: string, count: number): Item[] => Array.from({ length: count }, (_, index): Item[] => [
  { type: 'user', id: `${prefix}-u-${index}`, text: `${prefix} input ${index}` },
  { type: 'assistant', id: `${prefix}-a-${index}`, text: `${prefix} reply ${index}` },
]).flat();
async function fixture() {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host); roots.push(root);
  const props: Parameters<typeof MessageStream>[0] = {
    taskId: 'short-a', agent: 'pi', items: turns('A', 1), isRunning: false, editableId: null, onEditLast: async () => {},
    sendWithCmdEnter: false, isLoading: false, cwd: '/code', bottomPadding: 180,
  };
  const render = async () => { await act(async () => root.render(<MessageStream {...props} />)); };
  await render();
  return { host, props, render, scroll: () => host.querySelector<HTMLElement>('.message-scroll')! };
}

describe('message stream task-switch layout', () => {
  it('opens B from its tail after short A and the native-history loading state', async () => {
    const test = await fixture();
    expect(test.scroll().scrollTop).toBe(0);
    test.props.taskId = 'long-b'; test.props.isLoading = true;
    test.props.items = [{ type: 'assistant', id: 'b-live', text: 'partial B live tail' }];
    await test.render();
    expect(test.host.querySelector('.message-scroll')).toBeNull();
    test.props.items = turns('B', 80); test.props.isLoading = false;
    measured.length = 0;
    await test.render();
    expect(test.host.textContent).toContain('B reply 79');
    expect(test.host.textContent).not.toContain('A reply');
    expect(measured).not.toContain(0);
    expect(test.scroll().scrollHeight - test.scroll().scrollTop - test.scroll().clientHeight).toBeLessThanOrEqual(1);
    test.props.taskId = 'short-a'; test.props.items = turns('A', 1);
    await test.render();
    expect(test.scroll().scrollTop).toBe(0);
    expect(test.host.textContent).not.toContain('B reply');
  });

  it('keeps following a short task after a wheel movement that cannot scroll its content', async () => {
    const test = await fixture();
    await act(async () => test.scroll().dispatchEvent(new WheelEvent('wheel', { deltaY: -80, bubbles: true })));
    test.props.items = turns('A', 40);
    await test.render();
    expect(test.scroll().scrollHeight - test.scroll().scrollTop - test.scroll().clientHeight).toBeLessThanOrEqual(1);
    expect(test.host.textContent).toContain('A reply 39');
  });

  it('keeps the tail visible as actual row height or the composer inset changes', async () => {
    const test = await fixture();
    test.props.items = turns('long', 40); test.props.taskId = 'long';
    await test.render();
    heights.set(79, 240);
    await act(async () => notifySizes());
    expect(test.scroll().scrollHeight - test.scroll().scrollTop - test.scroll().clientHeight).toBeLessThanOrEqual(1);
    test.props.bottomPadding = 360;
    await test.render();
    expect(test.scroll().scrollHeight - test.scroll().scrollTop - test.scroll().clientHeight).toBeLessThanOrEqual(1);
    expect(test.host.textContent).toContain('long reply 39');
  });

  it('offers the Cindy chip while moving down in history, prioritizes new-message count and restores follow on click', async () => {
    const test = await fixture();
    test.props.items = turns('long', 40); test.props.taskId = 'jump';
    await test.render();
    const chip = () => test.host.querySelector<HTMLButtonElement>('[data-jump-to-bottom] button')!;
    await act(async () => {
      test.scroll().dispatchEvent(new WheelEvent('wheel', { deltaY: -300, bubbles: true }));
      test.scroll().scrollTop -= 400;
      test.scroll().dispatchEvent(new Event('scroll'));
    });
    expect(chip().parentElement!.getAttribute('aria-hidden')).toBe('true');
    await act(async () => {
      test.scroll().scrollTop += 40;
      test.scroll().dispatchEvent(new Event('scroll'));
    });
    expect(chip().parentElement!.getAttribute('aria-hidden')).toBe('false');
    expect(chip().parentElement!.style.bottom).toBe('192px');
    test.props.items = [...test.props.items, { type: 'assistant', id: 'new-answer', text: 'a fresh answer while away' }];
    await test.render();
    const unread = test.host.querySelector<HTMLButtonElement>('button[aria-label="1 条新消息"]')!;
    expect(unread).not.toBeNull();
    await act(async () => unread.click());
    expect(chip().parentElement!.getAttribute('aria-hidden')).toBe('true');
    expect(test.scroll().scrollHeight - test.scroll().scrollTop - test.scroll().clientHeight).toBeLessThanOrEqual(1);
    test.props.items = [...test.props.items, { type: 'assistant', id: 'next-answer', text: 'still following' }];
    await test.render();
    expect(test.scroll().scrollHeight - test.scroll().scrollTop - test.scroll().clientHeight).toBeLessThanOrEqual(1);
  });

  it('does not pull the reader back down when new rows arrive after an upward wheel gesture', async () => {
    const test = await fixture();
    test.props.items = turns('long', 40); test.props.taskId = 'long';
    await test.render();
    await act(async () => {
      test.scroll().dispatchEvent(new WheelEvent('wheel', { deltaY: -80, bubbles: true }));
      test.scroll().scrollTop -= 200;
      test.scroll().dispatchEvent(new Event('scroll'));
    });
    const readingTop = test.scroll().scrollTop;
    test.props.items = [...test.props.items, ...turns('new', 1)];
    await test.render();
    expect(test.scroll().scrollTop).toBe(readingTop);
    expect(test.scroll().scrollHeight - test.scroll().scrollTop - test.scroll().clientHeight).toBeGreaterThan(48);
  });
});

describe('conversation input inset readiness', () => {
  it('mounts messages with the measured composer inset and updates it from resize notifications', async () => {
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot(host); roots.push(root);
    const messages = vi.fn((padding: number) => <div data-padding={padding} />);
    await act(async () => root.render(<ConversationLayout messages={messages}><textarea /></ConversationLayout>));
    expect(messages.mock.calls.every(([padding]) => padding === 180)).toBe(true);
    expect(host.querySelector('[data-padding="180"]')).not.toBeNull();
    overlayHeight = 300;
    await act(async () => notifySizes());
    expect(host.querySelector('[data-padding="300"]')).not.toBeNull();
  });
});
