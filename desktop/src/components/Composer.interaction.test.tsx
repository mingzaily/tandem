import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../lib/api';
import { Composer } from './Composer';
import * as textareaLayout from '../lib/textareaLayout';

const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, layouts: [] as (() => void)[], layoutCursor: 0, layoutDeps: [] as (unknown[] | undefined)[], captureLayout: false, manualHeight: null as number | null }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const at = hooks.cursor++;
    if (!(at in hooks.values)) hooks.values[at] = typeof initial === 'function' ? initial() : initial;
    return [hooks.values[at], (next: unknown) => { hooks.values[at] = typeof next === 'function' ? next(hooks.values[at]) : next; }];
  },
  useRef: (initial: unknown) => hooks.values[hooks.cursor++] ??= { current: initial },
  useEffect: () => {},
  useLayoutEffect: (effect: () => void, deps?: unknown[]) => {
    if (!hooks.captureLayout) return;
    const at = hooks.layoutCursor++;
    const previous = hooks.layoutDeps[at];
    if (!deps || !previous || deps.length !== previous.length || deps.some((value, index) => value !== previous[index])) hooks.layouts.push(effect);
    hooks.layoutDeps[at] = deps;
  },
  useCallback: (callback: unknown) => callback, useMemo: (compute: () => unknown) => compute(),
}));
vi.mock('../lib/useComposerResize', () => ({ useComposerResize: () => ({ height: hooks.manualHeight, range: { min: 110, max: 420 }, start() {}, resize() {} }) }));
vi.hoisted(() => vi.stubGlobal('navigator', { language: 'zh-CN' }));
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => { hooks.values = []; hooks.cursor = 0; hooks.layouts = []; hooks.layoutCursor = 0; hooks.layoutDeps = []; hooks.captureLayout = false; hooks.manualHeight = null; });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.stubGlobal('navigator', { language: 'zh-CN' }); });

type Node = ReactElement<Record<string, any>>;
function nodes(value: ReactNode): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!isValidElement<Record<string, any>>(value)) return [];
  return [value, ...nodes(value.props.children)];
}
function fixture(overrides: Partial<Parameters<typeof Composer>[0]> = {}) {
  const onSend = vi.fn();
  const props: Parameters<typeof Composer>[0] = { draftKey: 'history-interaction', running: false, placeholder: 'message', inputHistory: ['最近一条\n完整输入', '更早一条', '最早一条'], toolbarLeft: null, toolbarRight: null, onSend, onStop() {}, ...overrides };
  const tree = () => { hooks.cursor = 0; hooks.layoutCursor = 0; return nodes(Composer(props)); };
  const render = () => tree().find((node) => node.type === 'textarea')!;
  const button = (label: string) => tree().find((node) => node.type === 'button' && node.props['aria-label'] === label)!;
  const editorArea = () => tree().find((node) => node.props['data-composer-editor'] !== undefined)!;
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
  return { render, press, change, button, editorArea, onSend, props };
}

describe('composer fenced-code appearance', () => {
  it('switches to aligned code typography when a typed opening fence creates its empty block', () => {
    const test = fixture();
    test.change('``');
    test.change('```');
    expect(test.render().props.value).toBe('```\n\n```');
    expect(test.editorArea().props.className).toContain('composer-code-only');
    test.change('说明\n```\ncode\n```');
    expect(test.editorArea().props.className).not.toContain('composer-code-only');
    expect(test.render().props.value).toBe('说明\n```\ncode\n```');
  });
  it('keeps pasted terminal output and its fences unchanged when sending', async () => {
    vi.stubGlobal('document', { activeElement: null });
    try {
      const test = fixture();
      const source = '```sh\n$ command --flag\n  result\n\t中文输出\n```';
      test.render().props.onChange({ currentTarget: { value: source, selectionStart: source.length }, nativeEvent: { isComposing: false, inputType: 'insertFromPaste' } });
      expect(test.editorArea().props.className).toContain('composer-code-only');
      expect(test.render().props.value).toBe(source);
      test.button('发送消息').props.onClick();
      await Promise.resolve();
      expect(test.onSend).toHaveBeenCalledExactlyOnceWith(source, [], false);
    } finally {
      vi.unstubAllGlobals();
      vi.stubGlobal('navigator', { language: 'zh-CN' });
    }
  });
});

