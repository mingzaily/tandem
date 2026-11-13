/** Input whitespace focuses the editor; controls and portaled menus keep their own focus. */
export function isComposerBlankTarget(container: Element, target: Element): boolean {
  return container.contains(target) && !target.closest('button, input, textarea, select, a[href], [tabindex], [role="button"], [role="slider"], .selectable');
}

/** A completed send restores the caret while a later choice of another control keeps focus. */
export function canRestoreComposerFocus(editor: HTMLElement): boolean {
  const { activeElement, body, documentElement } = editor.ownerDocument;
  return activeElement === editor || activeElement === body || activeElement === documentElement || Boolean(activeElement && editor.contains(activeElement));
}
