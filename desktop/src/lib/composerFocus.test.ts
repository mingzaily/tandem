import { describe, expect, it, vi } from 'vitest';
import { canRestoreComposerFocus, isComposerBlankTarget } from './composerFocus';

describe('composer blank area focus', () => {
  it('accepts nested toolbar whitespace, beyond the card element itself', () => {
    const target = { closest: vi.fn(() => null) } as unknown as Element;
    const container = { contains: vi.fn(() => true) } as unknown as Element;
    expect(isComposerBlankTarget(container, target)).toBe(true);
  });

  it('lets controls, text selection and their descendants handle their own pointer events', () => {
    const control = {} as Element;
    const target = { closest: vi.fn(() => control) } as unknown as Element;
    const container = { contains: vi.fn(() => true) } as unknown as Element;
    expect(isComposerBlankTarget(container, target)).toBe(false);
  });

  it('leaves portaled menu content outside the input body alone', () => {
    const closest = vi.fn(() => null);
    const target = { closest } as unknown as Element;
    const container = { contains: vi.fn(() => false) } as unknown as Element;
    expect(isComposerBlankTarget(container, target)).toBe(false);
    expect(closest).not.toHaveBeenCalled();
  });
});

describe('composer send focus restoration', () => {
  const body = {} as Element, documentElement = {} as Element;
  const ownerDocument = { body, documentElement, activeElement: null as Element | null };
  const editor = { ownerDocument, contains: () => false } as unknown as HTMLElement;

  it('restores focus after disabling the editor moves focus to the document body', () => {
    ownerDocument.activeElement = body;
    expect(canRestoreComposerFocus(editor)).toBe(true);
  });

  it('preserves focus when it already belongs to the editor or document root', () => {
    for (const active of [editor, documentElement]) {
      ownerDocument.activeElement = active;
      expect(canRestoreComposerFocus(editor)).toBe(true);
    }
  });

  it('keeps focus on another control chosen while sending', () => {
    ownerDocument.activeElement = {} as Element;
    expect(canRestoreComposerFocus(editor)).toBe(false);
  });
});
