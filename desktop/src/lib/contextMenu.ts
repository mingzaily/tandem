/**
 * The web view's own context menu offers Reload and the like, which only make sense in a browser.
 * It stays where it is useful, on editable fields and selected text for copy and paste; menus the
 * page draws itself have already taken the event. Development builds keep it for Inspect Element.
 */
export function shouldKeepNativeMenu(target: EventTarget | null, selection: string): boolean {
  if (selection.trim()) return true;
  const element = target as Element | null;
  return typeof element?.closest === 'function'
    && Boolean(element.closest('input, textarea, [contenteditable=""], [contenteditable="true"]'));
}

export function limitNativeContextMenu() {
  if (import.meta.env.DEV) return;
  document.addEventListener('contextmenu', (event) => {
    if (event.defaultPrevented) return;
    if (!shouldKeepNativeMenu(event.target, window.getSelection()?.toString() ?? '')) event.preventDefault();
  });
}
