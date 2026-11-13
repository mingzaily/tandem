import { Slice } from 'prosemirror-model';
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { baseKeymap, splitBlock } from 'prosemirror-commands';
import { history, redo, undo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { composerSchema, parseComposerDocument, positionAtSource, serializeComposerDocument, serializeComposerSelection, sourceAtPosition } from './composerDocument';
import type { CodeComposerHandle, ComposerKeyEvent } from './composerEditor';
import { isImeKey } from './ime';

export interface CodeComposerOptions {
  value: string;
  label: string;
  placeholder: string;
  disabled: boolean;
  initialCaret?: number;
  previousSource?: string;
  onChange(value: string, userInput: boolean): void;
  onKeyDown(event: ComposerKeyEvent): void;
  onPasteImages(files: File[]): void;
}

export function createCodeComposerView(root: HTMLElement, options: CodeComposerOptions) {
  let current = options;
  let source = options.value;
  const doc = parseComposerDocument(current.previousSource ?? current.value);
  const state = EditorState.create({
    doc,
    selection: TextSelection.create(doc, positionAtSource(doc, current.previousSource?.length ?? current.initialCaret ?? current.value.length)),
    plugins: [history(), keymap({ 'Mod-z': undo, 'Shift-Mod-z': redo, 'Mod-y': redo }), keymap(baseKeymap)],
  });
  const attributes = (state: EditorState) => ({
    class: 'composer-rich-content selectable', role: 'textbox', 'aria-multiline': 'true',
    'aria-label': current.label, 'data-placeholder': current.placeholder,
    'data-empty': String(state.doc.childCount === 1 && state.doc.firstChild!.type.name === 'paragraph' && state.doc.firstChild!.content.size === 0),
    'aria-disabled': String(current.disabled),
  });
  const editor: EditorView = new EditorView(root, {
    state,
    attributes,
    editable: () => !current.disabled,
    // Skip page keymaps while the native IME owns the key, keeping its default candidate handling.
    handleDOMEvents: { keydown: (_view, event) => isImeKey(event) || _view.composing },
    dispatchTransaction(transaction) {
      editor.updateState(editor.state.apply(transaction));
      if (transaction.docChanged) {
        source = serializeComposerDocument(editor.state.doc);
        current.onChange(source, !transaction.getMeta('composerProgrammatic'));
      }
    },
    handleKeyDown(_view, event) {
      if (isImeKey(event) || editor.composing) return false;
      current.onKeyDown({
        key: event.key, metaKey: event.metaKey, ctrlKey: event.ctrlKey, altKey: event.altKey, shiftKey: event.shiftKey,
        nativeEvent: event, currentTarget: target, preventDefault: () => event.preventDefault(),
      });
      if (event.defaultPrevented) return true;
      const { $from, empty } = editor.state.selection;
      if (event.key === 'Backspace' && empty && $from.parent.type.name === 'code_block' && $from.parentOffset === 0) return true;
      if (event.key === 'Enter') {
        if (!empty && $from.depth === 0) {
          editor.dispatch(editor.state.tr.replaceSelection(new Slice(parseComposerDocument('\n').content, 0, 0)).scrollIntoView());
          return true;
        }
        return splitBlock(editor.state, editor.dispatch);
      }
      return false;
    },
    handleTextInput(_view, from, to, text) {
      if (editor.composing || text !== '`') return false;
      const $from = editor.state.doc.resolve(from);
      if ($from.parent.type.name !== 'paragraph') return false;
      const content = $from.parent.textContent;
      const next = content.slice(0, $from.parentOffset) + text + content.slice($from.parentOffset + to - from);
      if (!/^ {0,3}```$/.test(next)) return false;
      const start = $from.before();
      const block = composerSchema.nodes.code_block.create({ open: next, close: next, bodyLine: true });
      const transaction = editor.state.tr.replaceWith(start, $from.after(), block);
      transaction.setSelection(TextSelection.create(transaction.doc, start + 1));
      editor.dispatch(transaction.scrollIntoView());
      return true;
    },
    handlePaste(_view, event) {
      const files = [...(event.clipboardData?.files ?? [])];
      if (files.length) { current.onPasteImages(files); return true; }
      if (!event.clipboardData?.types.includes('text/plain')) return false;
      const text = event.clipboardData.getData('text/plain');
      const { $from, $to } = editor.state.selection;
      if ($from.sameParent($to) && $from.parent.type.name === 'code_block') {
        editor.dispatch(editor.state.tr.insertText(text).setMeta('uiEvent', 'paste').scrollIntoView());
      } else {
        const parsed = parseComposerDocument(text);
        const slice = new Slice(parsed.content, parsed.firstChild!.type.name === 'paragraph' ? 1 : 0, parsed.lastChild!.type.name === 'paragraph' ? 1 : 0);
        editor.dispatch(editor.state.tr.replaceSelection(slice).setMeta('uiEvent', 'paste').scrollIntoView());
      }
      return true;
    },
    clipboardTextSerializer: serializeComposerSelection,
  });
  if (current.previousSource !== undefined) {
    const converted = parseComposerDocument(current.value);
    const transaction = editor.state.tr.replaceWith(0, editor.state.doc.content.size, converted.content);
    transaction.setSelection(TextSelection.create(transaction.doc, positionAtSource(transaction.doc, current.initialCaret ?? current.value.length)));
    editor.updateState(editor.state.apply(transaction));
  }
  const target: CodeComposerHandle = {
    dom: editor.dom,
    get value() { return source; },
    get selectionStart() { return sourceAtPosition(editor.state.doc, editor.state.selection.from); },
    get selectionEnd() { return sourceAtPosition(editor.state.doc, editor.state.selection.to); },
    get scrollTop() { return editor.dom.scrollTop; },
    set scrollTop(value) { editor.dom.scrollTop = value; },
    focus: () => editor.focus(),
    setSelectionRange(start, end) {
      editor.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, positionAtSource(editor.state.doc, start), positionAtSource(editor.state.doc, end))).scrollIntoView());
    },
    replaceSource(value, caret) {
      const before = target.value;
      if (value === before) { target.setSelectionRange(caret, caret); return; }
      let from = 0;
      while (from < before.length && from < value.length && before[from] === value[from]) from++;
      let oldTo = before.length, newTo = value.length;
      while (oldTo > from && newTo > from && before[oldTo - 1] === value[newTo - 1]) { oldTo--; newTo--; }
      const start = positionAtSource(editor.state.doc, from), end = positionAtSource(editor.state.doc, oldTo);
      const $from = editor.state.doc.resolve(start), $to = editor.state.doc.resolve(end);
      let transaction: Transaction;
      const editableRange = sourceAtPosition(editor.state.doc, start) === from && sourceAtPosition(editor.state.doc, end) === oldTo && $from.sameParent($to);
      if (editableRange && ($from.parent.type.name === 'code_block' || !value.slice(from, newTo).includes('\n'))) {
        transaction = editor.state.tr.insertText(value.slice(from, newTo), start, end);
      } else transaction = editor.state.tr.replaceWith(0, editor.state.doc.content.size, parseComposerDocument(value).content);
      transaction.setSelection(TextSelection.create(transaction.doc, positionAtSource(transaction.doc, caret)));
      editor.dispatch(transaction.setMeta('composerProgrammatic', true).scrollIntoView());
    },
  };

  return {
    view: editor,
    handle: target,
    update(next: CodeComposerOptions) {
      const attributesChanged = current.label !== next.label || current.placeholder !== next.placeholder || current.disabled !== next.disabled;
      current = next;
      if (source !== next.value) {
        const doc = parseComposerDocument(next.value);
        const transaction = editor.state.tr.replaceWith(0, editor.state.doc.content.size, doc.content).setMeta('addToHistory', false);
        transaction.setSelection(TextSelection.atEnd(transaction.doc));
        editor.updateState(editor.state.apply(transaction));
        source = next.value;
      }
      if (attributesChanged) editor.setProps({ attributes });
    },
    destroy() { editor.destroy(); },
  };
}
