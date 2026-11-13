import { afterAll, describe, expect, it, vi } from 'vitest';
import { questionAnswers } from './questionAnswers';
import { buildItems, buildRows, flattenRows, type ToolItem } from './items';
import { renderToStaticMarkup } from 'react-dom/server';
import { QuestionAnswer } from '../components/QuestionAnswer';

vi.hoisted(() => vi.stubGlobal('navigator', { language: 'zh-CN' }));
afterAll(() => vi.unstubAllGlobals());
const tool = (name: string, input: unknown, result: unknown): ToolItem => ({ type: 'tool', id: 'ask', name, input: JSON.stringify(input), result: typeof result === 'string' ? result : JSON.stringify(result), isError: false, truncated: false });

describe('answered question projection', () => {
  it('keeps Pi selected choices, custom answers and notes from native structured results', () => {
    const selected = tool('ask_user', { question: '选择环境？' }, { question: '选择环境？', response: { kind: 'selection', selections: ['生产', '预发'], comment: '先只读' }, cancelled: false });
    expect(questionAnswers(selected)).toEqual([{ question: '选择环境？', answers: ['生产', '预发', '先只读'], skipped: false }]);
    expect(questionAnswers(tool('ask_user', { question: '下一步？' }, { question: '下一步？', response: { kind: 'freeform', text: '自定义内容' } }))).toEqual([{ question: '下一步？', answers: ['自定义内容'], skipped: false }]);
    expect(questionAnswers(tool('ask_user', { question: '选一个' }, 'User answered: A'))).toEqual([{ question: '选一个', answers: ['A'], skipped: false }]);
  });
  it('supports Claude question-keyed and Codex id-keyed answers without inventing missing answers', () => {
    const input = { questions: [{ id: 'q1', question: '去哪？' }, { id: 'q2', question: '做什么？' }] };
    expect(questionAnswers(tool('AskUserQuestion', input, { answers: { '去哪？': '["A","B"]' } }))).toEqual([{ question: '去哪？', answers: ['A', 'B'], skipped: false }]);
    expect(questionAnswers(tool('request_user_input', input, { answers: { q2: { answers: ['检查'] } } }))).toEqual([{ question: '做什么？', answers: ['检查'], skipped: false }]);
    expect(questionAnswers(tool('AskUserQuestion', input, 'User has answered your questions: "去哪？"="A". You can now continue.'))).toEqual([{ question: '去哪？', answers: ['A'], skipped: false }]);
    expect(questionAnswers({ ...tool('ask_user', {}, ''), result: null })).toBeNull();
    expect(questionAnswers(tool('Bash', {}, 'User answered: A'))).toBeNull();
  });
  it('keeps cancellation as skipped and renders a compact Q/check record outside collapsed work', () => {
    const answered = tool('ask_user', { question: '环境分开吗？' }, { question: '环境分开吗？', response: { kind: 'selection', selections: ['是，四个环境'] } });
    const rows = buildRows([{ type: 'user', id: 'u', text: 'check' }, { type: 'thinking', id: 't', text: 'thinking' }, answered, { type: 'assistant', id: 'a', text: 'done' }], false);
    expect(rows.map((row) => row.type)).toEqual(['user', 'group', 'questionAnswer', 'assistant']);
    expect(flattenRows(rows).find((item) => item.id === 'ask')).toBe(answered);
    const pairs = questionAnswers(answered)!;
    const html = renderToStaticMarkup(<QuestionAnswer pairs={pairs} />);
    expect(html).toContain('环境分开吗？'); expect(html).toContain('是，四个环境'); expect(html).toContain('✓');
    expect(html).not.toContain('<details');
    const skipped = questionAnswers(tool('ask_user', { question: '下一步？' }, 'User cancelled the question'))!;
    expect(renderToStaticMarkup(<QuestionAnswer pairs={skipped} />)).toContain('已跳过');
  });
  it('preserves unanswered batch entries as skipped without turning malformed results into answers', () => {
    const batch = tool('ask_user', {}, { kind: 'batch', questions: [{ question: 'Q1' }, { question: 'Q2' }], answers: [{ status: 'answered', response: { kind: 'selection', selections: ['A'] } }, { status: 'skipped' }], cancelled: false });
    expect(questionAnswers(batch)).toEqual([{ question: 'Q1', answers: ['A'], skipped: false }, { question: 'Q2', answers: [], skipped: true }]);
    expect(questionAnswers(tool('ask_user', { question: 'Q' }, { arbitrary: true }))).toBeNull();
    expect(questionAnswers(tool('ask_user', { question: 'Q' }, 'broken JSON {'))).toBeNull();
  });

  it('survives rebuilding a live question tool from its native tool result', () => {
    const input = { question: '继续吗？' };
    const details = { question: '继续吗？', response: { kind: 'selection', selections: ['继续'] }, cancelled: false };
    const native = buildItems([
      { id: 'use', kind: 'tool_use', text: JSON.stringify(input), toolName: 'ask_user', toolUseId: 'ask', isError: false, truncated: false },
      { id: 'result', kind: 'tool_result', text: JSON.stringify(details), toolUseId: 'ask', isError: false, truncated: false },
    ]);
    expect(buildRows(native, false)[0].type).toBe('questionAnswer');
  });
});
