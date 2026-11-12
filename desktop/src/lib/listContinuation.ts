import { insideCodeFence } from './fencedCode';

/**
 * Continues a typed list on a new line, as the reference composer does (`ComposerListNodes.ts`):
 * after "1. item" the newline key starts "2. ", after "- item" another "- ", and on an empty
 * item it removes the marker and leaves the list. Lines that are not list items get null.
 */
const ORDERED = /^(\s*)([1-9]\d{0,8})([.)])([ \t]+)(.*)$/;
const CJK_ORDERED = /^(\s*)([1-9]\d{0,8})(、)([ \t]*)(.*)$/;
const BULLET = /^(\s*)([-+*•])([ \t]+)(.*)$/;

export interface ListEdit {
  value: string;
  caret: number;
}

export function continueList(value: string, caret: number): ListEdit | null {
  if (insideCodeFence(value, caret)) return null;
  const lineStart = value.lastIndexOf('\n', caret - 1) + 1;
  const before = value.slice(lineStart, caret);
  const after = value.slice(caret);
  const ordered = ORDERED.exec(before) ?? CJK_ORDERED.exec(before);
  const bullet = ordered ? null : BULLET.exec(before);
  if (!ordered && !bullet) return null;

  const indent = (ordered ?? bullet)![1];
  const body = ordered ? ordered[5] : bullet![4];
  const restOfLine = after.split('\n', 1)[0];
  if (!body.trim() && !restOfLine.trim()) {
    // An empty item ends the list: the marker goes and the line is left as plain text.
    return { value: value.slice(0, lineStart) + indent + after, caret: lineStart + indent.length };
  }
  const marker = ordered
    ? `${Number(ordered[2]) + 1}${ordered[3]}${ordered[4]}`
    : `${bullet![2]}${bullet![3]}`;
  const insert = `\n${indent}${marker}`;
  return { value: value.slice(0, caret) + insert + after, caret: caret + insert.length };
}
