import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { TaskRow } from './Sidebar';
import { EMPTY_TASK_META } from '../lib/taskMeta';
import { formatAge } from '../lib/tools';

vi.hoisted(() => vi.stubGlobal('navigator', { language: 'zh-CN' }));
afterAll(() => vi.unstubAllGlobals());

const props: Parameters<typeof TaskRow>[0] = {
  task: { id: 'task', agent: 'codex', cwd: '/project', title: 'Task', updatedAtMs: 0 },
  selectedId: null, menuTaskId: null, running: new Set(), waiting: new Set(), unread: new Set(), external: new Map(), meta: EMPTY_TASK_META,
  now: 100, indented: true, isRenaming: false,
  onSelect: () => {}, onMetaChange: () => {}, onRenameDone: () => {}, onOpenMenu: () => {}, generatingTitles: new Set(), onGenerateTitle: () => {},
};

describe('sidebar quick actions', () => {
  it('keeps pinning available for active tasks and offers title generation for archived tasks', () => {
    expect(renderToStaticMarkup(<TaskRow {...props} />)).toContain('aria-label="置顶"');
    const archived = renderToStaticMarkup(<TaskRow {...props} meta={{ ...EMPTY_TASK_META, archived: ['task'] }} />);
    expect(archived).not.toContain('aria-label="置顶"');
    expect(archived).toContain('aria-label="生成标题"');
  });
  it('shows a finished unread task as a done dot in place of its time', () => {
    const html = renderToStaticMarkup(<TaskRow {...props} unread={new Set(['task'])} />);
    expect(html).toContain('aria-label="已完成，点击查看"');
    expect(html).toContain('bg-[var(--card-status-done)]');
    expect(html).not.toContain(`>${formatAge(0, 100)}<`);
    expect(renderToStaticMarkup(<TaskRow {...props} />)).toContain(`>${formatAge(0, 100)}<`);
  });
  it('keeps the menu target selected while its more button is pressed', () => {
    const html = renderToStaticMarkup(<TaskRow {...props} menuTaskId="task" />);
    expect(html).toContain('bg-[hsl(var(--sidebar-item-active))]');
    expect(html).toMatch(/aria-label="更多"[^>]*aria-pressed="true"/);
  });
});
