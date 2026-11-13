// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AllSelection } from 'prosemirror-state';
import { undo, redo } from 'prosemirror-history';
import { createCodeComposerView, type CodeComposerOptions } from './codeComposerView';
import { positionAtSource } from './composerDocument';
import { codeKeyEdit } from './fencedCode';

const editors: ReturnType<typeof createCodeComposerView>[] = [];
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy(); document.body.replaceChildren(); vi.restoreAllMocks(); });

function fixture(value: string, overrides: Partial<CodeComposerOptions> = {}) {
  const root = document.createElement('div');
  document.body.append(root);
  const onSend = vi.fn();
  const changed = vi.fn();
  const options: CodeComposerOptions = {
    value, label: '输入消息', placeholder: '继续聊一聊…', disabled: false,
    onChange: changed, onPasteImages: vi.fn(),
    onKeyDown(event) {
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); onSend(editor.handle.value); return; }
      const input = event.currentTarget;
      const edit = codeKeyEdit(input.value, input.selectionStart, input.selectionEnd, event.key);
      if (edit) { event.preventDefault(); editor.handle.replaceSource(edit.value, edit.caret); }
    },
    ...overrides,
  };
  const editor = createCodeComposerView(root, options);
  editors.push(editor);
  function key(key: string, shiftKey = false) {
    const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
    editor.view.dom.dispatchEvent(event);
    return event;
  }
  function select(at: number, to = at) { editor.handle.setSelectionRange(at, to); }
  function paste(text: string) {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', text);
    const event = new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true });
    editor.view.dom.dispatchEvent(event);
    return event;
  }
  return { ...editor, root, onSend, changed, key, select, paste, options };
}

const source = '说明\n```sh\n  echo 中文\n```\n后续说明';

