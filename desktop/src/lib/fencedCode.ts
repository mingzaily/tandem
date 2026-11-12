export interface CodeRange { from: number; to: number; bodyFrom: number; bodyTo: number; closed: boolean; marker: string }
export interface CodeEdit { value: string; caret: number }

/** Markdown fences stay plain text; ranges only decorate the native editor. */
export function codeRanges(value: string): CodeRange[] {
  const ranges: CodeRange[] = [];
  let open: { from: number; bodyFrom: number; marker: string } | null = null;
  let offset = 0;
  for (const line of value.split('\n')) {
    if (open) {
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*\r?$/.exec(line);
      if (close && close[1][0] === open.marker[0] && close[1].length >= open.marker.length) {
        ranges.push({ ...open, to: offset + line.length, bodyTo: offset, closed: true });
        open = null;
      }
    } else {
      const start = /^ {0,3}(`{3,}|~{3,})([^\r\n]*)\r?$/.exec(line);
      if (start && !(start[1][0] === '`' && start[2].includes('`'))) {
        open = { from: offset, bodyFrom: offset + line.length + 1, marker: start[1] };
      }
    }
    offset += line.length + 1;
  }
  if (open) ranges.push({ ...open, to: value.length, bodyTo: value.length, closed: false });
  return ranges;
}

/** Only the third typed backtick on a fresh line completes a block; paste and closing fences keep their text. */
export function completeCodeFence(previous: string, value: string, caret: number): CodeEdit | null {
  if (caret < 3 || value.length !== previous.length + 1 || value[caret - 1] !== '`'
    || value.slice(0, caret - 1) + value.slice(caret) !== previous) return null;
  const lineStart = value.lastIndexOf('\n', caret - 1) + 1;
  const lineEnd = value.indexOf('\n', caret);
  const line = value.slice(lineStart, lineEnd < 0 ? value.length : lineEnd);
  const match = /^( {0,3})```$/.exec(line);
  if (!match || caret !== lineStart + line.length || codeRanges(value.slice(0, lineStart)).some((range) => !range.closed)) return null;
  const insert = `\n${match[1]}\n${match[1]}\`\`\``;
  return { value: value.slice(0, caret) + insert + value.slice(caret), caret: caret + 1 + match[1].length };
}

export function insideCodeFence(value: string, caret: number): boolean {
  return codeRanges(value).some((range) => caret >= range.bodyFrom && caret <= range.bodyTo);
}

export function codeKeyEdit(value: string, start: number, end: number, key: string): CodeEdit | null {
  const range = codeRanges(value).find((range) => start >= range.bodyFrom && end <= range.bodyTo);
  if (!range) return null;
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const indent = /^[ \t]*/.exec(value.slice(lineStart, start))![0];
  if (key === 'Enter' || key === 'Tab') {
    const insert = key === 'Tab' ? '  ' : `\n${indent}`;
    return { value: value.slice(0, start) + insert + value.slice(end), caret: start + insert.length };
  }
  if (key === 'ArrowDown' && start === end && range.closed && value.slice(start, range.bodyTo).split('\n').length <= 2) {
    const newline = value[range.to] === '\n';
    const insert = newline ? '' : '\n';
    return { value: value.slice(0, range.to) + insert + value.slice(range.to), caret: range.to + 1 };
  }
  if (key === 'Backspace' && start === end && range.closed && !value.slice(range.bodyFrom, range.bodyTo).trim()) {
    return { value: value.slice(0, range.from) + value.slice(range.to), caret: range.from };
  }
  return null;
}
