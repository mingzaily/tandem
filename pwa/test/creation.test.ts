import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskCreation } from '../src/lib/creation.ts';
import type { RunEvent } from '../src/lib/live.ts';
import type { TaskSummary } from '../src/lib/types.ts';

const input = { agent: 'pi', cwd: '/work', prompt: 'new' } as const;
const task: TaskSummary = { id: 'task', agent: 'pi', cwd: '/work', title: 'new', updatedAtMs: 1 };
const started: RunEvent = {
  runId: 'new',
  taskId: 'task',
  agent: 'pi',
  prompt: 'new',
  startedAtMs: 1,
  elapsedMs: 0,
  seq: 1,
  event: { type: 'started', taskId: 'task' },
};

for (const early of [false, true]) {
  test(
    'a new task opens before native registration with started ' + (early ? 'before' : 'after') + ' reply',
    () => {
      const creation = new TaskCreation();
      creation.begin(input);
      if (early) creation.receive(started);
      creation.accept('new');
      if (!early) {
        assert.deepEqual(creation.resolve([]), {});
        creation.receive(started);
      }
      assert.deepEqual(
        creation.resolve([]),
        { task, readHistory: false },
        'live content and waiting cards do not depend on the native file',
      );
      assert.deepEqual(creation.resolve([{ ...task, title: 'Native title' }]), {
        task: { ...task, title: 'Native title' },
        readHistory: true,
      });
      creation.clear();
      assert.deepEqual(creation.resolve([task]), {}, 'leaving the creation view ends automatic navigation');
    },
  );
}

test('a snapshot can identify the task when the started frame preceded the connection', () => {
  const creation = new TaskCreation();
  creation.begin(input);
  creation.accept('new');
  creation.restore([{ ...started, prompt: 'new', events: [] }]);
  assert.deepEqual(creation.resolve([]), { task, readHistory: false });
});

test('an early startup failure survives reply ordering and ignores other turns', () => {
  const creation = new TaskCreation();
  creation.begin(input);
  creation.receive({
    ...started,
    taskId: null,
    event: { type: 'finished', isError: true, cancelled: false, message: 'CLI unavailable' },
  });
  creation.receive({ ...started, runId: 'other' });
  creation.accept('new');
  creation.receive({ ...started, runId: 'other' });
  assert.deepEqual(creation.resolve([task]), { error: 'CLI unavailable' });
});

test('a turn finished before navigation requests its native history', () => {
  const creation = new TaskCreation();
  creation.begin(input);
  creation.accept('new');
  creation.receive({
    ...started,
    event: { type: 'finished', isError: false, cancelled: false, message: null },
  });
  assert.deepEqual(creation.resolve([]), { task, readHistory: true });
});