describe('composer Enter shortcuts', () => {
  const code = '说明\n```sh\n  echo 中文\n```\n后续说明';
  const caret = code.lastIndexOf('\n```');
  const target = () => ({ value: code, selectionStart: caret, selectionEnd: caret });

  it.each([false, true])('Enter sends the unchanged full fenced draft when running=%s', async (running) => {
    vi.stubGlobal('document', { activeElement: null });
    const test = fixture({ running });
    test.change(code);
    const event = test.press('Enter', { currentTarget: target() });
    await Promise.resolve();
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(test.onSend).toHaveBeenCalledExactlyOnceWith(code, [], false);
  });

  it('keeps Shift+Enter as an indented code newline and never sends it', () => {
    const test = fixture();
    test.change(code);
    expect(test.press('Enter', { shiftKey: true, currentTarget: target() }).preventDefault).toHaveBeenCalledOnce();
    expect(test.render().props.value).toBe(code.slice(0, caret) + '\n  ' + code.slice(caret));
    expect(test.onSend).not.toHaveBeenCalled();
  });

  it('uses the command-send preference for both code newlines and sending', async () => {
    vi.stubGlobal('document', { activeElement: null });
    const test = fixture({ sendWithCmdEnter: true });
    test.change(code);
    test.press('Enter', { currentTarget: target() });
    const changed = code.slice(0, caret) + '\n  ' + code.slice(caret);
    expect(test.render().props.value).toBe(changed);
    expect(test.onSend).not.toHaveBeenCalled();
    test.press('Enter', { metaKey: true });
    await Promise.resolve();
    expect(test.onSend).toHaveBeenCalledExactlyOnceWith(changed, [], false);
  });

  it('preserves the alternate send shortcut inside code and the input-method candidate key', async () => {
    vi.stubGlobal('document', { activeElement: null });
    const test = fixture({ running: true });
    test.change(code);
    const composing = test.press('Enter', { currentTarget: target(), nativeEvent: { isComposing: true, keyCode: 229 } });
    expect(composing.preventDefault).not.toHaveBeenCalled();
    expect(test.onSend).not.toHaveBeenCalled();
    test.press('Enter', { metaKey: true, currentTarget: target() });
    await Promise.resolve();
    expect(test.onSend).toHaveBeenCalledExactlyOnceWith(code, [], true);
  });

  it('saves queued code with the configured send key instead of inserting a line', async () => {
    vi.stubGlobal('document', { activeElement: null });
    const onSaveEdit = vi.fn();
    const test = fixture({ editing: { id: 'queued-code', prompt: code, attachments: [], options: { model: null, effort: null, permissionMode: null } }, onSaveEdit });
    test.press('Enter', { currentTarget: target() });
    await Promise.resolve();
    expect(onSaveEdit).toHaveBeenCalledExactlyOnceWith(code, []);
    expect(test.onSend).not.toHaveBeenCalled();
  });

  it('moves out of an already-closed code block without waiting for a text change', () => {
    const reveal = vi.spyOn(textareaLayout, 'revealTextareaCaret').mockImplementation(() => {});
    const test = fixture();
    test.change(code);
    const box = { ...target(), scrollTop: 140, setSelectionRange: vi.fn() };
    test.render().props.ref.current = box;
    test.press('ArrowDown', { currentTarget: box });
    const afterFence = code.indexOf('\n后续说明') + 1;
    expect(box.setSelectionRange).toHaveBeenCalledWith(afterFence, afterFence);
    expect(reveal).toHaveBeenCalledExactlyOnceWith(box, afterFence);
    expect(box.scrollTop).toBe(140);
    expect(test.render().props.value).toBe(code);
  });

  it('keeps native Shift+ArrowDown selection inside code', () => {
    const test = fixture();
    test.change(code);
    const event = test.press('ArrowDown', { shiftKey: true, currentTarget: target() });
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(test.render().props.value).toBe(code);
  });
});

