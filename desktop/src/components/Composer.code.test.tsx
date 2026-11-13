// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Composer } from './Composer';

vi.mock('../lib/api', () => ({
  onAttachmentsDropped: () => Promise.resolve(() => {}), onAttachmentDrag: () => Promise.resolve(() => {}),
  addPastedImage: vi.fn(), pickAttachments: vi.fn(), removeAttachment: vi.fn(),
}));
const roots: Root[] = [];
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
});
afterEach(async () => {
  await act(async () => { for (const root of roots.splice(0)) root.unmount(); });
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
const source = '翻一下生产环境日志\n```\n短时间内收到了重复请求 (code: 10100002)\n-6896737259390477259\n```';

async function fixture(overrides: Partial<Parameters<typeof Composer>[0]> = {}) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  const onSend = vi.fn();
  const props: Parameters<typeof Composer>[0] = {
    draftKey: crypto.randomUUID(), running: false, placeholder: 'message', fill: { text: source },
    toolbarLeft: null, toolbarRight: null, onSend, onStop() {}, ...overrides,
  };
  await act(async () => { root.render(<Composer {...props} />); await import('./CodeComposer'); });
  const editor = () => host.querySelector<HTMLElement>('[contenteditable]')!;
  const key = async (key: string, options: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
    await act(async () => { editor().dispatchEvent(event); });
    return event;
  };
  const render = async () => { await act(async () => root.render(<Composer {...props} />)); };
  return { host, onSend, props, editor, key, render };
}

describe('composer structured-code integration', () => {
  it.each(['task', 'new'] as const)('hides the screenshot fences in %s and sends the complete original Markdown', async (variant) => {
    const test = await fixture({ variant });
    expect(test.editor()).not.toBeNull();
    expect(test.host.querySelector('textarea')).toBeNull();
    expect(test.editor().querySelector('pre code')!.textContent).toContain('短时间内收到了重复请求');
    expect(test.editor().textContent).not.toContain('```');
    expect(test.editor().textContent).toContain('翻一下生产环境日志');
    await test.key('Enter');
    expect(test.onSend).toHaveBeenCalledExactlyOnceWith(source, [], false);
    expect(test.editor().textContent).toBe('');
  });

  it('converts the third typed backtick from the plain input, hides it and restores it on undo', async () => {
    const test = await fixture({ fill: { text: '``' } });
    const box = test.host.querySelector('textarea')!;
    expect(box).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(box, '```');
      box.setSelectionRange(3, 3);
      box.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '`' }));
      await import('./CodeComposer');
    });
    expect(test.editor()).not.toBeNull();
    expect(test.editor().querySelector('pre code')).not.toBeNull();
    expect(test.editor().textContent).not.toContain('```');
    await test.key('z', { ctrlKey: true });
    expect(test.editor().textContent).toBe('``');
    await test.key('z', { ctrlKey: true, shiftKey: true });
    expect(test.editor().querySelector('pre code')).not.toBeNull();
  });

  it('keeps Shift+Enter in the code body and preserves original fences when sending afterward', async () => {
    const test = await fixture();
    await test.key('Enter', { shiftKey: true });
    expect(test.onSend).not.toHaveBeenCalled();
    expect(test.editor().textContent).not.toContain('```');
    await test.key('Enter');
    const at = source.lastIndexOf('\n```');
    expect(test.onSend).toHaveBeenCalledExactlyOnceWith(source.slice(0, at) + '\n' + source.slice(at), [], false);
  });

  it('keeps a long code viewport through a manual-height change and subsequent newline', async () => {
    const long = '说明\n```sh\n' + '  echo 中文\n'.repeat(100) + '```';
    const test = await fixture({ fill: { text: long } });
    test.editor().scrollTop = 500;
    await act(async () => {
      test.host.querySelector('[role="separator"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
    });
    expect(test.host.querySelector<HTMLElement>('.composer-input')!.style.height).not.toBe('');
    expect(test.host.querySelector('[data-composer-editor]')!.className).toContain('flex-1');
    await test.key('Enter', { shiftKey: true });
    expect(test.editor().scrollTop).toBe(500);
    expect(test.editor().textContent).not.toContain('```');
    await test.key('Enter');
    expect(test.onSend.mock.calls[0][0]).toContain('  echo 中文\n  \n```');
  });

  it('saves queued code without changing its language or raw symbols and leaves ordinary drafts independent', async () => {
    const onSaveEdit = vi.fn();
    const queued = { id: 'q', prompt: '```sh\n  command --flag\n```', attachments: [], options: { model: null, effort: null, permissionMode: null } };
    const test = await fixture({ fill: undefined, editing: queued, onSaveEdit });
    expect(test.editor().textContent).not.toContain('```');
    await test.key('Enter');
    expect(onSaveEdit).toHaveBeenCalledExactlyOnceWith(queued.prompt, []);
    expect(test.onSend).not.toHaveBeenCalled();
  });

  it('keeps the command-send preference and alternate sending in a structured code draft', async () => {
    const test = await fixture({ sendWithCmdEnter: true, running: true });
    await test.key('Enter');
    expect(test.onSend).not.toHaveBeenCalled();
    await test.key('Enter', { metaKey: true, shiftKey: true });
    expect(test.onSend).toHaveBeenCalledOnce();
    expect(test.onSend.mock.calls[0][2]).toBe(true);
    expect(test.onSend.mock.calls[0][0]).toContain('\n```');
  });

  it('does not send a composition candidate Enter and preserves code after a failed send', async () => {
    const onSend = vi.fn().mockRejectedValue(new Error('queue write failed'));
    const test = await fixture({ onSend });
    await test.key('Enter', { isComposing: true, keyCode: 229 });
    expect(onSend).not.toHaveBeenCalled();
    await test.key('Enter');
    expect(onSend).toHaveBeenCalledExactlyOnceWith(source, [], false);
    expect(test.editor().textContent).toContain('短时间内收到了重复请求');
    expect(test.editor().textContent).not.toContain('```');
    expect(test.host.textContent).toContain('queue write failed');
  });

  it('returns from history containing code to the original empty draft without exposing fences', async () => {
    const test = await fixture({ fill: { text: '```\ninitial\n```' }, inputHistory: [source] });
    await test.key('Enter');
    await test.key('ArrowUp');
    expect(test.editor().textContent).toContain('短时间内收到了重复请求');
    expect(test.editor().textContent).not.toContain('```');
    await test.key('ArrowDown');
    expect(test.editor().textContent).toBe('');
    expect(test.onSend).toHaveBeenCalledTimes(1);
  });
});
