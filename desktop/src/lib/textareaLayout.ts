/** Programmatic textarea edits restore their caret after layout, then reveal it inside the editor. */
export function revealTextareaCaret(input: HTMLTextAreaElement, caret: number): void {
  if (input.scrollHeight <= input.clientHeight) return;
  const styles = window.getComputedStyle(input);
  const mirror = document.createElement('div');
  mirror.style.cssText = 'position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;box-sizing:border-box;border:0;margin:0;';
  mirror.style.width = `${input.clientWidth}px`;
  for (const property of [
    'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant', 'font-feature-settings',
    'line-height', 'letter-spacing', 'word-spacing', 'text-transform', 'text-indent', 'text-align',
    'tab-size', 'white-space', 'overflow-wrap', 'word-break', 'direction',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  ]) mirror.style.setProperty(property, styles.getPropertyValue(property));
  mirror.textContent = input.value.slice(0, caret);
  const marker = document.createElement('span');
  marker.textContent = input.value.slice(caret) || '\u200b';
  mirror.append(marker);
  document.body.append(mirror);
  try {
    const top = marker.offsetTop;
    const bottom = top + Number.parseFloat(styles.lineHeight);
    const padding = 4;
    if (bottom > input.scrollTop + input.clientHeight - padding) {
      input.scrollTop = bottom - input.clientHeight + padding;
    } else if (top < input.scrollTop + padding) {
      input.scrollTop = Math.max(0, top - padding);
    }
  } finally { mirror.remove(); }
}
