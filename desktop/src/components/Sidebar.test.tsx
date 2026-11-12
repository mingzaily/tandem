import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { Sidebar, TaskRow } from './Sidebar';
import { EMPTY_TASK_META } from '../lib/taskMeta';
import { formatAge } from '../lib/tools';

vi.hoisted(() => vi.stubGlobal('navigator', { language: 'zh-CN' }));
afterAll(() => vi.unstubAllGlobals());

const props: Parameters<typeof TaskRow>[0] = {
  task: { id: 'task', agent: 'codex', cwd: '/project', title: 'Task', updatedAtMs: 0 },
  selectedId: null, menuAnchor: null, running: new Set(), waiting: new Set(), unread: new Set(), external: new Map(), meta: EMPTY_TASK_META,
  now: 100, depth: 1, isRenaming: false,
  onSelect: () => {}, onMetaChange: () => {}, onRenameDone: () => {}, onOpenMenu: () => {}, generatingTitles: new Set(), onGenerateTitle: () => {},
};

describe('started task rows', () => {
  it('shows a selected breathing row before native metadata without exposing file-dependent actions', () => {
    const html = renderToStaticMarkup(<TaskRow {...props} nativeReady={false} selectedId={props.task.id} running={new Set([props.task.id])} />);
    expect(html).toContain('Task');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('task-running');
    expect(html).toContain('aria-label="运行中"');
    expect(html).not.toContain('aria-label="生成标题"');
    expect(html).not.toContain('aria-label="更多"');
  });

  it('places a newly started conversation in its group while the native task list is still empty', () => {
    const task = { ...props.task, id: 'new-task', title: '刚发送的消息', cwd: '/conversations/new-task', updatedAtMs: Date.now() };
    const html = renderToStaticMarkup(<Sidebar {...props} tasks={[task]} pendingTaskIds={new Set([task.id])} loaded
      selectedId={task.id} running={new Set([task.id])} extraProjects={[]} conversationRoots={['/conversations']}
      projectOrder={[]} pinnedProjects={[]} onPinnedProjectsChange={() => {}} options={{ groupByCli: false, sort: 'time' }}
      onProjectOrderChange={() => {}} width={260} renamingId={null} version="0.1.0" onWidthChange={() => {}}
      onNewTask={() => {}} onOpenSettings={() => {}} />);
    expect(html).toContain('刚发送的消息');
    expect(html).toContain('data-project="tandem:conversation"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('task-running');
    expect(html).not.toContain('aria-label="生成标题"');
  });
});

describe('sidebar quick actions', () => {
  it('keeps pinning available for active tasks and offers title generation for archived tasks', () => {
    expect(renderToStaticMarkup(<TaskRow {...props} />)).toContain('aria-label="置顶"');
    const archived = renderToStaticMarkup(<TaskRow {...props} meta={{ ...EMPTY_TASK_META, archived: ['task'] }} />);
    expect(archived).not.toContain('aria-label="置顶"');
    expect(archived).toContain('aria-label="生成标题"');
  });
  it('marks only the task whose title is being generated as busy and disables its generation action', () => {
    const generating = renderToStaticMarkup(<TaskRow {...props} generatingTitles={new Set(['task'])} />);
    expect(generating).toMatch(/aria-label="正在生成标题…"[^>]*aria-busy="true"[^>]*disabled=""/);
    const idle = renderToStaticMarkup(<TaskRow {...props} generatingTitles={new Set(['another-task'])} />);
    expect(idle).toContain('aria-label="生成标题"');
    expect(idle).not.toContain('aria-busy="true"');
    expect(idle).not.toContain('disabled=""');
  });
  it('uses the same visible action surface on selected and ordinary rows and keeps loading highlighted', () => {
    for (const selectedId of [null, 'task']) {
      const html = renderToStaticMarkup(<TaskRow {...props} selectedId={selectedId} />);
      const action = html.match(/<button[^>]*aria-label="生成标题"[^>]*>/)![0];
      expect(action).toContain('enabled:hover:bg-[color-mix(in_srgb,currentColor_14%,transparent)]');
      expect(action).toContain('data-tooltip="生成标题"');
      expect(action).not.toContain(' title=');
      const loading = renderToStaticMarkup(<TaskRow {...props} selectedId={selectedId} generatingTitles={new Set(['task'])} />);
      expect(loading.match(/<button[^>]*aria-label="正在生成标题…"[^>]*>/)![0]).toContain(' bg-[color-mix(in_srgb,currentColor_14%,transparent)]');
    }
  });

  it('shows a finished unread task as a done dot in place of its time', () => {
    const html = renderToStaticMarkup(<TaskRow {...props} unread={new Set(['task'])} />);
    expect(html).toContain('aria-label="已完成，点击查看"');
    expect(html).toContain('bg-[var(--card-status-done)]');
    expect(html).not.toContain(`>${formatAge(0, 100)}<`);
    expect(renderToStaticMarkup(<TaskRow {...props} />)).toContain(`>${formatAge(0, 100)}<`);
  });
  it('keeps sidebar actions unpressed when the same task menu is opened from its header', () => {
    const html = renderToStaticMarkup(<TaskRow {...props} menuAnchor={{ source: 'header', id: 'task', x: 0, y: 0 }} />);
    expect(html).toMatch(/aria-label="更多"[^>]*aria-pressed="false"/);
    expect(html).not.toContain('bg-[hsl(var(--sidebar-item-active))]');
  });
  it('keeps the menu target hovered while its more button is pressed', () => {
    const html = renderToStaticMarkup(<TaskRow {...props} selectedId="another-task" menuAnchor={{ source: 'sidebar', id: 'task', x: 0, y: 0 }} />);
    expect(html).toContain('bg-[hsl(var(--sidebar-item-hover))]');
    expect(html).not.toContain('bg-[hsl(var(--sidebar-item-active))]');
    expect(html).not.toContain('aria-current="page"');
    expect(html).toMatch(/aria-label="更多"[^>]*aria-pressed="true"/);
  });
  it('keeps the current task selected when another task menu is open', () => {
    const html = renderToStaticMarkup(<TaskRow {...props} selectedId="task" menuAnchor={{ source: 'sidebar', id: 'another-task', x: 0, y: 0 }} />);
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('bg-[hsl(var(--sidebar-item-active))]');
    expect(html).toMatch(/aria-label="更多"[^>]*aria-pressed="false"/);
  });
});
