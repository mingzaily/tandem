import { describe, expect, it } from 'vitest';
import { continueList } from './listContinuation';

const at = (value: string) => continueList(value, value.length);

describe('continueList', () => {
  it('starts the next item after a numbered or bulleted line', () => {
    expect(at('1. first')).toEqual({ value: '1. first\n2. ', caret: 12 });
    expect(at('intro\n  9) nine')?.value).toBe('intro\n  9) nine\n  10) ');
    expect(at('3、第三项')?.value).toBe('3、第三项\n4、');
    expect(at('- item')?.value).toBe('- item\n- ');
  });

  it('leaves the list on an empty item', () => {
    expect(at('1. first\n2. ')).toEqual({ value: '1. first\n', caret: 9 });
    expect(at('  - ')).toEqual({ value: '  ', caret: 2 });
  });

  it('preserves list-like code lines inside both Markdown fence styles', () => {
    expect(at('```\n- item')).toBeNull();
    expect(at('~~~ts\n1. value')).toBeNull();
    expect(at('```\n- item\n```\n- prose')?.value).toBe('```\n- item\n```\n- prose\n- ');
  });

  it('keeps text after the caret on the new item and ignores plain lines', () => {
    expect(continueList('1. first second', 8)).toEqual({ value: '1. first\n2.  second', caret: 12 });
    expect(at('plain text')).toBeNull();
    expect(at('1.5 is a number')).toBeNull();
    expect(at('-dash without space')).toBeNull();
  });
});
