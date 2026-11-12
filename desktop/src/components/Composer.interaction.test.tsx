import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../lib/api';
import { Composer } from './Composer';

const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0 }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const at = hooks.cursor++;
    if (!(at in hooks.values)) hooks.values[at] = typeof initial === 'function' ? initial() : initial;
    return [hooks.values[at], (next: unknown) => { hooks.values[at] = typeof next === 'function' ? next(hooks.values[at]) : next; }];
  },
  useRef: (initial: unknown) => hooks.values[hooks.cursor++] ??= { current: initial },
  useEffect: () => {}, useLayoutEffect: () => {}, useCallback: (callback: unknown) => callback,
}));
vi.mock('../lib/useComposerResize', () => ({ useComposerResize: () => ({ height: null, range: { min: 110, max: 420 }, start() {}, resize() {} }) }));
vi.hoisted(() => vi.stubGlobal('navigator', { language: 'zh-CN' }));
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => { hooks.values = []; hooks.cursor = 0; });
afterEach(() => vi.restoreAllMocks());

type Node = ReactElement<Record<string, any>>;
function nodes(value: ReactNode): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!isValidElement<Record<string, any>>(value)) return [];
  return [value, ...nodes(value.props.children)];
}
function fixture(overrides: Partial<Parameters<typeof Composer>[0]> = {}) {
  const onSend = vi.fn();
  const props: Parameters<typeof Composer>[0] = { draftKey: 'history-interaction', running: false, placeholder: 'message', inputHistory: ['最近一条\n完整输入', '更早一条', '最早一条'], toolbarLeft: null, toolbarRight: null, onSend, onStop() {}, ...overrides };
  const tree = () => { hooks.cursor = 0; return nodes(Composer(props)); };
  const render = () => tree().find((node) => node.type === 'textarea')!;
  const button = (label: string) => tree().find((node) => node.type === 'button' && node.props['aria-label'] === label)!;
  const press = (key: string, overrides: Record<string, unknown> = {}) => {
    const page = render();
    const value = page.props.value as string;
    const event = { key, repeat: false, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false,
      nativeEvent: { isComposing: false, keyCode: key === 'ArrowUp' ? 38 : 40 }, preventDefault: vi.fn(),
      currentTarget: { value, selectionStart: value.length, selectionEnd: value.length, setSelectionRange: vi.fn() }, ...overrides };
    page.props.onKeyDown(event);
    return event;
  };
  const change = (value: string) => render().props.onChange({ currentTarget: { value, selectionStart: value.length }, nativeEvent: { isComposing: false, inputType: 'insertText' } });
  return { render, press, change, button, onSend, props };
}

