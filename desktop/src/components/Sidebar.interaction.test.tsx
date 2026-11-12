import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sidebar, TaskRow } from './Sidebar';
import { CONVERSATION_CWD } from '../lib/items';
import { EMPTY_TASK_META } from '../lib/taskMeta';
import { recordTaskActivity, taskListWithPreviews } from '../lib/taskList';
import { formatAge } from '../lib/tools';

const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0 }));
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks.values[index], (next: unknown) => { hooks.values[index] = typeof next === 'function' ? next(hooks.values[index]) : next; }];
  },
  useRef: (initial: unknown) => hooks.values[hooks.cursor++] ??= { current: initial },
  useMemo: (compute: () => unknown) => compute(),
  useEffect: () => {},
}));
vi.mock('../lib/useSidebarDrag', () => ({ useSidebarDrag: () => ({ drag: null, startDrag() {}, onPointerDownCapture() {}, onClickCapture() {} }) }));
vi.hoisted(() => {
  vi.stubGlobal('navigator', { language: 'zh-CN' });
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { callback(); return 1; });
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => { hooks.values = []; hooks.cursor = 0; });

type Node = ReactElement<Record<string, any>>;
function nodes(value: ReactNode): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  return isValidElement<Record<string, any>>(value) ? [value, ...nodes(value.props.children)] : [];
}
function text(value: ReactNode): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(text).join('');
  return isValidElement<{ children?: ReactNode }>(value) ? text(value.props.children) : '';
}
function fixture(collapsedGroups: string[] = []) {
  const task = (id: string, cwd: string, agent: 'claude' | 'pi' = 'pi') => ({ id, cwd, agent, title: id, updatedAtMs: 0 });
  const props: Parameters<typeof Sidebar>[0] = {
    tasks: [task('alpha-pi', '/code/alpha'), task('alpha-claude', '/code/alpha', 'claude'), task('beta', '/code/beta'), task('chat', '/conversations/one')],
    loaded: true, selectedId: 'alpha-pi', running: new Set(['alpha-pi']), waiting: new Set(), unread: new Set(), external: new Map(), meta: EMPTY_TASK_META,
    extraProjects: ['/code/alpha', '/code/beta'], conversationRoots: ['/conversations'], projectOrder: [], pinnedProjects: [], collapsedGroups,
    options: { groupByCli: false, sort: 'time' }, width: 260, renamingId: null, menuAnchor: null, generatingTitles: new Set(), version: '0.1.0',
    onSelect() {}, onMetaChange() {}, onRenameDone() {}, onOpenMenu() {}, onGenerateTitle() {}, onProjectOrderChange() {}, onPinnedProjectsChange() {}, onWidthChange() {}, onNewTask() {}, onOpenSettings() {}, onCollapsedGroupsChange() {},
  };
  const save = vi.fn((keys: string[]) => { props.collapsedGroups = keys; });
  props.onCollapsedGroupsChange = save;
  const render = () => { hooks.cursor = 0; return nodes(Sidebar(props)); };
  const project = (cwd: string) => render().find((node) => node.type === 'button' && node.props['aria-expanded'] !== undefined && (cwd === CONVERSATION_CWD ? text(node.props.children) === '对话' : node.props['data-tooltip'] === cwd))!;
  const action = (label: string) => render().find((node) => node.type === 'button' && node.props['aria-label'] === label)!;
  const visible = () => render().filter((node) => node.type === TaskRow).map((node) => node.props.task.id);
  return { props, save, render, project, action, visible };
}

