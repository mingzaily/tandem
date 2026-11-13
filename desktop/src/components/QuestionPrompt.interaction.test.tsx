import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Decision, PendingRequest, Question } from '../lib/api';
import { QuestionPrompt } from './QuestionPrompt';

const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0 }));
vi.mock('react', async (importOriginal) => {
  const original = await importOriginal<typeof import('react')>();
  return {
    ...original,
    useState: (initial: unknown) => {
      const index = hooks.cursor++;
      if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial;
      return [hooks.values[index], (value: unknown) => { hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value; }];
    },
    useRef: (initial: unknown) => {
      const index = hooks.cursor++;
      return hooks.values[index] ??= { current: initial };
    },
    useEffect: () => {},
  };
});
vi.hoisted(() => vi.stubGlobal('navigator', { language: 'zh-CN' }));
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => { hooks.cursor = 0; hooks.values = []; });

type Node = ReactElement<Record<string, any>>;
function nodes(value: ReactNode): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!isValidElement<Record<string, any>>(value)) return [];
  return [value, ...nodes(value.props.children)];
}
function text(value: ReactNode): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(text).join('');
  return isValidElement<{ children?: ReactNode }>(value) ? text(value.props.children) : '';
}
function fixture(question: Question = { question: '选一个', options: [{ label: '直接选择' }, { label: '另一项' }], allowCustom: true }) {
  const request: Extract<PendingRequest, { type: 'question' }> = {
    type: 'question', requestId: 'native-select', questions: [question],
  };
  const onAnswer = vi.fn<(decision: Decision) => void>();
  const render = (submitting = false) => {
    hooks.cursor = 0;
    const all = nodes(QuestionPrompt({ request, onAnswer, submitting }));
    return {
      button: (label: string) => all.find((node) => node.type === 'button' && text(node.props.children).includes(label)),
      input: all.find((node) => node.type === 'input'),
    };
  };
  return { onAnswer, render };
}

describe('question optional comment flow', () => {
  const question: Question = { question: '选一个', options: [{ label: 'A', description: '第一项的说明' }, { label: 'B' }], allowCustom: true, allowComment: true };
  it('keeps selection local, accepts an empty optional note and submits the original question key', () => {
    const test = fixture(question);
    test.render().button('A')!.props.onClick();
    expect(test.onAnswer).not.toHaveBeenCalled();
    expect(test.render().input!.props['aria-label']).toBe('备注（可选）');
    test.render().button('提交')!.props.onClick();
    expect(test.onAnswer).toHaveBeenCalledExactlyOnceWith({ kind: 'answer', answers: { 选一个: 'A' }, comment: '' });
  });
  it('submits the selected answer rather than cancelling when skipping an optional note', () => {
    const test = fixture(question);
    test.render().button('A')!.props.onClick();
    test.render().input!.props.onChange({ target: { value: '尚未确认的备注' } });
    test.render().button('不加备注')!.props.onClick();
    expect(test.onAnswer).toHaveBeenCalledExactlyOnceWith({ kind: 'answer', answers: { 选一个: 'A' }, comment: '' });
  });

  it('returns to choices, preserves the note draft and allows correcting the choice before submission', () => {
    const test = fixture(question);
    test.render().button('A')!.props.onClick();
    test.render().input!.props.onChange({ target: { value: '保留备注' } });
    test.render().button('返回选项')!.props.onClick();
    expect(test.render().input).toBeUndefined();
    test.render().button('B')!.props.onClick();
    expect(test.render().input!.props.value).toBe('保留备注');
    test.render().button('提交')!.props.onClick();
    expect(test.onAnswer).toHaveBeenCalledExactlyOnceWith({ kind: 'answer', answers: { 选一个: 'B' }, comment: '保留备注' });
  });
  it('allows an additional multi-select answer to pass through the note step once', () => {
    const test = fixture({ ...question, multiSelect: true });
    test.render().button('A')!.props.onClick();
    test.render().button('输入其他回答…')!.props.onClick();
    test.render().input!.props.onChange({ target: { value: '补充选项' } });
    test.render().button('提交')!.props.onClick();
    expect(test.onAnswer).not.toHaveBeenCalled();
    test.render().input!.props.onChange({ target: { value: '备注内容' } });
    test.render().button('提交')!.props.onClick();
    expect(test.onAnswer).toHaveBeenCalledExactlyOnceWith({ kind: 'answer', answers: { 选一个: 'A, 补充选项' }, comment: '备注内容' });
  });

  it('returns from notes with Escape while an input-method candidate Enter leaves the note intact', () => {
    const test = fixture(question);
    test.render().button('A')!.props.onClick();
    test.render().input!.props.onKeyDown({ key: 'Enter', nativeEvent: { isComposing: true }, preventDefault: vi.fn() });
    expect(test.onAnswer).not.toHaveBeenCalled();
    test.render().input!.props.onKeyDown({ key: 'Escape', nativeEvent: { isComposing: false }, preventDefault: vi.fn(), stopPropagation: vi.fn() });
    expect(test.render().input).toBeUndefined();
    expect(test.onAnswer).not.toHaveBeenCalled();
  });
});

