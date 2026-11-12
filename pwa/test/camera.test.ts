import test from 'node:test';
import assert from 'node:assert/strict';
import { canRetry, cameraProblem } from '../src/lib/camera.ts';

const secure = { secure: true, available: true };
const named = (name: string) => Object.assign(new Error(name), { name });

test('camera failures map to what the user can do next', () => {
  assert.equal(cameraProblem(named('NotAllowedError'), secure), 'denied');
  assert.equal(cameraProblem(named('NotFoundError'), secure), 'missing');
  assert.equal(cameraProblem(named('OverconstrainedError'), secure), 'missing');
  assert.equal(cameraProblem(named('NotReadableError'), secure), 'busy');
  assert.equal(cameraProblem(new Error('boom'), secure), 'failed');
  assert.equal(cameraProblem(undefined, secure), 'failed');
});

test('a page without HTTPS or camera support is explained before the browser error', () => {
  assert.equal(cameraProblem(named('NotAllowedError'), { secure: false, available: true }), 'insecure');
  assert.equal(cameraProblem(undefined, { secure: true, available: false }), 'insecure');
});

test('retry is offered only when something on this device can change', () => {
  assert.deepEqual(
    (['insecure', 'denied', 'missing', 'busy', 'failed'] as const).filter(canRetry),
    ['denied', 'busy', 'failed'],
  );
});
