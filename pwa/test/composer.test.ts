import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PREFERENCES,
  selectedModel,
  sentDraft,
  taskPreferences,
  turnOptions,
} from '../src/lib/composer.ts';
import type { ModelOption } from '../src/lib/types.ts';

const models: ModelOption[] = [
  {
    value: 'default',
    displayName: 'CLI default',
    resolvedModel: 'sonnet-4',
    description: '',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'high'],
    supportsAutoMode: true,
    defaultEffort: 'high',
  },
  {
    value: 'sonnet',
    displayName: 'Sonnet',
    resolvedModel: 'sonnet-4',
    description: '',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'high'],
    supportsAutoMode: true,
  },
  {
    value: 'fast',
    displayName: 'Fast',
    resolvedModel: 'fast-1',
    description: '',
    supportsEffort: false,
    supportedEffortLevels: [],
    supportsAutoMode: false,
  },
];

test('existing tasks restore native choices while a new task follows the CLI', () => {
  const taskA = taskPreferences({ model: 'sonnet-4', effort: 'low' }, 'acceptEdits');
  const taskB = taskPreferences({ model: 'fast-1', effort: null }, 'default');
  assert.deepEqual(taskA, { model: 'sonnet-4', effort: 'low', permission: 'acceptEdits' });
  assert.deepEqual(taskB, { model: 'fast-1', effort: '', permission: 'default' });
  assert.deepEqual(DEFAULT_PREFERENCES, { model: '', effort: '', permission: 'default' });
  assert.equal(selectedModel(taskA.model, models)?.value, 'sonnet');
  assert.equal(selectedModel(taskB.model, models)?.value, 'fast');
  assert.equal(selectedModel('', models)?.value, 'default');
});

test('missing history options use CLI defaults and preserve unknown native model ids', () => {
  assert.deepEqual(taskPreferences(null, 'plan'), DEFAULT_PREFERENCES);
  const native = taskPreferences({ model: 'private-model', effort: 'high' });
  assert.equal(selectedModel(native.model, models), undefined);
  assert.deepEqual(turnOptions('claude', native, models), {
    model: 'private-model',
    effort: 'high',
    permissionMode: null,
  });
});

test('unsupported effort and automatic approvals return to the model defaults before sending', () => {
  assert.deepEqual(turnOptions('codex', { model: 'fast', effort: 'high', permission: 'auto' }, models), {
    model: 'fast',
    effort: null,
    permissionMode: null,
  });
  assert.deepEqual(
    turnOptions('claude', { model: 'sonnet', effort: 'low', permission: 'acceptEdits' }, models),
    {
      model: 'sonnet',
      effort: 'low',
      permissionMode: 'acceptEdits',
    },
  );
  assert.deepEqual(
    turnOptions('pi', { model: 'sonnet', effort: 'low', permission: 'bypassPermissions' }, models),
    {
      model: 'sonnet',
      effort: 'low',
      permissionMode: null,
    },
  );
  assert.deepEqual(turnOptions('codex', DEFAULT_PREFERENCES, models), {
    model: null,
    effort: null,
    permissionMode: null,
  });
});

test('accepting a send clears only that task draft and preserves later edits and other tasks', () => {
  const drafts = { taskA: 'sent text', taskB: 'another task', new: 'new task' };
  assert.deepEqual(sentDraft(drafts, 'taskA', 'sent text'), { taskB: 'another task', new: 'new task' });
  assert.equal(drafts.taskA, 'sent text');
  const edited = { ...drafts, taskA: 'newer text' };
  assert.equal(sentDraft(edited, 'taskA', 'sent text'), edited);
});
