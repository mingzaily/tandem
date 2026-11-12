import { afterEach, describe, expect, it, vi } from 'vitest';
import { revealTextareaCaret } from './textareaLayout';

afterEach(() => vi.unstubAllGlobals());

function fixture(top: number, scrollTop: number) {
  const marker = { textContent: '', offsetTop: top };
  const mirror = { style: { cssText: '', width: '', setProperty: vi.fn() }, textContent: '', append: vi.fn(), remove: vi.fn() };
  const createElement = vi.fn((tag: string) => tag === 'div' ? mirror : marker);
  const styles: Record<string, string> = { 'line-height': '22px', 'font-family': 'Monaco', 'white-space': 'pre-wrap', 'tab-size': '2' };
  vi.stubGlobal('document', { createElement, body: { append: vi.fn() } });
  vi.stubGlobal('window', { getComputedStyle: () => ({ lineHeight: '22px', getPropertyValue: (property: string) => styles[property] ?? '' }) });
  const input = { value: '说明\n```sh\n  echo 中文\n```', clientWidth: 520, clientHeight: 240, scrollHeight: 1200, scrollTop };
  const reveal = (caret = 17) => revealTextareaCaret(input as HTMLTextAreaElement, caret);
  return { input, marker, mirror, createElement, reveal };
}

describe('programmatic textarea caret visibility', () => {
  it('scrolls only enough to reveal the new caret below a long-input viewport', () => {
    const test = fixture(940, 700);
    test.reveal();
    expect(test.input.scrollTop).toBe(726);
    expect(test.mirror.remove).toHaveBeenCalledOnce();
  });

  it('keeps a visible caret at the current scroll position while editing in the middle', () => {
    const test = fixture(760, 700);
    test.reveal();
    expect(test.input.scrollTop).toBe(700);
  });

  it('reveals a caret above the viewport without going to the end of the draft', () => {
    const test = fixture(620, 700);
    test.reveal();
    expect(test.input.scrollTop).toBe(616);
  });

  it('measures the native width, wrapping and font for Chinese, tabs and a trailing blank line', () => {
    const test = fixture(940, 700);
    test.input.value = '```\n\t中文文字\n\n```';
    const caret = test.input.value.lastIndexOf('\n```');
    test.reveal(caret);
    expect(test.mirror.style.width).toBe('520px');
    expect(test.mirror.style.setProperty).toHaveBeenCalledWith('font-family', 'Monaco');
    expect(test.mirror.style.setProperty).toHaveBeenCalledWith('white-space', 'pre-wrap');
    expect(test.mirror.style.setProperty).toHaveBeenCalledWith('tab-size', '2');
    expect(test.mirror.textContent).toBe(test.input.value.slice(0, caret));
    expect(test.marker.textContent).toBe(test.input.value.slice(caret));
    expect(test.input.value).toBe('```\n\t中文文字\n\n```');
    expect(test.mirror.remove).toHaveBeenCalledOnce();
    test.reveal(test.input.value.length);
    expect(test.marker.textContent).toBe('\u200b');
    expect(test.mirror.remove).toHaveBeenCalledTimes(2);
  });

  it('uses the native viewport when short input needs no scrolling or temporary DOM', () => {
    const test = fixture(40, 0);
    test.input.scrollHeight = 80;
    test.reveal();
    expect(test.input.scrollTop).toBe(0);
    expect(test.createElement).not.toHaveBeenCalled();
  });
});
