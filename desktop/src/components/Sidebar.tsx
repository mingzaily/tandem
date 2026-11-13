import { Archive, ArchiveRestore, ChevronRight, ChevronsDownUp, ChevronsUpDown, CirclePlus, Folder, FolderOpen, GitBranch, GripVertical, MessagesSquare, Pin, PinOff, Plus, Search, Settings, SquareTerminal } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import iconUrl from '../assets/tandem-icon.svg';
import type { TaskSummary } from '../lib/api';
import { t } from '../lib/i18n';
import { CONVERSATION_CWD, groupRoot, isUnder, projectName, worktreeName } from '../lib/items';
import { isTaskArchived, renameTask, taskTitle, togglePin, type TaskMeta } from '../lib/taskMeta';
import { formatAge } from '../lib/tools';
import { advanceHold, CLI_ORDER, cliTaskGroups, moveSidebarProject, orderSidebarProjects, projectMoveRange, toggleProjectPin, type PriorityContext, type SidebarOptions } from '../lib/sidebarModel';
import { useSidebarDrag } from '../lib/useSidebarDrag';
import { AGENT_NAMES } from '../lib/modelRows';
import { FloatingMenu } from './FloatingMenu';
import { MENU_ROW } from './ComposerMenu';
import { AgentMark } from './AgentMark';
import type { TaskMenuAnchor } from './TaskMenu';
import { SidebarUpdate } from './AppUpdateControl';
import { isImeKey } from '../lib/ime';

const PREVIEW_COUNT = 5;
export const SIDEBAR_DEFAULT_WIDTH = 260;
const SIDEBAR_MIN_WIDTH = 180;
const SIDEBAR_MAX_WIDTH = 480;
const PILL_ROW =
  'flex h-8 w-full items-center gap-2.5 rounded-full text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]';
const DEPTH_PADDING = ['pl-3', 'pl-5', 'pl-7'] as const;
const SECTION_TITLE = 'flex h-8 items-center pl-3 text-sm leading-5 font-medium text-[var(--sidebar-list-muted)]';

interface SidebarProps {
  tasks: TaskSummary[];
  /** Shared minute clock; list activity and elapsed labels use the same snapshot. */
  now?: number;
  /** Started tasks whose native metadata has not arrived yet. */
  pendingTaskIds?: ReadonlySet<string>;
  loaded: boolean;
  selectedId: string | null;
  running: Set<string>;
  waiting: Set<string>;
  /** Finished while another task was open. */
  unread: Set<string>;
  /** Tasks open in another process, with whether each is working now. */
  external: Map<string, boolean>;
  meta: TaskMeta;
  extraProjects: string[];
  conversationRoots: string[];
  projectOrder: string[];
  pinnedProjects: string[];
  onPinnedProjectsChange: (paths: string[]) => void;
  collapsedGroups: string[];
  onCollapsedGroupsChange: (keys: string[]) => void;
  options: SidebarOptions;
  menuAnchor: TaskMenuAnchor | null;
  onProjectOrderChange: (order: string[]) => void;
  width: number;
  renamingId: string | null;
  version: string;
  onWidthChange: (width: number, isFinal: boolean) => void;
  onSelect: (id: string) => void;
  onNewTask: (cwd?: string) => void;
  onMetaChange: (meta: TaskMeta) => void;
  onArchive: (task: TaskSummary, archived: boolean) => void;
  archiving?: ReadonlySet<string>;
  onRenameDone: () => void;
  onOpenMenu: (anchor: TaskMenuAnchor) => void;
  onOpenSettings: () => void;
}

interface TaskRowProps extends Pick<SidebarProps, 'selectedId' | 'running' | 'waiting' | 'unread' | 'external' | 'meta' | 'onSelect' | 'onMetaChange' | 'onArchive' | 'archiving' | 'onRenameDone' | 'onOpenMenu' | 'menuAnchor'> {
  task: TaskSummary;
  /** 0 for top-level rows, then 8px more for each level, as in the reference's SessionItem. */
  depth: 0 | 1 | 2;
  now: number;
  isRenaming: boolean;
  nativeReady?: boolean;
}

