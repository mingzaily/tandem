import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationItems } from '../src/lib/conversation.ts';
import type { Message, Run } from '../src/lib/types.ts';

const startedAtMs = Date.parse('2026-01-01T00:01:00Z');
const message = (id: string, kind: Message['kind'], text: string, extra: Partial<Message> = {}): Message => ({
  id,
  kind,
  text,
  isError: false,
  truncated: false,
  ...extra,
});
const run = (extra: Partial<Run> = {}): Run => ({
  runId: 'run-a',
  agent: 'pi',
  taskId: 'task',
  prompt: 'continue',
  startedAtMs,
  elapsedMs: 2000,
  events: [
    { type: 'started', taskId: 'task' },
    { type: 'textDelta', text: 'partial reply continued' },
  ],
  ...extra,
});

test('a failed snapshot merges its native error once even when there was no assistant text', () => {
  const items = conversationItems([message('u', 'user', 'continue'), message('err', 'assistant', 'provider failed', { isError: true })], [run({ events: [{ type: 'started', taskId: 'task' }, { type: 'finished', isError: true, cancelled: false, message: 'provider failed' }] })]);
  assert.deepEqual(items.map((item) => item.type), ['user', 'error']);
});

test('opening an active task replaces overlapping native output with its full live reply', () => {
  const items = conversationItems(
    [
      message('old-u', 'user', 'earlier'),
      message('old-a', 'assistant', 'earlier reply'),
      message('u', 'user', 'continue', { timestamp: '2026-01-01T00:01:01Z' }),
      message('a', 'assistant', 'partial reply'),
    ],
    [run()],
  );
  assert.deepEqual(
    items.flatMap((item) => (item.type === 'assistant' ? [item.text] : [])),
    ['earlier reply', 'partial reply continued'],
  );
  assert.equal(items.filter((item) => item.type === 'user').length, 2);
});

test('an earlier identical prompt and reply remain part of the history', () => {
  const history = [
    message('old-u', 'user', 'continue', { timestamp: '2026-01-01T00:00:00Z' }),
    message('old-a', 'assistant', 'partial reply'),
  ];
  const items = conversationItems(history, [run()]);
  assert.deepEqual(
    items.flatMap((item) => (item.type === 'assistant' ? [item.text] : [])),
    ['partial reply', 'partial reply continued'],
  );
  assert.equal(items.filter((item) => item.type === 'user').length, 2);
});

test('an earlier identical prompt with a different reply is kept when native timestamps are absent', () => {
  const items = conversationItems(
    [message('old-u', 'user', 'continue'), message('old-a', 'assistant', 'a different earlier answer')],
    [run()],
  );
  assert.deepEqual(
    items.flatMap((item) => (item.type === 'assistant' ? [item.text] : [])),
    ['a different earlier answer', 'partial reply continued'],
  );
});

test('image-only input stays ahead of a compaction marker with its host timestamp', () => {
  const items = conversationItems(
    [
      message('image', 'user', '', { image: 'omitted', timestamp: '2026-01-01T00:00:10Z' }),
      message('compact', 'compaction', ''),
    ],
    [],
  );
  assert.deepEqual(
    items.map((item) => item.type),
    ['user', 'compaction'],
  );
  assert.equal(items[0].at, Date.parse('2026-01-01T00:00:10Z'));
});

test('the matched prompt retains its image and attached file while tool details appear once', () => {
  const items = conversationItems(
    [
      message('image', 'user', '', { image: 'omitted', timestamp: '2026-01-01T00:01:01Z' }),
      message(
        'u',
        'user',
        'continue\n\nAttached file, readable with your tools even outside the workspace: /tmp/notes.txt',
      ),
      message('call', 'tool_use', '{}', { toolUseId: 'read', toolName: 'Read' }),
      message('result', 'tool_result', 'done', { toolUseId: 'read' }),
    ],
    [
      run({
        events: [
          { type: 'toolUse', id: 'read', name: 'Read', input: '{}' },
          { type: 'toolResult', toolUseId: 'read', text: 'done', isError: false },
        ],
      }),
    ],
  );
  const input = items.find((item) => item.type === 'user');
  assert.ok(input?.type === 'user');
  assert.deepEqual(input.images, ['omitted']);
  assert.equal(input.files?.[0].name, 'notes.txt');
  assert.equal(items.filter((item) => item.type === 'tool').length, 1);
});

test('a page starting within a live turn uses matching tool IDs to remove its mirrored prefix', () => {
  const items = conversationItems(
    [
      message('a', 'assistant', 'progress'),
      message('call', 'tool_use', '{}', { toolUseId: 'read', toolName: 'Read' }),
    ],
    [
      run({
        events: [
          { type: 'textDelta', text: 'progress' },
          { type: 'toolUse', id: 'read', name: 'Read', input: '{}' },
        ],
      }),
    ],
  );
  assert.equal(items.filter((item) => item.type === 'assistant').length, 1);
  assert.equal(items.filter((item) => item.type === 'tool').length, 1);
});

test('reading disk after a snapshot preserves text that has already grown beyond the live delta', () => {
  const items = conversationItems(
    [message('u', 'user', 'continue'), message('a', 'assistant', 'partial reply continued further')],
    [run()],
  );
  assert.deepEqual(
    items.flatMap((item) => (item.type === 'assistant' ? [item.text] : [])),
    ['partial reply continued further'],
  );
});

test('live row IDs stay unique across successive turns and finished output remains until reread', () => {
  const items = conversationItems(
    [],
    [
      run({
        events: [
          { type: 'textDelta', text: 'first' },
          { type: 'finished', isError: false, cancelled: false, message: null },
        ],
      }),
      run({ runId: 'run-b', startedAtMs: startedAtMs + 10000, prompt: 'next' }),
    ],
  );
  assert.equal(new Set(items.map((item) => item.id)).size, items.length);
  assert.deepEqual(
    items.flatMap((item) => (item.type === 'assistant' ? [item.text] : [])),
    ['first', 'partial reply continued'],
  );
});

test('optimistic input and its real run render a single user row despite phone clock skew', () => {
  const items = conversationItems(
    [message('prompt-run-a', 'user', 'continue', { timestamp: '2025-01-01T00:00:00Z' })],
    [run()],
  );
  assert.equal(items.filter((item) => item.type === 'user').length, 1);
});
