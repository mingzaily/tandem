/**
 * Whether an Enter belongs to an input method rather than to the page.
 *
 * WebKit ends the composition before it delivers the Enter that commits it, so that keydown
 * arrives with `isComposing` false: typing English inside a Chinese input method and pressing
 * Enter to keep the letters would otherwise send the message. The key code 229 and a short window
 * after `compositionend` catch it.
 */
const SETTLE_MS = 80;
let composing = false;
let endedAt = 0;

if (typeof document !== 'undefined') {
  document.addEventListener('compositionstart', () => { composing = true; }, true);
  document.addEventListener('compositionend', () => { composing = false; endedAt = Date.now(); }, true);
}

export function isImeKey(event: KeyboardEvent | { nativeEvent: KeyboardEvent }): boolean {
  const native = 'nativeEvent' in event ? event.nativeEvent : event;
  return native.isComposing || native.keyCode === 229 || composing || Date.now() - endedAt < SETTLE_MS;
}