describe('question custom-answer navigation', () => {
  it.each([false, true])('keeps the complete native question as the answer key with custom=%s', (custom) => {
    const original = '选择下一步？\n\nContext:\n当前改动已保存。';
    const test = fixture({ question: original, displayQuestion: '选择下一步？', context: '当前改动已保存。', options: [{ label: '直接选择' }], allowCustom: true });
    if (custom) {
      test.render().button('输入其他回答…')!.props.onClick();
      test.render().input!.props.onChange({ target: { value: '先运行验证' } });
      test.render().button('提交')!.props.onClick();
    } else test.render().button('直接选择')!.props.onClick();
    expect(test.onAnswer).toHaveBeenCalledExactlyOnceWith({ kind: 'answer', answers: { [original]: custom ? '先运行验证' : '直接选择' }, ...(custom ? { custom: true } : {}) });
  });

  it('keeps a draft local, returns to options, then sends the original selected value once', () => {
    const test = fixture();
    test.render().button('输入其他回答…')!.props.onClick();
    let page = test.render();
    expect(page.input).toBeDefined();
    page.input!.props.onChange({ target: { value: '保留的草稿' } });
    expect(test.onAnswer).not.toHaveBeenCalled();
    page = test.render();
    page.button('返回选项')!.props.onClick();
    page = test.render();
    expect(page.input).toBeUndefined();
    expect(test.onAnswer).not.toHaveBeenCalled();
    page.button('直接选择')!.props.onClick();
    expect(test.onAnswer).toHaveBeenCalledExactlyOnceWith({ kind: 'answer', answers: { 选一个: '直接选择' } });
  });

  it('preserves the custom draft across returning and submits it as a custom answer', () => {
    const test = fixture();
    test.render().button('输入其他回答…')!.props.onClick();
    test.render().input!.props.onChange({ target: { value: '我的中文回答' } });
    test.render().button('返回选项')!.props.onClick();
    test.render().button('输入其他回答…')!.props.onClick();
    expect(test.render().input!.props.value).toBe('我的中文回答');
    test.render().button('提交')!.props.onClick();
    expect(test.onAnswer).toHaveBeenCalledExactlyOnceWith({ kind: 'answer', answers: { 选一个: '我的中文回答' }, custom: true });
  });

  it('Escape returns from custom input, keeps the question unanswered and respects composition', () => {
    const test = fixture();
    test.render().button('输入其他回答…')!.props.onClick();
    const key = (isComposing: boolean) => ({ key: 'Escape', nativeEvent: { isComposing, keyCode: 27 }, preventDefault: vi.fn(), stopPropagation: vi.fn() });
    test.render().input!.props.onKeyDown(key(true));
    expect(test.render().input).toBeDefined();
    const escape = key(false);
    test.render().input!.props.onKeyDown(escape);
    expect(test.render().input).toBeUndefined();
    expect(escape.stopPropagation).toHaveBeenCalledOnce();
    expect(test.onAnswer).not.toHaveBeenCalled();
  });

  it('disables return and submit while the answer is being delivered', () => {
    const test = fixture();
    test.render().button('输入其他回答…')!.props.onClick();
    const page = test.render(true);
    expect(page.button('返回选项')!.props.disabled).toBe(true);
    expect(page.button('提交')!.props.disabled).toBe(true);
    expect(page.input!.props.disabled).toBe(true);
  });
});
