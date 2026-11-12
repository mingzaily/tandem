import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyTurnEvent,
  buildItems,
  buildRows,
  turnStatus,
  visibleWorkItems,
  type Item,
} from '../src/lib/items.ts';
import type { Message } from '../src/lib/types.ts';
const message = (id: string, kind: Message['kind'], text = '', extra: Partial<Message> = {}): Message => ({
  id,
  kind,
  text,
  isError: false,
  truncated: false,
  ...extra,
});
test('failed replies remain between their prompt and the next prompt', () => {
  const native = buildItems([message('u', 'user', 'first'), message('e', 'assistant', 'provider failed', { isError: true }), message('next', 'user', 'retry')]);
  assert.deepEqual(buildRows(native, true).map((row) => row.type), ['user', 'error', 'user']);
  const live = applyTurnEvent([{ type: 'user', id: 'u', text: 'first' }], { type: 'finished', isError: true, cancelled: false, message: 'provider failed' });
  assert.equal(live[1].type, 'error');
  assert.deepEqual(applyTurnEvent([], { type: 'finished', isError: true, cancelled: true, message: 'aborted' }), []);
});

test('work groups merge matching tool results and leave the final answer visible', () => {
  const items = buildItems([
    message('u', 'user', 'start', { timestamp: '2026-01-01T00:00:00Z' }),
    message('think', 'thinking', 'plan'),
    message('tool', 'tool_use', '{}', { toolUseId: 'a', toolName: 'Read' }),
    message('orphan', 'tool_result', 'outside page', { toolUseId: 'outside' }),
    message('result', 'tool_result', 'file', { toolUseId: 'a', isError: true }),
    message('answer', 'assistant', 'done', { timestamp: '2026-01-01T00:00:08Z' }),
  ]);
  const rows = buildRows(items, false);
  assert.deepEqual(
    rows.map((r) => r.type),
    ['user', 'group', 'assistant'],
  );
  assert.equal(rows[1].type === 'group' && rows[1].durationMs, 8000);
  assert.equal(
    rows[1].type === 'group' && rows[1].items[1].type === 'tool' && rows[1].items[1].result,
    'file',
  );
});
test('running work stays expanded and notices remain visible at group boundaries', () => {
  const items = buildItems([
    message('u', 'user', 'start'),
    message('t', 'thinking', 'work'),
    message('a', 'assistant', 'done'),
    message('c', 'compaction'),
    message('n', 'user', '[Request interrupted by user]'),
    message('u2', 'user', 'continue'),
    message('t2', 'thinking', 'live'),
  ]);
  const rows = buildRows(items, true);
  assert.deepEqual(
    rows.map((r) => r.type),
    ['user', 'group', 'assistant', 'compaction', 'notice', 'user', 'group'],
  );
  const live = rows.at(-1);
  assert.ok(live?.type === 'group');
  assert.equal(live.isRunning, true);
  assert.equal(visibleWorkItems(live)[0].id, 't2');
});
test('live deltas and interleaved tool results preserve their identity', () => {
  let items: Item[] = [];
  for (const event of [
    { type: 'textDelta', text: 'one' },
    { type: 'textDelta', text: ' two' },
    { type: 'toolUse', id: 'a', name: 'Read', input: '{}' },
    { type: 'toolUse', id: 'b', name: 'Bash', input: '{}' },
    { type: 'toolResult', toolUseId: 'a', text: 'done', isError: false },
  ] as const)
    items = applyTurnEvent(items, event);
  assert.equal(items[0].type === 'assistant' && items[0].text, 'one two');
  assert.equal(items[1].type === 'tool' && items[1].result, 'done');
  assert.equal(items[2].type === 'tool' && items[2].result, null);
});