describe('input history arrow navigation', () => {
  it('browses backwards and forwards, then restores the original empty draft without sending', () => {
    const test = fixture();
    expect(test.press('ArrowDown').preventDefault).not.toHaveBeenCalled();
    for (const expected of ['最近一条\n完整输入', '更早一条', '最早一条']) {
      expect(test.press('ArrowUp').preventDefault).toHaveBeenCalledOnce();
      expect(test.render().props.value).toBe(expected);
    }
    expect(test.press('ArrowUp').preventDefault).not.toHaveBeenCalled();
    for (const expected of ['更早一条', '最近一条\n完整输入', '']) {
      expect(test.press('ArrowDown').preventDefault).toHaveBeenCalledOnce();
      expect(test.render().props.value).toBe(expected);
    }
    expect(test.onSend).not.toHaveBeenCalled();
  });
  it('freezes the browsing order while another user message arrives, then uses the fresh history on re-entry', () => {
    const test = fixture();
    test.press('ArrowUp');
    test.props.inputHistory = ['新收到的输入', ...test.props.inputHistory!];
    test.press('ArrowUp');
    expect(test.render().props.value).toBe('更早一条');
    test.press('ArrowDown');
    expect(test.render().props.value).toBe('最近一条\n完整输入');
    test.press('ArrowDown');
    expect(test.render().props.value).toBe('');
    test.press('ArrowUp');
    expect(test.render().props.value).toBe('新收到的输入');
  });
  it('retains repeated messages as separate history entries and resets their caret to the end', () => {
    const test = fixture({ inputHistory: ['重复输入', '重复输入', '更早一条'] });
    test.press('ArrowUp');
    const duplicate = test.press('ArrowUp');
    expect(test.render().props.value).toBe('重复输入');
    expect(duplicate.currentTarget.setSelectionRange).toHaveBeenCalledWith(4, 4);
    test.press('ArrowUp');
    expect(test.render().props.value).toBe('更早一条');
    test.press('ArrowDown'); test.press('ArrowDown'); test.press('ArrowDown');
    expect(test.render().props.value).toBe('');
  });
  it('returns to ordinary cursor navigation after editing a recalled message', () => {
    const test = fixture();
    test.press('ArrowUp');
    test.change('改过的多行\n草稿');
    expect(test.press('ArrowUp').preventDefault).not.toHaveBeenCalled();
    expect(test.press('ArrowDown').preventDefault).not.toHaveBeenCalled();
    expect(test.render().props.value).toBe('改过的多行\n草稿');
    test.change('');
    test.press('ArrowUp');
    expect(test.render().props.value).toBe('最近一条\n完整输入');
  });
  it('preserves whitespace-only drafts exactly when returning from history', () => {
    const test = fixture();
    test.change(' \n ');
    test.press('ArrowUp');
    expect(test.render().props.value).toBe('最近一条\n完整输入');
    test.press('ArrowDown');
    expect(test.render().props.value).toBe(' \n ');
  });
  it('keeps input-method navigation and existing non-empty drafts intact', () => {
    const test = fixture();
    expect(test.press('ArrowUp', { nativeEvent: { isComposing: true, keyCode: 229 } }).preventDefault).not.toHaveBeenCalled();
    expect(test.render().props.value).toBe('');
    test.change('已有草稿');
    expect(test.press('ArrowUp').preventDefault).not.toHaveBeenCalled();
    expect(test.render().props.value).toBe('已有草稿');
  });
  it('supports held arrow keys while modifier shortcuts keep controlling the caret', () => {
    const test = fixture();
    expect(test.press('ArrowUp', { metaKey: true }).preventDefault).not.toHaveBeenCalled();
    test.press('ArrowUp');
    test.press('ArrowUp', { repeat: true });
    expect(test.render().props.value).toBe('更早一条');
    test.press('ArrowDown', { repeat: true });
    expect(test.render().props.value).toBe('最近一条\n完整输入');
  });
  it('stops history browsing when an attachment is added and keeps the recalled text after removal', async () => {
    vi.spyOn(api, 'pickAttachments').mockResolvedValue({ added: [{ id: 'image', name: 'image.png', kind: 'image', preview: 'data:image/png;base64,AA' }], errors: [] });
    const remove = vi.spyOn(api, 'removeAttachment').mockResolvedValue(undefined);
    const test = fixture();
    test.press('ArrowUp');
    test.button('添加图片或文件').props.onClick();
    await Promise.resolve();
    expect(test.press('ArrowDown').preventDefault).not.toHaveBeenCalled();
    expect(test.render().props.value).toBe('最近一条\n完整输入');
    test.button('移除 image.png').props.onClick();
    expect(remove).toHaveBeenCalledWith('image');
    expect(test.press('ArrowDown').preventDefault).not.toHaveBeenCalled();
    expect(test.render().props.value).toBe('最近一条\n完整输入');
  });
  it('keeps queued-message editing independent from conversation history', () => {
    const test = fixture({ editing: { id: 'queued', prompt: '', attachments: [], options: { model: null, effort: null, permissionMode: null } } });
    expect(test.press('ArrowUp').preventDefault).not.toHaveBeenCalled();
    expect(test.render().props.value).toBe('');
  });
});
