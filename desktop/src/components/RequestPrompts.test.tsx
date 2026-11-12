import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { PermissionPrompt } from './PermissionPrompt';
import { QuestionPrompt } from './QuestionPrompt';

vi.hoisted(() => vi.stubGlobal('navigator', { language: 'zh-CN' }));
afterAll(() => vi.unstubAllGlobals());

describe('question custom-answer entry', () => {
  it.each(['claude', 'codex'])('shows one custom entry without an input until selected for %s', () => {
    const html = renderToStaticMarkup(<QuestionPrompt request={{ type: 'question', requestId: 'r', questions: [{ question: 'Pick', options: [{ label: 'A' }, { label: 'B' }], allowCustom: true }] }} onAnswer={() => {}} />);
    expect(html).not.toContain('<input');
    expect(html.match(/输入其他回答…/g)).toHaveLength(1);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('>3</span>');
    expect(html).not.toContain('>4</span>');
  });

  it('keeps Pi native select choices and adds no second custom entry or input', () => {
    const html = renderToStaticMarkup(<QuestionPrompt request={{ type: 'question', requestId: 'r', questions: [{ question: 'Pick', options: [{ label: 'A' }, { label: 'B' }, { label: '✏️ Type custom response...' }], allowCustom: false }] }} onAnswer={() => {}} />);
    expect(html).toContain('✏️ Type custom response...');
    expect(html).not.toContain('输入其他回答…');
    expect(html).not.toContain('<input');
    expect(html).not.toContain('>4</span>');
  });

  it('renders normalized Pi freeform as one localized fourth entry while the native select remains pending', () => {
    const html = renderToStaticMarkup(<QuestionPrompt request={{ type: 'question', requestId: 'pi-native', questions: [{ question: '选择方式', options: [{ label: '一' }, { label: '二' }, { label: '三' }], allowCustom: true }] }} onAnswer={() => {}} />);
    expect(html.match(/输入其他回答…/g)).toHaveLength(1);
    expect(html).toContain('>4</span>');
    expect(html).not.toContain('Type custom response');
    expect(html).not.toContain('<input');
  });

  it('shows a pure free-text question directly and preserves its submit action', () => {
    const html = renderToStaticMarkup(<QuestionPrompt request={{ type: 'question', requestId: 'input', questions: [{ question: 'Your answer', options: [], allowCustom: true }] }} onAnswer={() => {}} />);
    expect(html).toMatch(/<input[^>]*aria-label="输入其他回答…"/);
    expect(html).not.toContain('aria-expanded=');
    expect(html).toContain('>提交</button>');
  });
});

describe('question background presentation', () => {
  it('renders the main question separately from the localized multiline background', () => {
    const question = '选择下一步？\n\nContext:\n已保存改动。\n请选验证范围。';
    const html = renderToStaticMarkup(<QuestionPrompt request={{ type: 'question', requestId: 'context', questions: [{ question, displayQuestion: '选择下一步？', context: '已保存改动。\n请选验证范围。', options: [{ label: '继续' }] }] }} onAnswer={() => {}} />);
    expect(html).toMatch(/<p[^>]*>选择下一步？<\/p>/);
    expect(html).toContain('背景说明');
    expect(html).toMatch(/<p[^>]*>已保存改动。\n请选验证范围。<\/p>/);
    expect(html).not.toContain('Context:');
  });
});

describe('answer submission keeps confirmation controls mounted', () => {
  it('keeps the permission and its scope visible while disabling every answer', () => {
    const html = renderToStaticMarkup(<PermissionPrompt submitting request={{ type: 'permissionRequest', requestId: 'r', toolName: 'Bash', input: '{"command":"pwd"}', description: null, rules: ['Bash(pwd)'] }} onAnswer={() => {}} />);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('pwd');
    expect(html.match(/disabled=""/g)).toHaveLength(3);
  });
  it('keeps a question available and freezes its controls during submission', () => {
    const html = renderToStaticMarkup(<QuestionPrompt submitting request={{ type: 'question', requestId: 'r', questions: [{ question: '继续吗？', options: [{ label: '继续' }] }] }} onAnswer={() => {}} />);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('继续吗？');
    expect(html.match(/disabled=""/g)).toHaveLength(4);
  });
});