function RenameField({ title, onDone }: { title: string; onDone: (title: string | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(title);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  return (
    <input
      ref={input}
      value={value}
      aria-label={t('taskRename')}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => onDone(value)}
      onKeyDown={(event) => {
        if (isImeKey(event)) return;
        if (event.key === 'Enter') onDone(value);
        if (event.key === 'Escape') onDone(null);
      }}
      className="selectable h-6 min-w-0 flex-1 rounded-md bg-[var(--sidebar-search-input-bg)] px-1.5 text-sm font-medium text-foreground outline-none"
    />
  );
}

export function TaskRow(props: TaskRowProps) {
  const { task, depth, now, isRenaming, nativeReady = true, selectedId, running, waiting, unread, external, meta, onSelect, onMetaChange, onArchive, archiving, onRenameDone, onOpenMenu, menuAnchor } = props;
  const menuOpen = menuAnchor?.source === 'sidebar' && task.id === menuAnchor.id;
  const showActions = menuOpen;
  // The badges, dot and time step aside together while the row shows its actions, as in the reference.
  const slotHidden = !nativeReady ? '' : showActions ? 'hidden' : 'group-focus-within:hidden group-hover:hidden';
  const active = task.id === selectedId;
  const isRunning = running.has(task.id) || external.get(task.id) === true;
  const isWaiting = waiting.has(task.id);
  const isArchived = isTaskArchived(meta, task);
  const status = isWaiting ? 'waiting' : unread.has(task.id) ? 'unread' : null;
  const worktree = worktreeName(task.cwd);
  const title = taskTitle(meta, task);
  const openMenuAt = (x: number, y: number) => onOpenMenu({ source: 'sidebar', id: task.id, x, y });
  return (
    <div
      className={`group relative rounded-full ${
        active
          ? 'bg-[hsl(var(--sidebar-item-active))] text-[var(--sidebar-item-active-foreground)]'
          : `text-foreground hover:bg-[hsl(var(--sidebar-item-hover))] ${menuOpen ? 'bg-[hsl(var(--sidebar-item-hover))]' : ''}`
      }`}
      onContextMenu={(event) => {
        if (isRenaming) return;
        event.preventDefault();
        if (nativeReady) openMenuAt(event.clientX, event.clientY);
      }}
      onKeyDown={(event) => {
        if (!nativeReady || isRenaming || isImeKey(event)) return;
        if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return;
        event.preventDefault();
        const bounds = event.currentTarget.getBoundingClientRect();
        openMenuAt(bounds.left, bounds.bottom + 4);
      }}
    >
      {isRenaming ? (
        <div className={`${PILL_ROW} ${DEPTH_PADDING[depth]} pr-2 font-medium`}>
          <span className="flex w-[15px] shrink-0 items-center justify-center">
            <AgentMark agent={task.agent} />
          </span>
          <RenameField
            title={title}
            onDone={(next) => {
              if (next !== null && next !== title) onMetaChange(renameTask(meta, task.id, next));
              onRenameDone();
            }}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onSelect(task.id)}
          aria-current={task.id === selectedId ? 'page' : undefined}
          className={`${PILL_ROW} ${DEPTH_PADDING[depth]} pr-2 text-left font-medium ${!nativeReady ? '' : showActions ? '!pr-[54px]' : 'group-hover:pr-[54px] group-focus-within:pr-[54px]'}`}
        >
          <span
            className={`flex w-[15px] shrink-0 items-center justify-center ${
              isRunning ? 'task-running text-[var(--status-bar-accent)]' : active ? '' : 'text-[hsl(var(--sidebar-muted))]'
            }`}
            {...(isRunning ? { role: 'img', 'aria-label': t('running') } : {})}
          >
            <AgentMark agent={task.agent} />
          </span>
          <span className="min-w-0 flex-1 truncate">{title || t('untitled')}</span>
          {worktree ? (
            <span data-tooltip={t('worktreeBadge', { name: worktree })} className={`shrink-0 text-[var(--sidebar-list-muted)] ${slotHidden}`}>
              <GitBranch size={12} strokeWidth={1.8} aria-label={t('worktreeBadge', { name: worktree })} />
            </span>
          ) : null}
          {external.has(task.id) ? (
            <span data-tooltip={t('writerBadge')} className={`shrink-0 text-[var(--sidebar-list-muted)] ${slotHidden}`}>
              <SquareTerminal size={12} strokeWidth={1.8} aria-label={t('writerBadge')} />
            </span>
          ) : null}
          {status ? (
            // The reference's right status: an 8px dot in place of the time, white on the selected row.
            <span
              role="img"
              aria-label={t(status === 'waiting' ? 'waitingForYou' : 'taskUnread')}
              data-tooltip={t(status === 'waiting' ? 'waitingForYou' : 'taskUnread')}
              className={`inline-flex size-4 shrink-0 items-center justify-center ${slotHidden}`}
            >
              <span
                aria-hidden
                className={`size-2 rounded-full ${
                  active ? 'bg-[var(--sidebar-item-active-foreground)]' : status === 'waiting' ? 'bg-[var(--card-status-awaiting)]' : 'bg-[var(--card-status-done)]'
                }`}
              />
            </span>
          ) : (
            <span
              className={`shrink-0 text-xs font-normal ${slotHidden} ${
                active ? 'text-[var(--sidebar-item-active-foreground)]' : 'text-[var(--text-tertiary)]'
              }`}
            >
              {formatAge(task.updatedAtMs, now)}
            </span>
          )}
        </button>
      )}
      {isRenaming || !nativeReady ? null : (
        <div className={`absolute right-1.5 top-1.5 flex items-center gap-0.5 ${showActions ? 'opacity-100' : 'pointer-events-none opacity-0 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100'}`}>
          {[
            ...(isArchived ? [] : [{ label: t(meta.pins.includes(task.id) ? 'taskUnpin' : 'taskPin'), icon: meta.pins.includes(task.id) ? PinOff : Pin, action: () => onMetaChange(togglePin(meta, task.id)) }]),
            { label: t(isArchived ? 'taskUnarchive' : 'taskArchive'), icon: isArchived ? ArchiveRestore : Archive, action: () => onArchive(task, !isArchived) },
          ].map(({ label, icon: Icon, action }) => <button key={label} type="button" aria-label={label} data-tooltip={label} disabled={archiving?.has(task.id)} aria-busy={archiving?.has(task.id) || undefined}
            onClick={action}
            className={`sidebar-task-action flex size-5 shrink-0 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] enabled:hover:bg-[color-mix(in_srgb,currentColor_14%,transparent)] ${active ? 'text-[var(--sidebar-item-active-foreground)]' : 'text-[hsl(var(--sidebar-action-icon))] enabled:hover:text-foreground'}`}>
            <Icon size={14} strokeWidth={2} aria-hidden />
          </button>)}
        </div>
      )}
    </div>
  );
}

