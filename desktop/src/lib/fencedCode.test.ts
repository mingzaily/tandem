import { describe, expect, it } from 'vitest';
import { codeRanges, completeCodeFence, codeKeyEdit, isCodeOnly } from './fencedCode';

describe('composer code fences', () => {
  it('uses code typography only when all visible input belongs to fenced blocks', () => {
    expect(isCodeOnly('```\n\n```')).toBe(true);
    expect(isCodeOnly('```sh\n  command\noutput')).toBe(true);
    expect(isCodeOnly(' \n```ts\nconst x = 1;\n```\n\n~~~\nother\n~~~\n')).toBe(true);
    expect(isCodeOnly('正文\n```\ncode\n```')).toBe(false);
    expect(isCodeOnly('```\ncode\n```\n后续正文')).toBe(false);
    expect(isCodeOnly('inline ```code```')).toBe(false);
    expect(isCodeOnly('')).toBe(false);
  });
  it('completes only a third typed backtick on a separate line and places the caret in its body', () => {
    expect(completeCodeFence('``', '```', 3)).toEqual({ value: '```\n\n```', caret: 4 });
    expect(completeCodeFence('正文\n``', '正文\n```', 6)).toEqual({ value: '正文\n```\n\n```', caret: 7 });
    expect(completeCodeFence('', '```', 3)).toBeNull();
    expect(completeCodeFence('a ``', 'a ```', 5)).toBeNull();
  });

  it('leaves closing fences and literal backticks inside an existing block untouched', () => {
    const before = '```\ncode\n``';
    expect(completeCodeFence(before, before + '`', before.length + 1)).toBeNull();
    expect(completeCodeFence('```\n``', '```\n```', 7)).toBeNull();
  });

  it('keeps lists and indentation literal inside code and allows multi-line replacement', () => {
    const source = '```\n  - item\n```';
    const caret = source.indexOf('\n```');
    const edit = codeKeyEdit(source, caret, caret, 'Enter');
    expect(edit?.value).toBe('```\n  - item\n  \n```');
    expect(codeKeyEdit(source, 6, 8, 'Tab')?.value).toBe('```\n    item\n```');
    expect(codeKeyEdit('normal', 3, 3, 'Enter')).toBeNull();
  });

  it('moves below the closing fence with ArrowDown while preserving a following paragraph', () => {
    const value = '```\ncode\n```';
    expect(codeKeyEdit(value, 8, 8, 'ArrowDown')).toEqual({ value: value + '\n', caret: value.length + 1 });
    const followed = value + '\nnext';
    expect(codeKeyEdit(followed, 8, 8, 'ArrowDown')).toEqual({ value: followed, caret: value.length + 1 });
  });

  it('removes an empty code block as a single edit while retaining the surrounding text', () => {
    expect(codeKeyEdit('before\n```\n\n```\nafter', 11, 11, 'Backspace')).toEqual({ value: 'before\n\nafter', caret: 7 });
    expect(codeKeyEdit('```\ncode\n```', 5, 5, 'Backspace')).toBeNull();
  });

  it('tracks multiple language fences, long markers and unfinished blocks without treating inline text as code', () => {
    const source = 'inline ```\n```ts\na\n```\n~~~~\nb\n~~~~\n```\nc';
    const ranges = codeRanges(source);
    expect(ranges).toHaveLength(3);
    expect(ranges.map(({ marker, closed }) => ({ marker, closed }))).toEqual([{ marker: '```', closed: true }, { marker: '~~~~', closed: true }, { marker: '```', closed: false }]);
    expect(source.slice(ranges[0].bodyFrom, ranges[0].bodyTo)).toBe('a\n');
    expect(codeRanges('````\na\n```')[0].closed).toBe(false);
  });
});
