import test from 'node:test';
import assert from 'node:assert/strict';
import { appendTurnEvent } from '../src/lib/events.ts';
import { applyTurnEvent } from '../src/lib/items.ts';
import type { TurnEvent } from '../src/lib/types.ts';

test('long streaming replies retain text while keeping consecutive delta events compact', () => {
  let events: TurnEvent[] = [];
  for (let n = 0; n < 10000; n++) events = appendTurnEvent(events, { type: 'textDelta', text: '片段' });
  assert.deepEqual(events, [{ type: 'textDelta', text: '片段'.repeat(10000) }]);
});

test('thinking, text and tool boundaries retain their rendering order', () => {
  const input: TurnEvent[] = [
    { type: 'thinkingDelta', text: '先' }, { type: 'thinkingDelta', text: '想一想' },
    { type: 'textDelta', text: '正在' }, { type: 'textDelta', text: '读取' },
    { type: 'toolUse', id: 'read', name: 'Read', input: '{}' },
    { type: 'textDelta', text: '读取' }, { type: 'textDelta', text: '完成' },
  ];
  const compact = input.reduce(appendTurnEvent, []);
  assert.deepEqual(compact, [
    { type: 'thinkingDelta', text: '先想一想' },
    { type: 'textDelta', text: '正在读取' },
    input[4],
    { type: 'textDelta', text: '读取完成' },
  ]);
  assert.deepEqual(compact.reduce(applyTurnEvent, []), input.reduce(applyTurnEvent, []));
});

test('merging preserves prior React state and snapshot event objects', () => {
  const snapshot: TurnEvent[] = [{ type: 'thinkingDelta', text: '计划' }];
  const next = appendTurnEvent(snapshot, { type: 'thinkingDelta', text: '完成' });
  assert.deepEqual(snapshot, [{ type: 'thinkingDelta', text: '计划' }]);
  assert.deepEqual(next, [{ type: 'thinkingDelta', text: '计划完成' }]);
});
