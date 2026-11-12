import test from 'node:test';
import assert from 'node:assert/strict';
import { filterTasks, groupTasks } from '../src/lib/tasks.ts';
import type { TaskSummary } from '../src/lib/types.ts';

const task = (id: string, cwd: string, updatedAtMs = 0): TaskSummary => ({
  id,
  cwd,
  updatedAtMs,
  title: id,
  agent: 'codex',
});

test('current and past conversation directories share one group with path boundaries', () => {
  const groups = groupTasks(
    [
      task('current', '/conversations/a', 1),
      task('past', '/old-conversations/b', 3),
      task('root', '/conversations', 2),
      task('separate', '/conversations-other/c', 4),
    ],
    ['tandem:conversation'],
    ['/conversations/', '/old-conversations'],
  );
  assert.deepEqual(
    groups.map(([cwd, tasks]) => [cwd, tasks.map((task) => task.id)]),
    [
      ['tandem:conversation', ['past', 'root', 'current']],
      ['/conversations-other/c', ['separate']],
    ],
  );
});

test('groups follow desktop project order and choose the most specific project', () => {
  const tasks = [task('a', '/a', 4), task('b', '/b/work', 1), task('nested', '/a/sub/work', 2)];
  const groups = groupTasks(tasks, ['/b', '/a/sub', '/empty', '/a', 'tandem:conversation'], []);
  assert.deepEqual(
    groups.map(([cwd]) => cwd),
    ['/b', '/a/sub', '/a'],
  );
  assert.deepEqual(
    groups[1][1].map((task) => task.id),
    ['nested'],
  );
  assert.deepEqual(
    tasks.map((task) => task.id),
    ['a', 'b', 'nested'],
  );
});

test('conversation classification takes precedence over a containing project', () => {
  assert.deepEqual(
    groupTasks(
      [task('chat', '/workspace/chats/a')],
      ['/workspace', 'tandem:conversation'],
      ['/workspace/chats'],
    ).map(([cwd]) => cwd),
    ['tandem:conversation'],
  );
});

test('local search matches titles, project paths and CLI names without changing task order', () => {
  const tasks = [task('Fix API', '/work/service', 3), task('Docs', '/notes', 2)];
  assert.deepEqual(filterTasks(tasks, ' API '), [tasks[0]]);
  assert.deepEqual(filterTasks(tasks, '/NOTES'), [tasks[1]]);
  assert.deepEqual(filterTasks(tasks, 'codex'), tasks);
  assert.deepEqual(filterTasks(tasks, 'missing'), []);
  assert.equal(filterTasks(tasks, '  '), tasks);
});
