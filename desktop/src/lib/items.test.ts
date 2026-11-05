import { describe, expect, it } from 'vitest';
import type { Message } from './api';
import { applyTurnEvent, buildItems, groupRoot, moveProject, orderProjects, projectRoot, worktreeName, splitAttachedFiles, buildRows, projectName, turnStatus, type Item } from './items';

const message = (overrides: Partial<Message> & Pick<Message, 'id' | 'kind'>): Message => ({
  text: '',
  isError: false,
  truncated: false,
  ...overrides,
});

describe('buildItems', () => {
  it('merges results into their tool cards and keeps order', () => {
    const items = buildItems([
      message({ id: '1', kind: 'user', text: 'hi' }),
      message({ id: '2', kind: 'tool_use', text: '{}', toolName: 'Read', toolUseId: 't1' }),
      message({ id: '3', kind: 'tool_use', text: '{}', toolName: 'Grep', toolUseId: 't2' }),
      message({ id: '4', kind: 'tool_result', text: 'two', toolUseId: 't2', isError: true }),
      message({ id: '5', kind: 'tool_result', text: 'one', toolUseId: 't1', truncated: true }),
      message({ id: '6', kind: 'assistant', text: 'done' }),
    ]);
    expect(items.map((item) => item.type)).toEqual(['user', 'tool', 'tool', 'assistant']);
    expect(items[1]).toMatchObject({ name: 'Read', result: 'one', isError: false, truncated: true });
    expect(items[2]).toMatchObject({ name: 'Grep', result: 'two', isError: true, truncated: false });
  });

  it('shows recorded interruptions as notices rather than user messages', () => {
    const items = buildItems([message({ id: '1', kind: 'user', text: '[Request interrupted by user for tool use]' })]);
    expect(items[0].type).toBe('notice');
  });

  it('drops a result whose tool use is not in the task', () => {
    expect(buildItems([message({ id: '1', kind: 'tool_result', toolUseId: 'gone' })])).toEqual([]);
  });
});

describe('applyTurnEvent', () => {
  it('joins consecutive deltas and starts a new item after another kind', () => {
    let items: Item[] = [];
    items = applyTurnEvent(items, { type: 'thinkingDelta', text: 'a' });
    items = applyTurnEvent(items, { type: 'thinkingDelta', text: 'b' });
    items = applyTurnEvent(items, { type: 'textDelta', text: 'c' });
    items = applyTurnEvent(items, { type: 'textDelta', text: 'd' });
    expect(items).toMatchObject([
      { type: 'thinking', text: 'ab' },
      { type: 'assistant', text: 'cd' },
    ]);
    expect(new Set(items.map((item) => item.id)).size).toBe(2);
  });

  it('fills the matching tool card', () => {
    let items = applyTurnEvent([], { type: 'toolUse', id: 't1', name: 'Read', input: '{}' });
    items = applyTurnEvent(items, { type: 'toolUse', id: 't2', name: 'Grep', input: '{}' });
    items = applyTurnEvent(items, { type: 'toolResult', toolUseId: 't1', text: 'x', isError: true });
    expect(items[0]).toMatchObject({ result: 'x', isError: true });
    expect(items[1]).toMatchObject({ result: null, isError: false });
  });
});

describe('buildRows', () => {
  const user = (id: string, at?: number): Item => ({ type: 'user', id, at, text: id });
  const answer = (id: string, at?: number): Item => ({ type: 'assistant', id, at, text: id });
  const thinking = (id: string): Item => ({ type: 'thinking', id, text: id });
  const tool = (id: string, at?: number): Item => ({
    type: 'tool',
    id,
    at,
    name: 'Read',
    input: '{}',
    result: 'x',
    isError: false,
    truncated: false,
  });

  it('folds the work before the final answer and reports how long it took', () => {
    const rows = buildRows(
      [user('u', 1000), thinking('t'), answer('mid', 2000), tool('a', 3000), answer('end', 5000)],
      false,
    );
    expect(rows.map((row) => row.type)).toEqual(['user', 'group', 'assistant']);
    expect(rows[1]).toMatchObject({ durationMs: 4000 });
    expect(rows[1].type === 'group' && rows[1].items.map((item) => item.id)).toEqual(['t', 'mid', 'a']);
    expect(rows[2].id).toBe('end');
  });

  it('shows an answer without work directly', () => {
    expect(buildRows([user('u'), answer('a')], false).map((row) => row.type)).toEqual(['user', 'assistant']);
  });

  it('folds a run of work without an answer, but leaves a single row alone', () => {
    expect(buildRows([user('u'), tool('a')], false).map((row) => row.type)).toEqual(['user', 'tool']);
    expect(buildRows([user('u'), tool('a'), tool('b')], false).map((row) => row.type)).toEqual(['user', 'group']);
  });

  it('keeps the running turn flat but folds earlier turns', () => {
    const items = [user('u1'), tool('a'), answer('b'), user('u2'), tool('c'), answer('d')];
    expect(buildRows(items, true).map((row) => row.type)).toEqual([
      'user', 'group', 'assistant', 'user', 'tool', 'assistant',
    ]);
  });

  it('omits the duration when a timestamp is missing', () => {
    const rows = buildRows([user('u'), tool('a'), answer('b', 5)], false);
    expect(rows[1]).toMatchObject({ durationMs: null });
  });
});

