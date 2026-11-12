import test from 'node:test';
import assert from 'node:assert/strict';
import { appendRunEvent, LiveSync, pendingRequests, type RunEvent } from '../src/lib/live.ts';
import type { Run } from '../src/lib/types.ts';

const event = (seq: number, extra: Partial<RunEvent> = {}): RunEvent => ({
  seq,
  runId: 'a',
  taskId: 'task',
  agent: 'codex',
  startedAtMs: 100,
  elapsedMs: 20,
  event: { type: 'textDelta', text: String(seq) },
  ...extra,
});
const run: Run = {
  runId: 'a',
  taskId: 'task',
  agent: 'codex',
  prompt: 'start',
  startedAtMs: 100,
  elapsedMs: 20,
  events: [],
};

test('a snapshot consumes earlier deltas and replays only events beyond its boundary', () => {
  const sync = new LiveSync();
  const epoch = sync.reset();
  assert.deepEqual(sync.receive(event(4)), []);
  assert.deepEqual(sync.receive(event(6)), []);
  assert.deepEqual(sync.restore(epoch, { seq: 5, runs: [run] }), [event(6)]);
  assert.deepEqual(sync.receive(event(6)), []);
  assert.deepEqual(sync.receive(event(7)), [event(7)]);
});

test('handshake-time events remain held when the snapshot request starts', () => {
  const sync = new LiveSync();
  sync.reset();
  sync.receive(event(2));
  const epoch = sync.begin();
  assert.deepEqual(sync.restore(epoch, { seq: 1, runs: [run] }), [event(2)]);
});

test('a turn that ends before the snapshot is replayed with its final failure', () => {
  const sync = new LiveSync();
  const epoch = sync.reset();
  const started = event(1, { prompt: 'start', event: { type: 'started', taskId: 'task' } });
  const finished = event(3, {
    prompt: 'start',
    event: { type: 'finished', isError: true, cancelled: false, message: 'failed' },
  });
  for (const update of [started, event(2), finished]) sync.receive(update);
  assert.deepEqual(sync.restore(epoch, { seq: 3, runs: [] }), [started, event(2), finished]);
});

test('a new connection accepts a restarted desktop sequence and rejects the old snapshot', () => {
  const sync = new LiveSync();
  const old = sync.reset();
  sync.restore(old, { seq: 900, runs: [run] });
  const current = sync.reset();
  sync.receive(event(1, { runId: 'new-host-run' }));
  assert.equal(sync.restore(old, { seq: 950, runs: [run] }), null);
  assert.deepEqual(sync.restore(current, { seq: 0, runs: [] }), [event(1, { runId: 'new-host-run' })]);
});

test('event metadata retains the original prompt and actual agent on another task', () => {
  let runs = appendRunEvent(
    [],
    event(1, { prompt: 'task input', agent: 'pi', event: { type: 'started', taskId: 'task' } }),
  );
  runs = appendRunEvent(runs, event(2, { agent: 'pi' }));
  assert.equal(runs[0].agent, 'pi');
  assert.equal(runs[0].prompt, 'task input');
  assert.equal(runs[0].events.length, 2);
});

test('requests are scoped to their run and a finished run releases all of its waiting cards', () => {
  const permission = {
    type: 'permissionRequest',
    requestId: 'same-id',
    toolName: 'Bash',
    input: '',
    description: null,
    rules: [],
  } as const;
  const request = { ...permission, rules: [] };
  const first: Run = { ...run, events: [request, { type: 'requestSettled', requestId: 'same-id' }] };
  const second: Run = { ...run, runId: 'b', events: [request] };
  assert.equal(pendingRequests([first, second]).length, 1);
  assert.equal(
    pendingRequests([
      { ...second, events: [request, { type: 'finished', isError: false, cancelled: true, message: null }] },
    ]).length,
    0,
  );
});