export function Sidebar(props: SidebarProps) {
  const { tasks, loaded, selectedId, meta, extraProjects, conversationRoots, projectOrder, onProjectOrderChange, pinnedProjects, onPinnedProjectsChange, collapsedGroups, onCollapsedGroupsChange, options, width, renamingId, version, onWidthChange, onNewTask, onOpenSettings } = props;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const collapsed = useMemo(() => new Set(collapsedGroups), [collapsedGroups]);
  const [projectMenu, setProjectMenu] = useState<{ cwd: string; x: number; y: number } | null>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const searchInput = useRef<HTMLInputElement>(null);
  const nav = useRef<HTMLElement>(null);
  const now = props.now ?? Date.now();
  const holdState = useRef<{ viewed: string | null }>({ viewed: null });
  const holds = useRef({ held: new Map<string, number>(), leftAt: new Map<string, number>() });
  const priority: PriorityContext = {
    waiting: props.waiting, unread: props.unread, isRunning: (id) => props.running.has(id) || props.external.get(id) === true, ...holds.current,
  };
  advanceHold(holdState.current, selectedId, priority, now);
  const needle = query?.trim().toLowerCase() ?? '';

  const matches = (task: TaskSummary) =>
    !needle || `${taskTitle(meta, task)} ${task.cwd}`.toLowerCase().includes(needle);
  const pinned = useMemo(() => {
    const byId = new Map(tasks.map((task) => [task.id, task]));
    return meta.pins.flatMap((id) => { const task = byId.get(id); return task && !isTaskArchived(meta, task) ? [task] : []; });
  }, [tasks, meta]);

  // Tasks arrive newest first, so groups and their rows keep that order.
  const groups = useMemo(() => {
    const byRoot = new Map<string, TaskSummary[]>();
    for (const task of tasks) {
      if (isTaskArchived(meta, task) || meta.pins.includes(task.id)) continue;
      if (needle && !`${taskTitle(meta, task)} ${task.cwd}`.toLowerCase().includes(needle)) continue;
      const isConversation = conversationRoots.some((root) => isUnder(task.cwd, root));
      const root = isConversation ? CONVERSATION_CWD : groupRoot(task.cwd, extraProjects);
      const group = byRoot.get(root);
      if (group) group.push(task);
      else byRoot.set(root, [task]);
    }
    if (!needle) {
      for (const cwd of [...extraProjects, ...pinnedProjects]) if (!byRoot.has(cwd)) byRoot.set(cwd, []);
    }
    return orderSidebarProjects([...byRoot.entries()], projectOrder, pinnedProjects);
  }, [tasks, meta, needle, extraProjects, conversationRoots, projectOrder, pinnedProjects]);

  const projectIds = groups.map(([root]) => root);
  const reorderProject = (cwd: string, target: number) => {
    const next = moveSidebarProject(projectIds, projectOrder, pinnedProjects, cwd, target);
    if (!next) return;
    onProjectOrderChange(next);
    setAnnouncement(t('projectPosition', { project: projectName(cwd), index: String(next.indexOf(cwd) + 1) }));
  };
  const sorting = useSidebarDrag({
    ids: projectIds, pinned: pinnedProjects, scroller: nav, disabled: Boolean(needle) || Boolean(renamingId),
    version: JSON.stringify([projectIds, pinnedProjects, needle, width, [...collapsed], [...expanded], options.groupByCli, options.sort]),
    onMove: reorderProject,
  });
  const { drag } = sorting;

  const allCollapsed = groups.length > 0 && groups.every(([cwd]) => collapsed.has(cwd));
  const toggleCollapsed = (key: string) => onCollapsedGroupsChange(collapsed.has(key) ? collapsedGroups.filter((item) => item !== key) : [...collapsedGroups, key]);
  const toggleAll = () => {
    const keys = new Set(groups.flatMap(([cwd]) => [cwd, ...CLI_ORDER.map((agent) => `${cwd}:${agent}`)]));
    onCollapsedGroupsChange(allCollapsed ? collapsedGroups.filter((key) => !keys.has(key)) : [...new Set([...collapsedGroups, ...projectIds])]);
  };
  const toggle = (set: typeof setExpanded, cwd: string) =>
    set((current) => {
      const next = new Set(current);
      if (!next.delete(cwd)) next.add(cwd);
      return next;
    });

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const clamp = (value: number) => Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, value));
    const startX = event.clientX;
    const startWidth = width;
    const move = (moved: PointerEvent) => onWidthChange(clamp(startWidth + moved.clientX - startX), false);
    const up = (ended: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      onWidthChange(clamp(startWidth + ended.clientX - startX), true);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const row = (task: TaskSummary, depth: 0 | 1 | 2) => (
    <TaskRow key={task.id} {...props} task={task} depth={depth} now={now} isRenaming={renamingId === task.id} nativeReady={!props.pendingTaskIds?.has(task.id)} />
  );
  const visiblePinned = pinned.filter(matches);

  return (
    <aside style={{ width }} className="sidebar-surface relative flex shrink-0 flex-col border-r border-[var(--border-default)]">
      <div data-tauri-drag-region className="h-[46px] shrink-0" />
      <div className="flex shrink-0 flex-col gap-0.5 px-3 pb-3">
        <button
          type="button"
          onClick={() => onNewTask()}
          className={`${PILL_ROW} px-3 font-normal text-[var(--sidebar-nav-text)] hover:bg-[hsl(var(--sidebar-item-hover))]`}
        >
          <CirclePlus size={15} strokeWidth={1.8} aria-hidden className="shrink-0" />
          <span className="leading-none">{t('navNew')}</span>
        </button>
        {query === null ? (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              requestAnimationFrame(() => searchInput.current?.focus());
            }}
            className={`${PILL_ROW} px-3 font-normal text-[var(--sidebar-nav-text)] hover:bg-[hsl(var(--sidebar-item-hover))]`}
          >
            <Search size={15} strokeWidth={1.8} aria-hidden className="shrink-0" />
            <span className="leading-none">{t('search')}</span>
          </button>
        ) : (
          <label className={`${PILL_ROW} bg-[var(--sidebar-search-input-bg)] px-3`}>
            <Search size={15} strokeWidth={1.8} aria-hidden className="shrink-0 text-[var(--sidebar-nav-text)]" />
            <input
              ref={searchInput}
              value={query}
              aria-label={t('searchPlaceholder')}
              placeholder={t('searchPlaceholder')}
              onChange={(event) => setQuery(event.target.value)}
              onBlur={() => {
                if (!query) setQuery(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setQuery(null);
              }}
              className="selectable min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none"
            />
          </label>
        )}
      </div>
      <nav ref={nav} onPointerDownCapture={sorting.onPointerDownCapture} onClickCapture={sorting.onClickCapture} className="relative min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {visiblePinned.length > 0 ? (
          <section className="mb-3 flex flex-col gap-0.5" aria-label={t('pinned')}>
            <h2 className={SECTION_TITLE}>{t('pinned')}</h2>
            {visiblePinned.map((task) => row(task, 0))}
          </section>
        ) : null}
        {/* The reference's list header: a fold-all action that shows while the header is hovered. */}
        <div className="group/projects-header flex items-center justify-between pr-1">
          <h2 className={SECTION_TITLE}>{t('projects')}</h2>
          {groups.length > 0 && !needle ? (
            <button type="button" aria-label={t(allCollapsed ? 'projectsExpandAll' : 'projectsCollapseAll')} data-tooltip={t(allCollapsed ? 'projectsExpandAll' : 'projectsCollapseAll')}
              onClick={toggleAll}
              className="pointer-events-none flex size-7 items-center justify-center rounded-md text-[var(--sidebar-list-muted)] opacity-0 transition-[color,opacity] duration-[var(--motion-fast)] hover:text-[var(--sidebar-nav-text)] focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] group-hover/projects-header:pointer-events-auto group-hover/projects-header:opacity-100">
              {allCollapsed ? <ChevronsUpDown size={14} strokeWidth={2} aria-hidden /> : <ChevronsDownUp size={14} strokeWidth={2} aria-hidden />}
            </button>
          ) : null}
        </div>
        {loaded && groups.length === 0 ? (
          <p className="px-3 py-2 text-13 text-[hsl(var(--sidebar-muted))]">
            {needle ? t('noMatches') : t('noTasks')}
          </p>
        ) : null}
        {groups.map(([cwd, group], groupIndex) => {
          const range = projectMoveRange(projectIds, pinnedProjects, cwd);
          const canDrag = !needle && !renamingId && Boolean(range && range.min !== range.max);
          const isCollapsed = collapsed.has(cwd) && !needle;
          return (
            <section key={cwd} data-project={cwd}
              className={`relative flex flex-col gap-0.5 ${drag ? 'transition-transform duration-[var(--motion-fast)] ease-[var(--motion-ease-move)] motion-reduce:transition-none' : ''} ${drag?.cwd === cwd ? 'opacity-30' : ''}`}
              style={drag ? { transform: `translateY(${drag.offsets[groupIndex]}px)` } : undefined}>
              <div
                data-project-header
                onPointerDown={(event) => sorting.startDrag(event, cwd)}
                onContextMenu={(event) => { event.preventDefault(); if (cwd !== CONVERSATION_CWD) setProjectMenu({ cwd, x: event.clientX, y: event.clientY }); }}
                className="group group/project flex h-8 w-full touch-none items-center gap-2.5 rounded-full pl-3 pr-2 text-sm font-normal text-[var(--sidebar-list-muted)] hover:bg-[hsl(var(--sidebar-item-hover))]"
              >
                <button
                  type="button"
                  aria-expanded={!isCollapsed}
                  aria-keyshortcuts={canDrag ? 'Alt+ArrowUp Alt+ArrowDown Alt+Home Alt+End' : undefined}
                  data-tooltip={cwd === CONVERSATION_CWD ? undefined : cwd}
                  onClick={() => toggleCollapsed(cwd)}
                  onKeyDown={(event) => {
                    if (!event.altKey || !canDrag || isImeKey(event)) return;
                    if (event.key === 'ArrowUp') reorderProject(cwd, groupIndex - 1);
                    else if (event.key === 'ArrowDown') reorderProject(cwd, groupIndex + 1);
                    else if (event.key === 'Home') reorderProject(cwd, 0);
                    else if (event.key === 'End') reorderProject(cwd, groups.length - 1);
                    else return;
                    event.preventDefault();
                  }}
                  className="flex h-full min-w-0 flex-1 items-center gap-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                >
                  <span className="relative flex size-[15px] shrink-0 items-center justify-center">
                    {cwd === CONVERSATION_CWD ? <MessagesSquare size={15} strokeWidth={1.8} aria-hidden /> : (
                      <>
                        {isCollapsed ? <Folder size={15} strokeWidth={1.8} aria-hidden className={canDrag ? 'group-hover/project:opacity-0 group-focus-within/project:opacity-0' : undefined} />
                          : <FolderOpen size={15} strokeWidth={1.8} aria-hidden className={canDrag ? 'group-hover/project:opacity-0 group-focus-within/project:opacity-0' : undefined} />}
                        {canDrag ? <GripVertical size={12} strokeWidth={2} aria-hidden className="absolute opacity-0 group-hover/project:opacity-100 group-focus-within/project:opacity-100" /> : null}
                      </>
                    )}
                  </span>
                  <span className="min-w-0 truncate">{cwd === CONVERSATION_CWD ? t('conversations') : projectName(cwd)}</span>
                </button>
                {pinnedProjects.includes(cwd) ? <Pin size={12} aria-label={t('projectPinned')} className="shrink-0" /> : null}
                <button
                  type="button"
                  data-no-drag
                  aria-label={t('newTaskIn', { project: cwd === CONVERSATION_CWD ? t('conversations') : projectName(cwd) })}
                  data-tooltip={t('newTask')}
                  onClick={() => onNewTask(cwd)}
                  className="flex size-5 shrink-0 items-center justify-center rounded-md text-[hsl(var(--sidebar-action-icon))] opacity-0 hover:bg-[hsl(var(--sidebar-item-hover))] hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] group-hover:opacity-100"
                >
                  <Plus size={14} strokeWidth={2} aria-hidden />
                </button>
              </div>
              {isCollapsed ? null : cliTaskGroups(group, options, priority).map(({ agent, tasks: cliTasks }) => {
                const key = agent ? `${cwd}:${agent}` : cwd;
                const selectedHidden = cliTasks.findIndex((task) => task.id === selectedId) >= PREVIEW_COUNT;
                const showAll = expanded.has(key) || selectedHidden || Boolean(needle);
                const visible = showAll ? cliTasks : cliTasks.slice(0, PREVIEW_COUNT);
                const cliCollapsed = agent !== null && collapsed.has(key) && !needle;
                return <div key={key} className="flex flex-col gap-0.5">
                  {agent ? <button type="button" aria-expanded={!cliCollapsed} onClick={() => toggleCollapsed(key)}
                    className="flex h-7 items-center gap-1.5 rounded-full pl-5 pr-2 text-xs font-medium text-[var(--sidebar-list-muted)] transition-colors hover:text-[var(--sidebar-nav-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]">
                    {/* The reference's group header: mark, name, then the fold chevron; its tasks sit one level deeper. */}
                    <AgentMark agent={agent} size={12} />{AGENT_NAMES[agent]}<ChevronRight size={12} strokeWidth={2} aria-hidden className={cliCollapsed ? '' : 'rotate-90'} />
                  </button> : null}
                  {cliCollapsed ? null : visible.map((task) => row(task, agent ? 2 : 1))}
                  {!cliCollapsed && visible.length < cliTasks.length ? <button type="button" onClick={() => toggle(setExpanded, key)}
                    className={`${PILL_ROW} justify-center text-xs font-normal text-[var(--sidebar-list-muted)] hover:bg-[hsl(var(--sidebar-item-hover))]`}>
                    {t('showAll', { count: String(cliTasks.length) })}
                  </button> : null}
                </div>;
              })}
            </section>
          );
        })}
      </nav>
      <div className="mx-3 mb-3 flex h-[50px] shrink-0 items-center gap-2.5 rounded-xl border border-[var(--sidebar-user-card-border)] bg-[var(--sidebar-user-card-bg)] pl-2.5 pr-2">
        <img src={iconUrl} alt="" draggable={false} className="pointer-events-none size-7 shrink-0 select-none" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-13 font-medium leading-[1.3] text-[var(--sidebar-user-card-text)]">Tandem</span>
          <span className="flex min-w-0 items-center gap-1.5 text-11 leading-[1.3] text-[var(--sidebar-list-muted)]">
            <span className="truncate">{version}</span><SidebarUpdate />
          </span>
        </span>
        <button
          type="button"
          aria-label={t('settings')}
          data-tooltip={t('settings')}
          onClick={onOpenSettings}
          className="flex size-7 shrink-0 items-center justify-center rounded-full text-[var(--sidebar-user-card-text)] transition-colors hover:bg-[hsl(var(--sidebar-item-hover))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
        >
          <Settings size={15} strokeWidth={1.8} aria-hidden />
        </button>
      </div>
      {projectMenu ? <FloatingMenu x={projectMenu.x} y={projectMenu.y} width={224} label={t('projectMenu')} onClose={() => setProjectMenu(null)}>
        <button type="button" role="menuitem" className={MENU_ROW} onClick={() => { onPinnedProjectsChange(toggleProjectPin(pinnedProjects, projectMenu.cwd)); setProjectMenu(null); }}>
          {pinnedProjects.includes(projectMenu.cwd) ? <PinOff size={15} aria-hidden /> : <Pin size={15} aria-hidden />}{t(pinnedProjects.includes(projectMenu.cwd) ? 'projectUnpin' : 'projectPin')}
        </button>
      </FloatingMenu> : null}
      <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
      {drag ? createPortal(
        <div aria-hidden className="pointer-events-none fixed z-50 flex items-center gap-2.5 rounded-full bg-[hsl(var(--sidebar))] pl-3 pr-2 text-sm font-normal text-[var(--sidebar-list-muted)] shadow-[shadow:var(--shadow-menu)] ring-1 ring-inset ring-[var(--border-default)]"
          style={{ left: drag.left, top: drag.top, width: drag.width, height: drag.height }}>
          <span className="flex size-[15px] shrink-0 items-center justify-center"><GripVertical size={12} strokeWidth={2} /></span>
          <span className="min-w-0 flex-1 truncate">{projectName(drag.cwd)}</span>
          {pinnedProjects.includes(drag.cwd) ? <Pin size={12} className="shrink-0" /> : null}
          <span className="size-5 shrink-0" />
        </div>, document.body,
      ) : null}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t('resizeSidebar')}
        onPointerDown={startResize}
        onDoubleClick={() => onWidthChange(SIDEBAR_DEFAULT_WIDTH, true)}
        className="absolute -right-0.5 top-0 z-10 h-full w-1 cursor-col-resize"
      />
    </aside>
  );
}
