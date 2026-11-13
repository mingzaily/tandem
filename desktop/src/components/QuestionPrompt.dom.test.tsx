// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { QuestionPrompt } from './QuestionPrompt';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
vi.stubGlobal('navigator', { language: 'zh-CN' });
afterAll(() => vi.unstubAllGlobals());
afterEach(() => document.body.replaceChildren());

describe('question local note navigation in the DOM', () => {
  it('keeps descriptors, focuses notes and returns focus to the selected option even with freeform disabled', async () => {
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot(host);
    const answer = vi.fn();
    await act(async () => root.render(<QuestionPrompt request={{ type: 'question', requestId: 'note', questions: [{ question: '选择环境？', context: '先确认环境', allowCustom: false, allowComment: true, options: [{ label: '预发', description: '用脱敏数据验证' }, { label: '生产', description: '只读真实记录' }] }] }} onAnswer={answer} />));
    const button = (label: string) => [...host.querySelectorAll('button')].find((button) => button.textContent?.includes(label))!;
    expect(host.textContent).toContain('用脱敏数据验证');
    const choice = button('预发');
    await act(async () => choice.click());
    expect(answer).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain('Selected option');
    const input = host.querySelector('input')!;
    expect(document.activeElement).toBe(input);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '验证后再继续');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => button('返回选项').click());
    expect(button('预发').getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(button('预发'));
    await act(async () => button('生产').click());
    expect(host.querySelector('input')!.value).toBe('验证后再继续');
    await act(async () => button('不加备注').click());
    expect(answer).toHaveBeenCalledExactlyOnceWith({ kind: 'answer', answers: { '选择环境？': '生产' }, comment: '' });
    await act(async () => root.unmount());
  });
});