describe('projectName', () => {
  it('uses the last path segment', () => {
    expect(projectName('/work/app/')).toBe('app');
    expect(projectName('/')).toBe('/');
  });
});

describe('turnStatus', () => {
  const tool = { type: 'tool', id: 't', name: 'Bash', input: '', result: null, isError: false, truncated: false } as const;
  const text = (type: 'assistant' | 'thinking' | 'user') => ({ type, id: 'x', text: 'x' });

  it('says what the turn is doing', () => {
    expect(turnStatus([text('user')], false)).toBe('statusThinking');
    expect(turnStatus([text('thinking')], false)).toBe('statusThinking');
    expect(turnStatus([text('assistant')], false)).toBe('statusReplying');
    expect(turnStatus([tool], false)).toBe('statusCallingTool');
    expect(turnStatus([{ ...tool, result: 'done' }], false)).toBe('statusThinking');
  });

  it('puts waiting for the user first', () => {
    expect(turnStatus([tool], true)).toBe('statusAwaitingYou');
  });

  it('joins images to the text after them and turns attached file lines into files', () => {
    const base = { isError: false, truncated: false };
    const items = buildItems([
      { ...base, id: 'a', kind: 'user', text: '', image: 'data:image/png;base64,AA' },
      { ...base, id: 'b', kind: 'user', text: 'look\n\nAttached file, readable with your tools even outside the workspace: /logs/app (1).log' },
      { ...base, id: 'c', kind: 'assistant', text: 'ok' },
      { ...base, id: 'd', kind: 'user', text: '', image: 'data:image/png;base64,BB' },
      { ...base, id: 'e', kind: 'assistant', text: 'seen' },
    ]);
    expect(items[0]).toMatchObject({
      type: 'user',
      text: 'look',
      images: ['data:image/png;base64,AA'],
      files: [{ name: 'app (1).log', path: '/logs/app (1).log' }],
    });
    expect(items[2]).toMatchObject({ type: 'user', text: '', images: ['data:image/png;base64,BB'] });
    expect(items).toHaveLength(4);
  });

  it('leaves text without attached files alone', () => {
    expect(splitAttachedFiles('line\n\n')).toEqual({ text: 'line\n\n', files: [] });
    expect(splitAttachedFiles('Attached file, readable with your tools even outside the workspace: /a.log')).toEqual({ text: '', files: [{ name: 'a.log', path: '/a.log' }] });
  });

  it('groups a worktree under its project', () => {
    expect(projectRoot('/code/app/.claude/worktrees/quiet-owl')).toBe('/code/app');
    expect(worktreeName('/code/app/.claude/worktrees/quiet-owl/sub')).toBe('quiet-owl');
    expect(projectRoot('/code/app')).toBe('/code/app');
    expect(worktreeName('/code/app')).toBeNull();
  });

  it('groups a task under the deepest added project', () => {
    const roots = ['/code/app', '/code/app/service'];
    expect(groupRoot('/code/app/service/api', roots)).toBe('/code/app/service');
    expect(groupRoot('/code/app/docs', roots)).toBe('/code/app');
    expect(groupRoot('/code/app-two', roots)).toBe('/code/app-two');
    expect(groupRoot('/other/.claude/worktrees/x', roots)).toBe('/other');
  });
});

describe('compaction', () => {
  const message = (id: string, kind: Message['kind'], text = ''): Message => ({ id, kind, text, isError: false, truncated: false });

  it('stands between turns and is never folded into the work', () => {
    const items = buildItems([
      message('u', 'user', 'question'),
      message('t', 'thinking', 'hm'),
      message('a', 'assistant', 'answer'),
      message('c', 'compaction'),
      message('t2', 'thinking', 'more'),
      message('a2', 'assistant', 'next'),
    ]);
    const rows = buildRows(items, false);
    expect(rows.map((row) => row.type)).toEqual(['user', 'group', 'assistant', 'compaction', 'group', 'assistant']);
  });
});

describe('a stopped turn', () => {
  it('keeps its marker outside the folded work', () => {
    const rows = buildRows(
      [
        { type: 'user', id: 'u', text: 'go' },
        { type: 'thinking', id: 't', text: 'hm' },
        { type: 'thinking', id: 't2', text: 'hm' },
        { type: 'notice', id: 'n', text: 'stopped' },
      ],
      false,
    );
    expect(rows.map((row) => row.type)).toEqual(['user', 'group', 'notice']);
  });
});

describe('project order', () => {
  const groups = (names: string[]): [string, number][] => names.map((name, index) => [name, index]);

  it('keeps the saved order and puts new projects first', () => {
    const ordered = orderProjects(groups(['a', 'b', 'new', 'c']), ['c', 'a', 'b', 'gone']);
    expect(ordered.map(([name]) => name)).toEqual(['new', 'c', 'a', 'b']);
  });

  it('moves a project to land before the row at the target', () => {
    expect(moveProject(['a', 'b', 'c'], 'a', 2)).toEqual(['b', 'a', 'c']);
    expect(moveProject(['a', 'b', 'c'], 'a', 3)).toEqual(['b', 'c', 'a']);
    expect(moveProject(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b']);
    expect(moveProject(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'b', 'c']);
  });
});
