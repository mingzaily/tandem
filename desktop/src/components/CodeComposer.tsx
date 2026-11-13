import { useLayoutEffect, useRef, type RefObject } from 'react';
import 'prosemirror-view/style/prosemirror.css';
import { createCodeComposerView, type CodeComposerOptions } from '../lib/codeComposerView';
import type { CodeComposerHandle } from '../lib/composerEditor';

interface Props extends CodeComposerOptions {
  resetKey: string;
  editorRef: RefObject<CodeComposerHandle | null>;
  onReady(): void;
}

/** Loaded for fenced drafts. Fences live in node attributes, while the DOM edits only their body. */
export default function CodeComposer(props: Props) {
  const root = useRef<HTMLDivElement>(null);
  const editor = useRef<ReturnType<typeof createCodeComposerView> | null>(null);
  const latest = useRef(props);
  latest.current = props;
  useLayoutEffect(() => {
    const instance = createCodeComposerView(root.current!, latest.current);
    editor.current = instance;
    latest.current.editorRef.current = instance.handle;
    instance.handle.focus();
    instance.handle.setSelectionRange(instance.handle.selectionStart, instance.handle.selectionEnd);
    latest.current.onReady();
    return () => {
      latest.current.editorRef.current = null;
      editor.current = null;
      instance.destroy();
    };
  }, [props.resetKey]);
  useLayoutEffect(() => { editor.current?.update(props); });
  return <div className="composer-rich-editor" ref={root} />;
}
