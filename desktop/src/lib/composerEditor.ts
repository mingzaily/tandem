export interface ComposerInputTarget {
  value: string;
  selectionStart: number;
  selectionEnd: number;
  scrollTop: number;
  setSelectionRange(start: number, end: number): void;
}

export interface ComposerKeyEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  nativeEvent: KeyboardEvent;
  currentTarget: ComposerInputTarget;
  preventDefault(): void;
}

export interface CodeComposerHandle extends ComposerInputTarget {
  dom: HTMLElement;
  focus(): void;
  replaceSource(value: string, caret: number): void;
}
