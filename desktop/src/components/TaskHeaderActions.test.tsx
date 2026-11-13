import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { TaskHeaderActions } from './TaskHeaderActions';

vi.hoisted(() => vi.stubGlobal('navigator', { language: 'zh-CN' }));
afterAll(() => vi.unstubAllGlobals());
const task = { id: 'task', agent: 'pi' as const, cwd: '/project', title: 'Task', updatedAtMs: 0 };
const props: Parameters<typeof TaskHeaderActions>[0] = { task, generatingTitle: false, onGenerateTitle() {}, onOpenMenu() {}, onError() {} };
type Node = ReactElement<Record<string, any>>;
function nodes(value: ReactNode): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  return isValidElement<Record<string, any>>(value) ? [value, ...nodes(value.props.children)] : [];
}

describe('task header actions', () => {
  it('offers folder, resume copy and title generation without an ellipsis button', () => {
    const html = renderToStaticMarkup(<TaskHeaderActions {...props} />);
    expect(html).toContain('aria-label="在访达中显示项目"');
    expect(html).toContain('aria-label="复制终端续接命令"');
    expect(html).toContain('aria-label="生成标题"');
    expect(html).not.toContain('lucide-ellipsis');
    expect(html).not.toContain('aria-label="更多"');
    expect(html.match(/<button /g)).toHaveLength(3);
  });

  it('keeps generation visible, busy and disabled while the request and save are pending', () => {
    const html = renderToStaticMarkup(<TaskHeaderActions {...props} generatingTitle />);
    expect(html).toMatch(/aria-label="正在生成标题…"[^>]*aria-busy="true"[^>]*disabled=""/);
    expect(html).toContain('lucide-loader');
    expect(html).not.toContain('aria-label="生成标题"');
  });

  it('runs the existing generation handler from its dedicated action', () => {
    const generate = vi.fn();
    const tree = nodes(TaskHeaderActions({ ...props, onGenerateTitle: generate }));
    tree.find((node) => node.type === 'button' && node.props['aria-label'] === '生成标题')!.props.onClick();
    expect(generate).toHaveBeenCalledOnce();
  });

  it('retains right-click and keyboard context-menu access for the current task', () => {
    const open = vi.fn();
    const tree = TaskHeaderActions({ ...props, onOpenMenu: open });
    const pointer = { clientX: 140, clientY: 60, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    tree.props.onContextMenu(pointer);
    expect(pointer.preventDefault).toHaveBeenCalledOnce();
    expect(open).toHaveBeenLastCalledWith({ source: 'header', id: task.id, x: 140, y: 60 });
    const keyboard = { key: 'F10', shiftKey: true, nativeEvent: { isComposing: false }, preventDefault: vi.fn(), currentTarget: { getBoundingClientRect: () => ({ left: 100, bottom: 46 }) } };
    tree.props.onKeyDown(keyboard);
    expect(keyboard.preventDefault).toHaveBeenCalledOnce();
    expect(open).toHaveBeenLastCalledWith({ source: 'header', id: task.id, x: 100, y: 50 });
  });
});