describe('editable code block DOM', () => {
  it('shows code contents, hides both fences and keeps the exact Markdown for sending', () => {
    const test = fixture(source);
    expect(test.root.querySelector('pre code')!.textContent).toBe('  echo 中文');
    expect(test.root.textContent).not.toContain('```');
    expect(test.root.textContent).toContain('说明');
    expect(test.view.dom.getAttribute('contenteditable')).toBe('true');
    expect(test.view.dom.getAttribute('role')).toBe('textbox');
    test.select(source.indexOf('echo'));
    test.key('Enter');
    expect(test.onSend).toHaveBeenCalledExactlyOnceWith(source);
  });

  it('edits code with indentation, undo and redo while keeping fence metadata hidden', () => {
    const test = fixture(source);
    const end = source.lastIndexOf('\n```');
    test.select(end);
    test.view.dom.scrollTop = 120;
    expect(test.key('Enter', true).defaultPrevented).toBe(true);
    expect(test.handle.value).toBe(source.slice(0, end) + '\n  ' + source.slice(end));
    expect(test.view.dom.scrollTop).toBe(120);
    expect(test.root.textContent).not.toContain('```');
    expect(undo(test.view.state, test.view.dispatch)).toBe(true);
    expect(test.handle.value).toBe(source);
    expect(redo(test.view.state, test.view.dispatch)).toBe(true);
    expect(test.handle.value).toContain('  echo 中文\n  \n```');
  });

  it('pastes a full fenced snippet into prose and keeps literal fences when pasting within code', () => {
    const test = fixture('前文\n后文');
    test.select('前文'.length);
    test.paste('\n```js\nconst x = 1;\n```\n');
    expect(test.handle.value).toBe('前文\n```js\nconst x = 1;\n```\n\n后文');
    expect(test.root.querySelector('pre code')!.textContent).toBe('const x = 1;');
    expect(test.root.textContent).not.toContain('```');
    const at = test.handle.value.indexOf('const');
    test.select(at);
    test.paste('```\n');
    expect(test.root.querySelector('pre code')!.textContent).toContain('```\nconst');
    expect(test.handle.value).toContain('````js\n```\nconst x = 1;\n````');
  });

  it('pastes into an empty document and replaces selections without adding whitespace', () => {
    const test = fixture('');
    const code = '```ts\n  let x = 1;\n```';
    test.paste(code);
    expect(test.handle.value).toBe(code);
    test.view.dispatch(test.view.state.tr.setSelection(new AllSelection(test.view.state.doc)));
    test.paste('first\nsecond\n');
    expect(test.handle.value).toBe('first\nsecond\n');
  });

  it('copies code selections as text and the entire mixed document as Markdown', () => {
    const test = fixture(source);
    test.select(source.indexOf('echo'), source.indexOf('echo') + 'echo 中文'.length);
    const serialize = test.view.props.clipboardTextSerializer!;
    expect(serialize(test.view.state.selection.content(), test.view)).toBe('echo 中文');
    test.view.dispatch(test.view.state.tr.setSelection(new AllSelection(test.view.state.doc)));
    expect(serialize(test.view.state.selection.content(), test.view)).toBe(source);
  });

  it('cuts selected code as text and restores its original fenced content with undo', () => {
    const test = fixture(source);
    const from = source.indexOf('echo');
    test.select(from, from + 'echo 中文'.length);
    const clipboardData = new DataTransfer();
    const event = new ClipboardEvent('cut', { clipboardData, bubbles: true, cancelable: true });
    test.view.dom.dispatchEvent(event);
    expect(clipboardData.getData('text/plain')).toBe('echo 中文');
    expect(test.handle.value).toBe(source.slice(0, from) + source.slice(from + 'echo 中文'.length));
    expect(undo(test.view.state, test.view.dispatch)).toBe(true);
    expect(test.handle.value).toBe(source);
  });

  it('hands pasted image files back to the existing attachment flow without changing code text', () => {
    const test = fixture(source);
    const clipboardData = new DataTransfer();
    const file = new File(['image'], 'image.png', { type: 'image/png' });
    clipboardData.items.add(file);
    test.view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
    expect(test.options.onPasteImages).toHaveBeenCalledExactlyOnceWith([file]);
    expect(test.handle.value).toBe(source);
  });

  it('turns a third typed backtick into an empty editable code block and makes it undoable', () => {
    const test = fixture('before\n``');
    const pos = positionAtSource(test.view.state.doc, 'before\n``'.length);
    expect(test.view.props.handleTextInput!(test.view, pos, pos, '`', () => test.view.state.tr)).toBe(true);
    expect(test.handle.value).toBe('before\n```\n\n```');
    expect(test.root.querySelector('pre code')).not.toBeNull();
    expect(test.root.textContent).not.toContain('```');
    expect(undo(test.view.state, test.view.dispatch)).toBe(true);
    expect(test.handle.value).toBe('before\n``');
  });

  it('removes an empty code block and exits a filled block into the following prose', () => {
    const empty = fixture('before\n```\n\n```\nafter');
    empty.select(empty.handle.value.indexOf('\n\n') + 1);
    empty.key('Backspace');
    expect(empty.root.querySelector('pre')).toBeNull();
    expect(empty.handle.value).toBe('before\n\nafter');
    const filled = fixture(source);
    filled.select(source.lastIndexOf('\n```'));
    filled.key('ArrowDown');
    expect(filled.view.state.selection.$from.parent.type.name).toBe('paragraph');
    expect(filled.handle.selectionStart).toBe(source.indexOf('后续说明'));
    expect(filled.handle.value).toBe(source);
  });

  it('keeps the native-to-structured conversion undoable without losing the original plain draft', () => {
    const test = fixture('before\n```\n\n```', { previousSource: 'before\n``' });
    expect(test.view.dom.textContent).not.toContain('```');
    expect(undo(test.view.state, test.view.dispatch)).toBe(true);
    expect(test.handle.value).toBe('before\n``');
    expect(redo(test.view.state, test.view.dispatch)).toBe(true);
    expect(test.handle.value).toBe('before\n```\n\n```');
  });

  it('keeps composition Enter with the editor instead of sending', () => {
    const test = fixture(source);
    const event = new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true });
    test.view.dom.dispatchEvent(event);
    expect(test.onSend).not.toHaveBeenCalled();
    expect(test.handle.value).toBe(source);
  });

  it('replaces an entire code document selection with a newline once', () => {
    const test = fixture('```\ncontent\n```');
    test.view.dispatch(test.view.state.tr.setSelection(new AllSelection(test.view.state.doc)));
    expect(test.handle.selectionStart).toBe(0);
    expect(test.handle.selectionEnd).toBe(test.handle.value.length);
    test.key('Enter', true);
    expect(test.handle.value).toBe('\n');
    expect(test.root.querySelector('pre')).toBeNull();
  });

  it('preserves plain Shift+Enter paragraph breaks after the document becomes empty', () => {
    const test = fixture(source);
    test.handle.replaceSource('', 0);
    test.key('Enter', true);
    expect(test.handle.value).toBe('\n');
    expect(test.root.querySelector('pre')).toBeNull();
  });

  it('updates disabled and external draft states without broadcasting fake user input', () => {
    const test = fixture(source);
    test.update({ ...test.options, value: '```\nnew queued text\n```', disabled: true });
    expect(test.view.dom.getAttribute('contenteditable')).toBe('false');
    expect(test.handle.value).toBe('```\nnew queued text\n```');
    expect(test.changed).not.toHaveBeenCalled();
    expect(test.root.textContent).not.toContain('```');
  });
});
