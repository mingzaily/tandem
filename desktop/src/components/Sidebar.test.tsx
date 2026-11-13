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
  onSelect: () => {}, onMetaChange: () => {}, onArchive: () => {}, onRenameDone: () => {}, onOpenMenu: () => {},
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
      projectOrder={[]} pinnedProjects={[]} onPinnedProjectsChange={() => {}} collapsedGroups={[]} onCollapsedGroupsChange={() => {}} options={{ groupByCli: false, sort: 'time' }}
      onProjectOrderChange={() => {}} width={260} renamingId={null} version="0.1.0" onWidthChange={() => {}}
      onNewTask={() => {}} onOpenSettings={() => {}} />);
    expect(html).toContain('刚发送的消息');
    expect(html).toContain('data-project="tandem:conversation"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('task-running');
    expect(html).not.toContain('aria-label="生成标题"');
  });
});

describe('saved sidebar folds', () => {
  const task = (id: string, cwd: string, agent: 'claude' | 'pi' = 'pi') => ({ id, cwd, title: `visible-${id}`, updatedAtMs: 0, agent });
  const render = (collapsedGroups: string[], groupByCli = false) => renderToStaticMarkup(<Sidebar {...props}
    tasks={[task('closed', '/code/closed'), task('open', '/code/open'), task('conversation', '/conversations/one'), task('cli-pi', '/code/cli'), task('cli-claude', '/code/cli', 'claude')]} loaded
    selectedId="closed" running={new Set(['closed'])} extraProjects={['/code/closed', '/code/open', '/code/cli']} conversationRoots={['/conversations']}
    projectOrder={[]} pinnedProjects={[]} onPinnedProjectsChange={() => {}} collapsedGroups={collapsedGroups} onCollapsedGroupsChange={() => {}} options={{ groupByCli, sort: 'time' }}
    onProjectOrderChange={() => {}} width={260} renamingId={null} version="0.1.0" onWidthChange={() => {}} onNewTask={() => {}} onOpenSettings={() => {}} />);
  it('restores closed projects and conversations while newly seen projects stay expanded', () => {
    const html = render(['/code/closed', 'tandem:conversation']);
    expect(html).not.toContain('visible-closed');
    expect(html).not.toContain('visible-conversation');
    expect(html).toContain('visible-open');
    expect(html).toMatch(/aria-expanded="false"[^>]*data-tooltip="\/code\/closed"/);
  });
  it('restores a CLI subgroup independently of its project and other agents', () => {
    const html = render(['/code/cli:pi'], true);
    expect(html).not.toContain('visible-cli-pi');
    expect(html).toContain('visible-cli-claude');
    expect(html).toMatch(/aria-expanded="true"[^>]*data-tooltip="\/code\/cli"/);
  });
});

describe('sidebar quick actions', () => {
  it('offers only pin and archive while title generation moves to the header', () => {
    const html = renderToStaticMarkup(<TaskRow {...props} />);
    expect(html).toContain('aria-label="置顶"');
    expect(html).toContain('aria-label="归档"');
    expect(html).not.toContain('aria-label="生成标题"');
    expect(html).not.toContain('aria-label="更多"');
    expect(html.match(/sidebar-task-action /g)).toHaveLength(2);
    expect(html).toContain('group-hover:pr-[54px]');
  });
  it('offers restore for an archived row and omits pinning', () => {
    const html = renderToStaticMarkup(<TaskRow {...props} meta={{ ...EMPTY_TASK_META, archived: ['task'] }} />);
    expect(html).not.toContain('aria-label="置顶"');
    expect(html).toContain('aria-label="取消归档"');
  });
  it('uses the same action surface on selected and ordinary rows', () => {
    for (const selectedId of [null, 'task']) {
      const html = renderToStaticMarkup(<TaskRow {...props} selectedId={selectedId} />);
      const action = html.match(/<button[^>]*aria-label="归档"[^>]*>/)![0];
      expect(action).toContain('enabled:hover:bg-[color-mix(in_srgb,currentColor_14%,transparent)]');
      expect(action).toContain('data-tooltip="归档"');
      expect(action).not.toContain(' title=');
    }
  });
  it('shows a finished unread task as a done dot in place of its time', () => {
    const html = renderToStaticMarkup(<TaskRow {...props} unread={new Set(['task'])} />);
    expect(html).toContain('aria-label="已完成，点击查看"');
    expect(html).toContain('bg-[var(--card-status-done)]');
    expect(html).not.toContain(`>${formatAge(0, 100)}<`);
    expect(renderToStaticMarkup(<TaskRow {...props} />)).toContain(`>${formatAge(0, 100)}<`);
  });
  it('keeps only the sidebar context target hovered, while the current task stays selected', () => {
    const context = renderToStaticMarkup(<TaskRow {...props} selectedId="another-task" menuAnchor={{ source: 'sidebar', id: 'task', x: 0, y: 0 }} />);
    expect(context).toContain('bg-[hsl(var(--sidebar-item-hover))]');
    expect(context).not.toContain('aria-current="page"');
    expect(context).not.toContain('aria-label="更多"');
    const header = renderToStaticMarkup(<TaskRow {...props} menuAnchor={{ source: 'header', id: 'task', x: 0, y: 0 }} />);
    expect(header).not.toContain('!pr-[54px]');
    const selected = renderToStaticMarkup(<TaskRow {...props} selectedId="task" menuAnchor={{ source: 'sidebar', id: 'another-task', x: 0, y: 0 }} />);
    expect(selected).toContain('aria-current="page"');
    expect(selected).toContain('bg-[hsl(var(--sidebar-item-active))]');
  });
});
