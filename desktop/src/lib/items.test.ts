import { describe, expect, it } from 'vitest';
import type { Message } from './api';
import { applyTurnEvent, buildItems, flattenRows, visibleWorkItems, groupRoot, moveProject, orderProjects, projectRoot, worktreeName, splitAttachedFiles, buildRows, historyBeforeLiveTurn, lastEditablePrompt, projectName, turnStatus, withTurnFailures, type Item } from './items';

const message = (overrides: Partial<Message> & Pick<Message, 'id' | 'kind'>): Message => ({
  text: '',
  isError: false,
  truncated: false,
  ...overrides,
});

describe('buildItems', () => {
  it('keeps image-only prompts before a compaction marker with their native time', () => {
    const items = buildItems([
      message({ id: 'image', kind: 'user', imageError: 'missing', timestamp: '2026-11-08T09:00:00Z' }),
      message({ id: 'compaction', kind: 'compaction' }),
      message({ id: 'answer', kind: 'assistant', text: 'Done' }),
    ]);
    expect(items.map(({ type }) => type)).toEqual(['user', 'compaction', 'assistant']);
    expect(items[0]).toMatchObject({ at: Date.parse('2026-11-08T09:00:00Z'), imageErrors: ['missing'] });
  });
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

describe('reply failures stay at their turn boundary', () => {
  it('preserves native failure details between the failed input and the next input', () => {
    const items = buildItems([message({ id: 'u', kind: 'user', text: 'first' }), message({ id: 'e', kind: 'assistant', isError: true, text: 'provider failed' }), message({ id: 'n', kind: 'user', text: 'retry' })]);
    expect(buildRows(items, true).map((row) => row.type)).toEqual(['user', 'error', 'user']);
    expect(items[1]).toMatchObject({ text: 'provider failed' });
  });
  it('restores a transport error at its original input while an identical new input keeps running', () => {
    const error = { type: 'error' as const, id: 'failure', text: 'socket closed' };
    const failures = [{ prompt: 'same', sentAt: 100, error }];
    const history: Item[] = [{ type: 'user', id: 'old', at: 1, text: 'same' }, { type: 'assistant', id: 'a', text: 'done' }, { type: 'user', id: 'failed', at: 110, text: 'same' }, { type: 'user', id: 'retry', at: 200, text: 'same' }];
    const restored = withTurnFailures(history, failures);
    expect(restored.map(({ id }) => id)).toEqual(['old', 'a', 'failed', 'failure', 'retry']);
    expect(withTurnFailures(restored, failures)).toEqual(restored);
    const withoutTimes = history.map(({ at: _removed, ...item }) => item);
    expect(withTurnFailures(withoutTimes, [{ ...failures[0], endedAt: 150, occurrence: 1 }]).map(({ id }) => id)).toEqual(['old', 'a', 'failed', 'failure', 'retry']);
    expect(withTurnFailures([{ type: 'user', id: 'later', at: 200, text: 'same' }], [{ ...failures[0], endedAt: 150 }])).toHaveLength(1);
    expect(withTurnFailures([{ type: 'user', id: 'other', text: 'another task' }], failures)).toHaveLength(1);
  });
  it('appends a failure only for the terminal failed outcome', () => {
    const input: Item[] = [{ type: 'user', id: 'u', text: 'first' }];
    expect(applyTurnEvent(input, { type: 'finished', isError: true, cancelled: false, message: 'provider failed' }).at(-1)).toMatchObject({ type: 'error', text: 'provider failed' });
    expect(applyTurnEvent(input, { type: 'finished', isError: true, cancelled: true, message: 'aborted' })).toEqual(input);
    expect(applyTurnEvent(input, { type: 'finished', isError: false, cancelled: false, message: null })).toEqual(input);
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

  it('keeps a message added mid-turn inside that turn, after the work before it', () => {
    const rows = buildRows([user('u'), tool('t1'), { type: 'user', id: 's', text: 'also', steered: true }, tool('t2')], true);
    expect(rows.map((row) => row.type === 'group' ? `group:${row.items.map((item) => item.id).join(',')}` : row.id))
      .toEqual(['u', 'group:t1', 's', 'group:t2']);
    const groups = rows.filter((row) => row.type === 'group');
    expect(groups.map((group) => group.isRunning)).toEqual([false, true]);
    expect(visibleWorkItems(groups[0]).map(({ id }) => id)).toEqual(['t1']);
  });

  it.each([1, 8])('keeps the same %i-activity preview when an input is steered into the active turn', (count) => {
    const items = [user('u'), ...Array.from({ length: count }, (_, index) => tool(`t${index}`))];
    const before = buildRows(items, true)[1];
    const after = buildRows([...items, { type: 'user', id: 'steer', text: 'narrow the search', steered: true }], true)[1];
    if (before.type !== 'group' || after.type !== 'group') throw new Error('Expected work groups');
    expect(after.id).toBe(before.id);
    expect(after.isRunning).toBe(true);
    expect(visibleWorkItems(after)).toEqual(visibleWorkItems(before));
    expect(visibleWorkItems(after, false)).toEqual([]);
    expect(visibleWorkItems(after, true)).toEqual(visibleWorkItems(before, true));
  });

  it('keeps older steer previews visible and gives only the newest activity segment the running state', () => {
    const rows = buildRows([user('u'), tool('a'), { type: 'user', id: 's1', text: 'first steer', steered: true },
      tool('b'), { type: 'user', id: 's2', text: 'second steer', steered: true }, tool('c')], true);
    const groups = rows.filter((row) => row.type === 'group');
    expect(groups.map((group) => group.isRunning)).toEqual([false, false, true]);
    expect(groups.map((group) => visibleWorkItems(group).map(({ id }) => id))).toEqual([['a'], ['b'], ['c']]);
    expect(groups.slice(0, -1).every((group) => group.preview === true)).toBe(true);
    expect(visibleWorkItems(groups[0], false)).toEqual([]);
  });

  it('seals earlier segments only when assistant prose follows, keeping a real later turn separate', () => {
    const items: Item[] = [user('u'), tool('a'), { type: 'user', id: 'steer', text: 'also', steered: true }, tool('b'), answer('progress'), tool('c')];
    expect(buildRows(items, true).filter((row) => row.type === 'group').map((group) => group.isRunning)).toEqual([false, false, true]);
    const nextTurn = buildRows([...items, user('next'), tool('d')], true);
    expect(nextTurn.filter((row) => row.type === 'group').map((group) => group.isRunning)).toEqual([false, false, true]);
    expect(nextTurn.filter((row) => row.type === 'user').map(({ id }) => id)).toEqual(['u', 'steer', 'next']);
  });

  it('keeps every steered bubble outside the work fold on completion and interruption', () => {
    const input: Item = { type: 'user', id: 's', text: 'also', steered: true };
    const items = [user('u'), tool('before'), input, tool('after')];
    const completed = buildRows([...items, answer('final')], false);
    expect(completed.map((row) => row.type)).toEqual(['user', 'group', 'user', 'group', 'assistant']);
    expect(completed.filter((row) => row.type === 'user')).toContain(input);
    const interrupted = buildRows([...items, { type: 'notice', id: 'stop', text: 'stopped' }], false);
    expect(interrupted.map((row) => row.type)).toEqual(['user', 'group', 'user', 'group', 'notice']);
  });

  it('leaves out thinking that streamed no text', () => {
    const rows = buildRows([user('u'), { type: 'thinking', id: 'blank', text: '  ' }, tool('t'), answer('a')], false);
    expect(flattenRows(rows).map((item) => item.id)).toEqual(['u', 't', 'a']);
  });

  it('folds the work before the final answer and reports how long it took', () => {
    const rows = buildRows(
      [user('u', 1000), thinking('t'), answer('mid', 2000), tool('a', 3000), answer('end', 5000)],
      false,
    );
    expect(rows.map((row) => row.type)).toEqual(['user', 'group', 'assistant']);
    expect(rows[1]).toMatchObject({ durationMs: 4000 });
    expect(rows[1].type === 'group' && flattenRows(rows[1].items).map((item) => item.id)).toEqual(['t', 'mid', 'a']);
    expect(rows[2].id).toBe('end');
  });

  it('shows an answer without work directly', () => {
    expect(buildRows([user('u'), answer('a')], false).map((row) => row.type)).toEqual(['user', 'assistant']);
  });

  it('folds completed work even when a turn ends before an answer', () => {
    expect(buildRows([user('u'), tool('a')], false).map((row) => row.type)).toEqual(['user', 'group']);
    expect(buildRows([user('u'), tool('a'), tool('b')], false).map((row) => row.type)).toEqual(['user', 'group']);
  });

  it('folds progress and trailing actions when a turn stops before its final reply', () => {
    const rows = buildRows([user('u'), answer('progress'), tool('a'), { type: 'notice', id: 'stop', text: 'stopped' }], false);
    expect(rows.map(({ type }) => type)).toEqual(['user', 'group', 'notice']);
    expect(rows[1].type === 'group' && flattenRows(rows[1].items).map(({ id }) => id)).toEqual(['progress', 'a']);
  });

  it('groups running actions while keeping assistant progress visible', () => {
    const items = [user('u1'), tool('a'), answer('b'), user('u2'), tool('c'), answer('d')];
    expect(buildRows(items, true).map((row) => row.type)).toEqual([
      'user', 'group', 'assistant', 'user', 'group', 'assistant',
    ]);
  });

  it('marks only the trailing action segment as running within the active turn', () => {
    const items = [user('u'), tool('first'), answer('progress-1'), thinking('second'), tool('third'), answer('progress-2'), thinking('current')];
    const rows = buildRows(items, true);
    const groups = rows.filter((row) => row.type === 'group');
    expect(groups).toMatchObject([
      { id: 'group-first', isRunning: false },
      { id: 'group-second', isRunning: false },
      { id: 'group-current', isRunning: true },
    ]);
    expect(flattenRows(rows)).toEqual(items);
  });

  it('finishes action segments when the assistant starts replying while the turn remains active', () => {
    const rows = buildRows([user('u', 1000), tool('a', 2000), answer('reply', 3000)], true);
    const group = rows[1];
    expect(group).toMatchObject({ type: 'group', isRunning: false, durationMs: 2000 });
    if (group.type !== 'group') throw new Error('Expected completed group');
    expect(visibleWorkItems(group, false)).toEqual([]);
    expect(visibleWorkItems(group, true).map(({ id }) => id)).toEqual(['a']);
    expect(rows[2]).toMatchObject({ type: 'assistant', id: 'reply' });
  });

  it('keeps completed action segments inside the outer progress group', () => {
    const rows = buildRows([user('u', 1000), tool('a', 2000), answer('mid', 3000), tool('b', 4000), answer('end', 255000)], false);
    const outer = rows[1];
    expect(rows.map((row) => row.type)).toEqual(['user', 'group', 'assistant']);
    expect(outer).toMatchObject({ durationMs: 254000, isRunning: false });
    expect(outer.type === 'group' && outer.items.map((item) => item.type)).toEqual(['group', 'assistant', 'group']);
  });

  it('previews five activities and reveals the full running group on request', () => {
    const rows = buildRows([user('u'), ...Array.from({ length: 8 }, (_, i) => tool(`t${i}`))], true);
    const group = rows[1];
    if (group.type !== 'group') throw new Error('Expected running group');
    expect(visibleWorkItems(group).map(({ id }) => id)).toEqual(['t3', 't4', 't5', 't6', 't7']);
    expect(visibleWorkItems(group, true)).toHaveLength(8);
    expect(visibleWorkItems(group, false)).toEqual([]);
    expect(visibleWorkItems({ ...group, isRunning: false })).toEqual([]);
  });

  it.each([1, 8])('keeps a manually collapsed %i-activity group hidden as new work arrives', (count) => {
    const items = [user('u'), ...Array.from({ length: count }, (_, index) => tool(`t${index}`))];
    const first = buildRows(items, true)[1];
    const updated = buildRows([...items, tool('next')], true)[1];
    if (first.type !== 'group' || updated.type !== 'group') throw new Error('Expected running groups');
    expect(updated.id).toBe(first.id);
    expect(visibleWorkItems(first, false)).toEqual([]);
    expect(visibleWorkItems(updated, false)).toEqual([]);
    expect(visibleWorkItems(updated, true)).toHaveLength(count + 1);
    expect(visibleWorkItems(updated)).toHaveLength(Math.min(5, count + 1));
  });

  it('gives completed work an outer disclosure separate from its running preview', () => {
    const items = [user('u'), tool('a'), answer('end')];
    expect(buildRows(items, false)[1].id).not.toBe(buildRows(items, true)[1].id);
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
    expect(turnStatus([text('user')], false)).toEqual({ key: 'statusThinking' });
    expect(turnStatus([text('thinking')], false)).toEqual({ key: 'statusThinking' });
    expect(turnStatus([text('assistant')], false)).toEqual({ key: 'statusReplying' });
    expect(turnStatus([tool], false)).toEqual({ key: 'statusCallingTool', toolName: 'Bash' });
    expect(turnStatus([{ ...tool, result: 'done' }], false)).toEqual({ key: 'statusThinking' });
  });

  it('puts waiting for the user first', () => {
    expect(turnStatus([tool], true)).toEqual({ key: 'statusAwaitingYou' });
  });

  it('keeps the actual tool name from live CLI events and clears it after the result', () => {
    const running = applyTurnEvent([], { type: 'toolUse', id: 'mcp', name: 'mcp__memory__search', input: '{"query":"private arguments"}' });
    expect(turnStatus(running, false)).toEqual({ key: 'statusCallingTool', toolName: 'mcp__memory__search' });
    const completed = applyTurnEvent(running, { type: 'toolResult', toolUseId: 'mcp', text: 'private result', isError: true });
    expect(turnStatus(completed, false)).toEqual({ key: 'statusThinking' });
    expect(turnStatus(applyTurnEvent(completed, { type: 'textDelta', text: '已找到结果' }), false)).toEqual({ key: 'statusReplying' });
  });

  it('shows the remaining tool when parallel calls finish out of order', () => {
    const first = { ...tool, id: 'first', name: 'mcp__memory__search' };
    const second = { ...tool, id: 'second', name: 'mcp__docs__read' };
    expect(turnStatus([first, second], false)).toEqual({ key: 'statusCallingTool', toolName: second.name });
    expect(turnStatus([first, { ...second, result: 'done' }], false)).toEqual({ key: 'statusCallingTool', toolName: first.name });
  });

  it('keeps the current activity across a steer while an ordinary input starts its own status', () => {
    const steer: Item = { type: 'user', id: 'steer', text: 'only Code', steered: true };
    const first = { ...tool, id: 'first', name: 'Bash' };
    const second = { ...tool, id: 'second', name: 'Read', result: 'done' };
    expect(turnStatus([first, steer], false)).toEqual({ key: 'statusCallingTool', toolName: 'Bash' });
    expect(turnStatus([first, steer, second], false)).toEqual({ key: 'statusCallingTool', toolName: 'Bash' });
    expect(turnStatus([text('assistant'), steer], false)).toEqual({ key: 'statusReplying' });
    expect(turnStatus([first, text('user')], false)).toEqual({ key: 'statusThinking' });
  });

  it('uses the latest text phase and keeps old tool calls outside a new turn', () => {
    expect(turnStatus([tool, text('assistant')], false)).toEqual({ key: 'statusReplying' });
    expect(turnStatus([tool, text('thinking')], false)).toEqual({ key: 'statusThinking' });
    expect(turnStatus([tool, text('user'), { ...tool, id: 'new', result: 'done' }], false)).toEqual({ key: 'statusThinking' });
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

describe('editing the last prompt', () => {
  const user = (id: string, extra: Partial<Item> = {}): Item => ({ type: 'user', id, text: 'ask', ...extra } as Item);
  const answer: Item = { type: 'assistant', id: 'a', text: 'done' };
  it('offers only the last plain prompt that has a turn before it', () => {
    expect(lastEditablePrompt([user('u1'), answer, user('u2'), answer])).toBe('u2');
    expect(lastEditablePrompt([user('u1'), answer])).toBeNull();
    expect(lastEditablePrompt([user('u1'), answer, user('live-user-x')])).toBeNull();
    expect(lastEditablePrompt([user('u1'), answer, user('u2', { files: [{ name: 'a.ts', path: '/a.ts' }] })])).toBeNull();
    expect(lastEditablePrompt([user('u1'), answer, user('u2', { images: ['data:image/png;base64,AA'] })])).toBeNull();
  });
});

describe('historyBeforeLiveTurn', () => {
  const user = (id: string, text: string, at?: number): Item => ({ type: 'user', id, text, at });
  const answer = (id: string): Item => ({ type: 'assistant', id, text: id });

  it('drops the running turn the file already holds, with its image row', () => {
    const images: Item = { type: 'user', id: 'img', text: '', images: ['a.png'], at: 5 };
    const history = [user('u1', 'earlier'), answer('a1'), images, user('u2', 'now', 5), answer('a2')];
    const live = [user('live', 'now'), answer('streaming')];
    expect(historyBeforeLiveTurn(history, live).map((item) => item.id)).toEqual(['u1', 'a1']);
  });

  it('matches the single visible prompt after native image metadata is separated from its text', () => {
    const history = buildItems([
      message({ id: 'old', kind: 'user', text: 'earlier' }),
      message({ id: 'answer', kind: 'assistant', text: 'done' }),
      message({ id: 'image', kind: 'user', image: 'data:image/png;base64,AA', timestamp: '2026-11-10T09:00:00Z' }),
      message({ id: 'prompt', kind: 'user', text: '1. 那就调整呗\n2. 为啥会这样', timestamp: '2026-11-10T09:00:00Z' }),
    ]);
    const live: Item[] = [{ type: 'user', id: 'live', text: '1. 那就调整呗\n2. 为啥会这样', images: ['original.png'] }];
    const combined = [...historyBeforeLiveTurn(history, live), ...live];
    expect(combined.filter((item) => item.type === 'user' && item.text.includes('为啥'))).toHaveLength(1);
    expect(combined.filter((item) => item.type === 'user' && item.images?.length)).toHaveLength(1);
    expect(combined.map(({ id }) => id)).toEqual(['old', 'answer', 'live']);
  });

  it('merges native steer input with its live copy through the shared CLI message path', () => {
    const history = buildItems([
      message({ id: 'old', kind: 'user', text: 'earlier' }), message({ id: 'old-answer', kind: 'assistant', text: 'done' }),
      message({ id: 'native-user', kind: 'user', text: 'look at disk', timestamp: '2026-11-11T02:41:25.470Z' }),
      message({ id: 'native-tool', kind: 'tool_use', toolName: 'Bash', toolUseId: 'call', text: '{}' }),
      message({ id: 'native-result', kind: 'tool_result', toolUseId: 'call', text: 'measured' }),
      message({ id: 'native-steer', kind: 'user', text: 'only ~/Code', timestamp: '2026-11-11T02:44:27.068Z' }),
    ]);
    let live: Item[] = [user('live-user', 'look at disk')];
    live = applyTurnEvent(live, { type: 'toolUse', id: 'call', name: 'Bash', input: '{}' });
    live = applyTurnEvent(live, { type: 'toolResult', toolUseId: 'call', text: 'measured', isError: false });
    live.push({ type: 'user', id: 'live-steer', text: 'only ~/Code', steered: true });
    const combined = [...historyBeforeLiveTurn(history, live), ...live];
    expect(combined.filter((item) => item.type === 'user').map((item) => item.text)).toEqual(['earlier', 'look at disk', 'only ~/Code']);
    expect(combined.filter((item) => item.type === 'tool')).toHaveLength(1);
    const groups = buildRows(combined, true).filter((row) => row.type === 'group');
    expect(groups.at(-1)?.isRunning).toBe(true);
  });

  it('matches repeated steering text by the complete input sequence and the live start time', () => {
    const history = [user('old', 'same', 10), answer('old-answer'), user('native', 'same', 110),
      user('steer-1', 'same', 150), user('steer-2', 'only Code', 180)];
    const live: Item[] = [user('live', 'same', 100), { type: 'user', id: 's1', text: 'same', steered: true }, { type: 'user', id: 's2', text: 'only Code', steered: true }];
    expect(historyBeforeLiveTurn(history, live).map(({ id }) => id)).toEqual(['old', 'old-answer']);
    expect(historyBeforeLiveTurn([user('old', 'same', 10), answer('old-answer')], [user('new', 'same', 100)]).map(({ id }) => id)).toEqual(['old', 'old-answer']);
  });

  it('keeps history when the live prompt is not its latest message', () => {
    const history = [user('u1', 'same'), answer('a1'), user('u2', 'later'), answer('a2')];
    expect(historyBeforeLiveTurn(history, [user('live', 'same')])).toBe(history);
    expect(historyBeforeLiveTurn(history, undefined)).toBe(history);
  });
});
