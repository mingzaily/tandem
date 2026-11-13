import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { questionAnswers } from '../src/lib/questionAnswers.ts';
import { buildRows, type ToolItem } from '../src/lib/items.ts';
import { QuestionAnswer } from '../src/QuestionAnswer.tsx';
import { Prompt } from '../src/Prompt.tsx';

const input = { question: '下一步？', context: '已保存更改', options: [{ title: '检查', description: '先运行检查' }] };
const tool: ToolItem = { type: 'tool', id: 'q', name: 'ask_user', input: JSON.stringify(input), result: JSON.stringify({ question: '下一步？', response: { kind: 'selection', selections: ['检查'], comment: '只读' }, cancelled: false }), isError: false, truncated: false };

test('mobile keeps the answered Q/check card outside completed work disclosures', () => {
  const rows = buildRows([{ type: 'user', id: 'u', text: 'check' }, tool, { type: 'assistant', id: 'a', text: 'done' }], false);
  assert.deepEqual(rows.map((row) => row.type), ['user', 'questionAnswer', 'assistant']);
  const html = renderToStaticMarkup(createElement(QuestionAnswer, { pairs: questionAnswers(tool)! }));
  assert.ok(html.includes('下一步？'));
  assert.ok(html.includes('检查\n只读'));
  assert.ok(html.includes('✓'));
  assert.doesNotMatch(html, /<details|<button/);
});

test('cancelled questions stay skipped while generic tools never become answered questions', () => {
  const skipped = questionAnswers({ ...tool, result: 'User cancelled the question' })!;
  assert.equal(skipped[0].skipped, true);
  assert.ok(renderToStaticMarkup(createElement(QuestionAnswer, { pairs: skipped })).includes('已跳过'));
  assert.equal(questionAnswers({ ...tool, result: null }), null);
  assert.equal(questionAnswers({ ...tool, name: 'Bash' }), null);
});

test('mobile comment-capable questions retain native descriptions before local selection', () => {
  const html = renderToStaticMarkup(createElement(Prompt, {
    request: { type: 'question', requestId: 'q', questions: [{ question: '下一步？', options: [{ label: '检查', description: '先运行检查' }], allowComment: true }] },
    disabled: false, onAnswer: async () => {},
  }));
  assert.ok(html.includes('先运行检查'));
  assert.doesNotMatch(html, /Selected option/);
});
