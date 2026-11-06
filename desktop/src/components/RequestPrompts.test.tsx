import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { PermissionPrompt } from './PermissionPrompt';
import { QuestionPrompt } from './QuestionPrompt';

vi.hoisted(() => vi.stubGlobal('navigator', { language: 'zh-CN' }));
afterAll(() => vi.unstubAllGlobals());

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