describe('composer scroll after layout', () => {
  it.each([
    { variant: 'task' as const, manualHeight: null },
    { variant: 'task' as const, manualHeight: 320 },
    { variant: 'new' as const, manualHeight: null },
    { variant: 'new' as const, manualHeight: 320 },
  ])('preserves the native long-input viewport on Shift+Enter in $variant at height=$manualHeight', ({ variant, manualHeight }) => {
    hooks.captureLayout = true;
    hooks.manualHeight = manualHeight;
    vi.stubGlobal('document', { activeElement: null });
    const test = fixture({ variant });
    const box = { scrollTop: 0, scrollHeight: 1200, selectionStart: 0, selectionEnd: 0, value: '', style: {} as Record<string, string>, setSelectionRange: vi.fn() };
    // A layout-changing height assignment can reset a native textarea's scroll offset.
    Object.defineProperty(box.style, 'height', { set() { box.scrollTop = 0; } });
    const commit = () => {
      const page = test.render();
      page.props.ref.current = box;
      box.value = page.props.value;
      for (const layout of hooks.layouts.splice(0)) layout();
      return page;
    };
    commit();
    test.change('长内容\n'.repeat(100));
    commit();
    box.scrollTop = 720;
    const event = test.press('Enter', { shiftKey: true, currentTarget: box });
    expect(event.preventDefault).not.toHaveBeenCalled();
    box.value += '\n';
    box.selectionStart = box.selectionEnd = box.value.length;
    test.render().props.onChange({ currentTarget: box, nativeEvent: { inputType: 'insertLineBreak', isComposing: false } });
    commit();
    expect(box.scrollTop).toBe(720);
    expect(box.setSelectionRange).not.toHaveBeenCalled();
    expect(test.render().props.value).toBe('长内容\n'.repeat(100) + '\n');
    expect(test.onSend).not.toHaveBeenCalled();
  });

  it.each(['code', 'list'])('restores a programmatic %s newline after resizing instead of losing the scrolled viewport', (kind) => {
    hooks.captureLayout = true;
    vi.spyOn(textareaLayout, 'revealTextareaCaret').mockImplementation(() => {});
    vi.stubGlobal('document', { activeElement: null });
    const test = fixture();
    const box = { scrollTop: 0, scrollHeight: 1400, selectionStart: 0, selectionEnd: 0, value: '', style: {} as Record<string, string>, setSelectionRange: vi.fn((start: number, end: number) => { box.selectionStart = start; box.selectionEnd = end; }) };
    Object.defineProperty(box.style, 'height', { set() { box.scrollTop = 0; } });
    const commit = () => {
      const page = test.render();
      page.props.ref.current = box;
      if (box.value !== page.props.value) { box.value = page.props.value; box.scrollTop = 0; }
      for (const layout of hooks.layouts.splice(0)) layout();
    };
    commit();
    const source = kind === 'code' ? '```sh\n' + '  echo 中文\n'.repeat(100) + '```' : '长段落\n'.repeat(100) + '- 最后一项';
    test.change(source);
    commit();
    box.scrollTop = 840;
    const caret = kind === 'code' ? source.lastIndexOf('\n```') : source.length;
    const newline = kind === 'code' ? '\n  ' : '\n- ';
    box.selectionStart = box.selectionEnd = caret;
    test.press('Enter', { shiftKey: true, currentTarget: box });
    commit();
    expect(box.scrollTop).toBe(840);
    expect(box.setSelectionRange).toHaveBeenLastCalledWith(caret + newline.length, caret + newline.length);
    expect(textareaLayout.revealTextareaCaret).toHaveBeenCalledExactlyOnceWith(box, caret + newline.length);
    expect(test.render().props.value).toBe(source.slice(0, caret) + newline + source.slice(caret));
  });
});

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
