import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CodeBlock } from './CodeBlock';

const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, cleanup: null as (() => void) | null }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = initial;
    return [hooks.values[index], (value: unknown) => { hooks.values[index] = value; }];
  },
  useRef: (initial: unknown) => hooks.values[hooks.cursor++] ??= { current: initial },
  useEffect: (effect: () => () => void) => {
    if (!hooks.cleanup) hooks.cleanup = effect();
  },
}));
type Node = ReactElement<Record<string, any>>;
function nodes(value: ReactNode): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  return isValidElement<Record<string, any>>(value) ? [value, ...nodes(value.props.children)] : [];
}
let writeText: ReturnType<typeof vi.fn>;
beforeEach(() => {
  hooks.values = []; hooks.cursor = 0; hooks.cleanup = null;
  writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { language: 'zh-CN', clipboard: { writeText } });
  vi.useFakeTimers();
});
afterEach(() => { hooks.cleanup?.(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function fixture(text: string) {
  const pre = { textContent: text };
  const render = () => {
    hooks.cursor = 0;
    const tree = nodes(CodeBlock({ children: <code>{pre.textContent}</code> }));
    tree.find((node) => node.type === 'pre')!.props.ref.current = pre;
    return { button: tree.find((node) => node.type === 'button')!, status: tree.find((node) => node.type === 'span' && node.props.role)!, tree };
  };
  const click = async () => { render().button.props.onClick(); await Promise.resolve(); };
  return { pre, render, click };
}

describe('code block clipboard behavior', () => {
  it('copies code text exactly, including indentation, unicode, newlines and literal HTML', async () => {
    const code = '  const 示例 = "<script>";\n\tconsole.log(示例);\n';
    const test = fixture(code);
    await test.click();
    expect(writeText).toHaveBeenCalledExactlyOnceWith(code);
    expect(test.render().button.props['data-tooltip']).toBe('已复制');
    expect(test.render().tree.some((node) => node.type === Check)).toBe(true);
    vi.advanceTimersByTime(1500);
    expect(test.render().button.props['data-tooltip']).toBe('复制代码');
  });
  it('reads the latest streamed code again and restarts its success feedback timer', async () => {
    const test = fixture('initial\n');
    await test.click();
    vi.advanceTimersByTime(1000);
    test.pre.textContent = 'initial\n  streamed update\n';
    await test.click();
    expect(writeText).toHaveBeenLastCalledWith('initial\n  streamed update\n');
    vi.advanceTimersByTime(500);
    expect(test.render().button.props['data-tooltip']).toBe('已复制');
    vi.advanceTimersByTime(1000);
    expect(test.render().button.props['data-tooltip']).toBe('复制代码');
  });
  it('shows a recoverable failure and can copy successfully on the next click', async () => {
    writeText.mockRejectedValueOnce(new Error('clipboard unavailable'));
    const test = fixture('copy me\n');
    await test.click();
    expect(test.render().status.props.role).toBe('alert');
    expect(test.render().status.props.children).toBe('复制失败，请重试');
    expect(test.render().button.props.disabled).toBeUndefined();
    await test.click();
    expect(test.render().status.props.children).toBe('已复制');
  });
  it('keeps late clipboard completion from starting a timer after its block unmounts', async () => {
    let resolve!: () => void;
    writeText.mockReturnValueOnce(new Promise<void>((done) => { resolve = done; }));
    const test = fixture('code');
    test.render().button.props.onClick();
    hooks.cleanup?.();
    resolve();
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('releases its feedback timer when a virtualized code block unmounts', async () => {
    const test = fixture('code');
    await test.click();
    expect(vi.getTimerCount()).toBe(1);
    hooks.cleanup?.();
    expect(vi.getTimerCount()).toBe(0);
  });
});
