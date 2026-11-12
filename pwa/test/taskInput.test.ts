import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TaskInput } from '../src/TaskInput.tsx';
import { Prompt } from '../src/Prompt.tsx';
import type { PendingRequest } from '../src/lib/types.ts';

const permission: PendingRequest = {
  type: 'permissionRequest',
  requestId: 'permission',
  toolName: 'Bash',
  input: 'echo ready',
  description: null,
  rules: [],
};
const question: PendingRequest = {
  type: 'question',
  requestId: 'question',
  questions: [{ question: 'What next?', options: [{ label: 'Continue' }] }],
};

for (const request of [permission, question]) {
  test(`${request.type} keeps the task draft and a usable stop action below its card`, () => {
    const html = renderToStaticMarkup(
      createElement(TaskInput, {
        pending: [request],
        answeringDisabled: false,
        onAnswer: async () => {},
        composer: {
          agent: 'pi',
          value: 'draft waiting for later',
          creating: false,
          disabled: false,
          canSend: false,
          running: true,
          stopDisabled: false,
          onChange() {},
          onSend() {},
          onStop() {},
        },
      }),
    );
    assert.match(html, /<textarea[^>]*aria-label="发送消息"[^>]*>draft waiting for later<\/textarea>/);
    assert.match(html, /<button[^>]*aria-label="停止生成"[^>]*>/);
    assert.doesNotMatch(html.match(/<button[^>]*aria-label="停止生成"[^>]*>/)![0], /disabled/);
    assert.ok(html.indexOf('prompt-card') < html.indexOf('class="composer"'));
  });
}

test('select-only Pi dialogs keep their own third choice without a fourth text row', () => {
  const html = renderToStaticMarkup(
    createElement(Prompt, {
      request: {
        type: 'question',
        requestId: 'pi',
        questions: [
          {
            question: 'Pick',
            allowCustom: false,
            options: [{ label: 'A' }, { label: 'B' }, { label: '✏️ Type custom response...' }],
          },
        ],
      },
      disabled: false,
      onAnswer: async () => {},
    }),
  );
  assert.equal((html.match(/type="radio"/g) ?? []).length, 3);
  assert.doesNotMatch(html, /class="custom-answer"/);
  assert.doesNotMatch(html, />输入回答</);
});

test('normalized Pi custom choices use one localized entry before any input is submitted', () => {
  const html = renderToStaticMarkup(createElement(Prompt, {
    request: { type: 'question', requestId: 'pi', questions: [{ question: '选一个', allowCustom: true, options: [{ label: '一' }, { label: '二' }, { label: '三' }] }] },
    disabled: false, onAnswer: async () => {},
  }));
  assert.equal((html.match(/type="radio"/g) ?? []).length, 3);
  assert.match(html, />4<\/span>/);
  assert.match(html, /输入回答/);
  assert.doesNotMatch(html, /Type custom response/);
  assert.doesNotMatch(html, /class="custom-answer"/);
});

test('a host custom entry starts collapsed while pure input questions show their field directly', () => {
  const render = (options: { label: string }[]) =>
    renderToStaticMarkup(
      createElement(Prompt, {
        request: {
          type: 'question',
          requestId: 'text',
          questions: [{ question: 'Pick', allowCustom: true, options }],
        },
        disabled: false,
        onAnswer: async () => {},
      }),
    );
  assert.doesNotMatch(render([{ label: 'A' }, { label: 'B' }]), /class="custom-answer"/);
  assert.match(render([{ label: 'A' }, { label: 'B' }]), /aria-expanded="false"/);
  assert.match(render([]), /class="custom-answer"/);
});

test('question background is separate from its visible heading while its native answer key remains intact', () => {
  const original = '选择下一步？\n\nContext:\n已保存改动。\n请选验证范围。';
  const html = renderToStaticMarkup(createElement(Prompt, {
    request: { type: 'question', requestId: 'context', questions: [{ question: original, displayQuestion: '选择下一步？', context: '已保存改动。\n请选验证范围。', options: [{ label: '继续' }] }] },
    disabled: false, onAnswer: async () => {},
  }));
  assert.match(html, /<h3>选择下一步？<\/h3>/);
  assert.match(html, /背景说明/);
  assert.match(html, /<p>已保存改动。\n请选验证范围。<\/p>/);
  assert.ok(html.includes('name="' + original + '"'));
});

test('a read-only draft during recovery does not disable the independent stop action', () => {
  const html = renderToStaticMarkup(
    createElement(TaskInput, {
      pending: [permission],
      answeringDisabled: true,
      onAnswer: async () => {},
      composer: {
        agent: 'codex',
        value: 'saved',
        creating: false,
        disabled: true,
        canSend: false,
        running: true,
        stopDisabled: false,
        onChange() {},
        onSend() {},
        onStop() {},
      },
    }),
  );
  assert.match(html, /<fieldset disabled="">/);
  assert.match(html.match(/<textarea[^>]*>/)![0], /disabled/);
  assert.doesNotMatch(html.match(/<button[^>]*aria-label="停止生成"[^>]*>/)![0], /disabled/);
});