test('assistant progress completes the earlier action group while the latest actions keep running', () => {
  const items = buildItems([
    message('u', 'user', 'start', { timestamp: '2026-01-01T00:00:00Z' }),
    message('t', 'thinking', 'plan'),
    message('a', 'assistant', 'first result', { timestamp: '2026-01-01T00:00:04Z' }),
    message('tool', 'tool_use', '{}', { toolUseId: 'read', toolName: 'Read' }),
  ]);
  const rows = buildRows(items, true);
  assert.deepEqual(
    rows.map((row) => row.type),
    ['user', 'group', 'assistant', 'group'],
  );
  assert.ok(rows[1].type === 'group' && rows[3].type === 'group');
  assert.equal(rows[1].isRunning, false);
  assert.equal(rows[1].durationMs, 4000);
  assert.equal(rows[3].isRunning, true);
});

test('a live group previews its latest five actions and expanding preserves all actions', () => {
  const items: Item[] = Array.from({ length: 9 }, (_, index) => ({
    type: 'tool',
    id: String(index),
    name: 'Read',
    input: '{}',
    result: null,
    isError: false,
    truncated: false,
  }));
  const [group] = buildRows(items, true);
  assert.ok(group.type === 'group');
  assert.deepEqual(
    visibleWorkItems(group).map((row) => row.id),
    ['4', '5', '6', '7', '8'],
  );
  assert.equal(visibleWorkItems(group, true).length, 9);
  assert.deepEqual(visibleWorkItems(group, false), []);
});

for (const count of [1, 8]) {
  test(`a manually collapsed ${count}-activity group stays hidden as new work arrives`, () => {
    const tools: Item[] = Array.from({ length: count }, (_, index) => ({
      type: 'tool',
      id: String(index),
      name: 'Read',
      input: '{}',
      result: null,
      isError: false,
      truncated: false,
    }));
    const [first] = buildRows(tools, true);
    const [updated] = buildRows([...tools, { ...tools[0], id: 'next' }], true);
    assert.ok(first.type === 'group' && updated.type === 'group');
    assert.equal(updated.id, first.id);
    assert.deepEqual(visibleWorkItems(first, false), []);
    assert.deepEqual(visibleWorkItems(updated, false), []);
    assert.equal(visibleWorkItems(updated, true).length, count + 1);
    assert.equal(visibleWorkItems(updated).length, Math.min(5, count + 1));
  });
}

test('completed progress nests action groups and leaves only the final reply outside', () => {
  const rows = buildRows(
    buildItems([
      message('u', 'user', 'start'),
      message('t', 'thinking', 'plan'),
      message('a', 'assistant', 'progress'),
      message('read', 'tool_use', '{}', { toolName: 'Read' }),
      message('final', 'assistant', 'final answer'),
    ]),
    false,
  );
  assert.deepEqual(
    rows.map((row) => row.type),
    ['user', 'group', 'assistant'],
  );
  assert.equal(rows.at(-1)?.id, 'final');
  assert.ok(rows[1].type === 'group');
  assert.equal(rows[1].isSummary, true);
  assert.deepEqual(
    rows[1].items.map((row) => row.type),
    ['group', 'assistant', 'group'],
  );
  assert.deepEqual(visibleWorkItems(rows[1], false), []);
});

test('empty thinking signatures do not create blank groups', () => {
  assert.deepEqual(
    buildRows(
      buildItems([message('signature', 'thinking', '  '), message('answer', 'assistant', 'done')]),
      false,
    ).map((row) => row.id),
    ['answer'],
  );
});

test('parallel tool completion keeps the remaining call in the running status', () => {
  let items: Item[] = [];
  for (const event of [
    { type: 'toolUse', id: 'a', name: 'Read', input: '{}' },
    { type: 'toolUse', id: 'b', name: 'Bash', input: '{}' },
    { type: 'toolResult', toolUseId: 'b', text: 'done', isError: false },
  ] as const)
    items = applyTurnEvent(items, event);
  assert.deepEqual(turnStatus(items, false), { key: 'statusCallingTool', toolName: 'Read' });
  assert.deepEqual(turnStatus(items, true), { key: 'statusAwaitingYou' });
  items = applyTurnEvent(items, { type: 'toolResult', toolUseId: 'a', text: 'done', isError: false });
  assert.deepEqual(turnStatus(items, false), { key: 'statusThinking' });
  items = applyTurnEvent(items, { type: 'textDelta', text: 'reply' });
  assert.deepEqual(turnStatus(items, false), { key: 'statusReplying' });
});
