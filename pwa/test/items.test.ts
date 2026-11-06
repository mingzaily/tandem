import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTurnEvent, buildItems, buildRows, type Item } from '../src/lib/items.ts';
import type { Message } from '../src/lib/types.ts';
const message = (id: string, kind: Message['kind'], text = '', extra: Partial<Message> = {}): Message => ({
  id,
  kind,
  text,
  isError: false,
  truncated: false,
  ...extra,
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
  assert.deepEqual(
    buildRows(items, true).map((r) => r.type),
    ['user', 'group', 'assistant', 'compaction', 'notice', 'user', 'thinking'],
  );
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