describe('sidebar activity refresh', () => {
  it('reorders the existing task and advances its age from the same activity timestamp', () => {
    const test = fixture();
    test.props.tasks = test.props.tasks.map((task) => ({ ...task, updatedAtMs: task.id === 'alpha-claude' ? 120000 : 60000 }));
    test.props.now = 180000;
    expect(test.visible().filter((id) => id.startsWith('alpha'))).toEqual(['alpha-claude', 'alpha-pi']);
    const activity = recordTaskActivity({}, 'alpha-pi', 240000);
    test.props.tasks = taskListWithPreviews(test.props.tasks, {}, activity);
    test.props.now = 241000;
    expect(test.visible().filter((id) => id.startsWith('alpha'))).toEqual(['alpha-pi', 'alpha-claude']);
    const row = () => test.render().find((node) => node.type === TaskRow && node.props.task.id === 'alpha-pi')!;
    expect(formatAge(row().props.task.updatedAtMs, row().props.now)).toBe('刚刚');
    test.props.now = 361000;
    expect(formatAge(row().props.task.updatedAtMs, row().props.now)).toBe('2 分钟');
    expect(test.save).not.toHaveBeenCalled();
    test.props.options.sort = 'type';
    expect(test.visible().filter((id) => id.startsWith('alpha'))).toEqual(['alpha-claude', 'alpha-pi']);
  });
});

describe('sidebar folder fold persistence', () => {
  it('saves individual choices and restores them after remount and task/status changes', () => {
    const test = fixture();
    test.project('/code/alpha').props.onClick();
    expect(test.save).toHaveBeenLastCalledWith(['/code/alpha']);
    expect(test.visible()).not.toContain('alpha-pi');
    hooks.values = []; hooks.cursor = 0;
    test.props.selectedId = 'beta';
    test.props.pinnedProjects = ['/code/alpha'];
    test.props.projectOrder = ['/code/beta', '/code/alpha'];
    test.props.unread.add('alpha-pi');
    expect(test.project('/code/alpha').props['aria-expanded']).toBe(false);
    expect(test.visible()).toContain('beta');
    test.project('/code/alpha').props.onClick();
    expect(test.save).toHaveBeenLastCalledWith([]);
    expect(test.visible()).toContain('alpha-pi');
  });
  it('remembers collapse-all and expands visible project groups without clearing hidden project choices', () => {
    const test = fixture(['/hidden', '/hidden:pi', '/code/alpha:pi']);
    test.action('全部收起').props.onClick();
    expect(test.props.collapsedGroups).toEqual(expect.arrayContaining(['/code/alpha', '/code/beta', CONVERSATION_CWD]));
    expect(test.visible()).toEqual([]);
    hooks.values = []; hooks.cursor = 0;
    expect(test.action('全部展开')).toBeDefined();
    test.action('全部展开').props.onClick();
    expect(test.props.collapsedGroups).toEqual(['/hidden', '/hidden:pi']);
    expect(test.visible()).toContain('alpha-pi');
  });
  it('temporarily shows matching tasks during search and restores the saved fold when search closes', () => {
    const test = fixture(['/code/alpha']);
    const search = test.render().find((node) => node.type === 'button' && text(node.props.children) === '搜索')!;
    search.props.onClick();
    const field = () => test.render().find((node) => node.type === 'input')!;
    field().props.onChange({ target: { value: 'alpha-pi' } });
    expect(test.project('/code/alpha').props['aria-expanded']).toBe(true);
    expect(test.visible()).toEqual(['alpha-pi']);
    expect(test.save).not.toHaveBeenCalled();
    field().props.onKeyDown({ key: 'Escape' });
    expect(test.project('/code/alpha').props['aria-expanded']).toBe(false);
    expect(test.visible()).not.toContain('alpha-pi');
    expect(test.props.collapsedGroups).toEqual(['/code/alpha']);
  });
  it('keeps a CLI fold while CLI grouping is switched off and back on', () => {
    const test = fixture(['/code/alpha:pi']);
    test.props.options.groupByCli = true;
    expect(test.visible()).not.toContain('alpha-pi');
    expect(test.visible()).toContain('alpha-claude');
    const pi = () => {
      const alpha = test.render().find((node) => node.type === 'section' && node.props['data-project'] === '/code/alpha')!;
      return nodes(alpha).find((node) => node.type === 'button' && text(node.props.children) === 'Pi')!;
    };
    pi().props.onClick();
    expect(test.props.collapsedGroups).toEqual([]);
    expect(test.visible()).toContain('alpha-pi');
    pi().props.onClick();
    test.props.options.groupByCli = false;
    expect(test.visible()).toContain('alpha-pi');
    test.props.options.groupByCli = true;
    expect(test.visible()).not.toContain('alpha-pi');
    expect(test.save).toHaveBeenCalledTimes(2);
  });
});
