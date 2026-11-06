import { Archive, ChevronRight, CirclePlus, Folder, FolderOpen, GitBranch, MessagesSquare, MoreHorizontal, Plus, Search, Settings, SquareTerminal } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import iconUrl from '../assets/tandem-icon.svg';
import type { TaskSummary } from '../lib/api';
import { t } from '../lib/i18n';
import { CONVERSATION_CWD, groupRoot, isUnder, moveProject, orderProjects, projectName, worktreeName } from '../lib/items';
import { renameTask, taskTitle, type TaskMeta } from '../lib/taskMeta';
import { formatAge } from '../lib/tools';
import { AgentMark } from './AgentMark';
import type { TaskMenuAnchor } from './TaskMenu';

const PREVIEW_COUNT = 5;
export const SIDEBAR_DEFAULT_WIDTH = 260;
const SIDEBAR_MIN_WIDTH = 180;
const SIDEBAR_MAX_WIDTH = 480;
const PILL_ROW =
  'flex h-8 w-full items-center gap-2.5 rounded-full text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]';
const DRAG_THRESHOLD_PX = 4;
const AUTOSCROLL_ZONE_PX = 32;
const AUTOSCROLL_STEP_PX = 6;
const SECTION_TITLE = 'flex h-8 items-center pl-3 text-xs font-normal text-[var(--sidebar-list-muted)]';

interface SidebarProps {
  tasks: TaskSummary[];
  loaded: boolean;
  selectedId: string | null;
  running: Set<string>;
  waiting: Set<string>;
  /** Tasks open in another process, with whether each is working now. */
  external: Map<string, boolean>;
  meta: TaskMeta;
  extraProjects: string[];
  conversationRoots: string[];
  projectOrder: string[];
  onProjectOrderChange: (order: string[]) => void;
  width: number;
  renamingId: string | null;
  version: string;
  onWidthChange: (width: number, isFinal: boolean) => void;
  onSelect: (id: string) => void;
  onNewTask: (cwd?: string) => void;
  onMetaChange: (meta: TaskMeta) => void;
  onRenameDone: () => void;
  onOpenMenu: (anchor: TaskMenuAnchor) => void;
  onOpenSettings: () => void;
}

interface TaskRowProps extends Pick<SidebarProps, 'selectedId' | 'running' | 'waiting' | 'external' | 'meta' | 'onSelect' | 'onMetaChange' | 'onRenameDone' | 'onOpenMenu'> {
  task: TaskSummary;
  indented: boolean;
  now: number;
  isRenaming: boolean;
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
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Enter') onDone(value);
        if (event.key === 'Escape') onDone(null);
      }}
      className="selectable h-6 min-w-0 flex-1 rounded-md bg-[var(--sidebar-search-input-bg)] px-1.5 text-sm font-medium text-foreground outline-none"
    />
  );
}

function TaskRow(props: TaskRowProps) {
  const { task, indented, now, isRenaming, selectedId, running, waiting, external, meta, onSelect, onMetaChange, onRenameDone, onOpenMenu } = props;
  const active = task.id === selectedId;
  const isRunning = running.has(task.id) || external.get(task.id) === true;
  const isWaiting = waiting.has(task.id);
  const worktree = worktreeName(task.cwd);
  const title = taskTitle(meta, task);
  const openMenuAt = (x: number, y: number) => onOpenMenu({ id: task.id, x, y });
  return (
    <div
      className={`group relative rounded-full ${
        active
          ? 'bg-[hsl(var(--sidebar-item-active))] text-[var(--sidebar-item-active-foreground)]'
          : 'text-foreground hover:bg-[hsl(var(--sidebar-item-hover))]'
      }`}
      onContextMenu={(event) => {
        event.preventDefault();
        openMenuAt(event.clientX, event.clientY);
      }}
    >
      {isRenaming ? (
        <div className={`${PILL_ROW} ${indented ? 'pl-5' : 'pl-3'} pr-2 font-medium`}>
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
          aria-current={active ? 'page' : undefined}
          className={`${PILL_ROW} ${indented ? 'pl-5' : 'pl-3'} pr-2 text-left font-medium`}
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
            <span title={t('worktreeBadge', { name: worktree })} className="shrink-0 text-[var(--sidebar-list-muted)]">
              <GitBranch size={12} strokeWidth={1.8} aria-label={t('worktreeBadge', { name: worktree })} />
            </span>
          ) : null}
          {external.has(task.id) ? (
            <span title={t('writerBadge')} className="shrink-0 text-[var(--sidebar-list-muted)]">
              <SquareTerminal size={12} strokeWidth={1.8} aria-label={t('writerBadge')} />
            </span>
          ) : null}
          {isWaiting ? (
            <span
              role="img"
              aria-label={t('waitingForYou')}
              title={t('waitingForYou')}
              className="size-1.5 shrink-0 rounded-full bg-[var(--card-status-awaiting)]"
            />
          ) : null}
          <span
            className={`shrink-0 text-xs font-normal group-focus-within:invisible group-hover:invisible ${
              active ? 'text-[var(--sidebar-item-active-foreground)]' : 'text-[var(--text-tertiary)]'
            }`}
          >
            {formatAge(task.updatedAtMs, now)}
          </span>
        </button>
      )}
      {isRenaming ? null : (
        <button
          type="button"
          aria-label={t('taskMenu')}
          title={t('taskMenu')}
          onClick={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            openMenuAt(bounds.left, bounds.bottom + 4);
          }}
          className="absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded-md opacity-0 hover:bg-[var(--surface-hover)] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] group-focus-within:opacity-100 group-hover:opacity-100"
        >
          <MoreHorizontal size={14} aria-hidden />
        </button>
      )}
    </div>
  );
}

export function Sidebar(props: SidebarProps) {
  const { tasks, loaded, selectedId, meta, extraProjects, conversationRoots, projectOrder, onProjectOrderChange, width, renamingId, version, onWidthChange, onNewTask, onOpenSettings } = props;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ cwd: string; y: number; dropAt: number } | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const nav = useRef<HTMLElement>(null);
  const now = Date.now();
  const needle = query?.trim().toLowerCase() ?? '';

  const matches = (task: TaskSummary) =>
    !needle || `${taskTitle(meta, task)} ${task.cwd}`.toLowerCase().includes(needle);
  const pinned = useMemo(() => {
    const byId = new Map(tasks.map((task) => [task.id, task]));
    return meta.pins.flatMap((id) => byId.get(id) ?? []);
  }, [tasks, meta.pins]);
  const archivedTasks = useMemo(() => tasks.filter((task) => meta.archived.includes(task.id)), [tasks, meta.archived]);

  // Tasks arrive newest first, so groups and their rows keep that order.
  const groups = useMemo(() => {
    const byRoot = new Map<string, TaskSummary[]>();
    for (const task of tasks) {
      if (meta.archived.includes(task.id) || meta.pins.includes(task.id)) continue;
      if (needle && !`${taskTitle(meta, task)} ${task.cwd}`.toLowerCase().includes(needle)) continue;
      const isConversation = conversationRoots.some((root) => isUnder(task.cwd, root));
      const root = isConversation ? CONVERSATION_CWD : groupRoot(task.cwd, extraProjects);
      const group = byRoot.get(root);
      if (group) group.push(task);
      else byRoot.set(root, [task]);
    }
    if (!needle) {
      for (const cwd of extraProjects) if (!byRoot.has(cwd)) byRoot.set(cwd, []);
    }
    return orderProjects([...byRoot.entries()], projectOrder);
  }, [tasks, meta, needle, extraProjects, conversationRoots, projectOrder]);

  const reorderProject = (cwd: string, to: number) => {
    const shown = groups.map(([root]) => root);
    const next = moveProject(shown, cwd, to);
    // A project with nothing to show right now keeps its saved place for when it comes back.
    const merged = [...next, ...projectOrder.filter((root) => !shown.includes(root))];
    onProjectOrderChange(merged);
  };

  const startProjectDrag = (event: ReactPointerEvent<HTMLElement>, cwd: string) => {
    if (event.button !== 0 || needle || groups.length < 2) return;
    if ((event.target as HTMLElement).closest('[data-no-drag]')) return;
    const startY = event.clientY;
    let y = startY;
    let isActive = false;
    let dropAt = -1;
    let frame = 0;

    const measure = () => {
      const sections = [...(nav.current?.querySelectorAll('[data-project]') ?? [])];
      const found = sections.findIndex((section) => {
        const bounds = section.getBoundingClientRect();
        return y < bounds.top + bounds.height / 2;
      });
      dropAt = found < 0 ? sections.length : found;
      setDrag({ cwd, y, dropAt });
    };
    const scroll = () => {
      const element = nav.current;
      if (!element) return;
      const bounds = element.getBoundingClientRect();
      if (y < bounds.top + AUTOSCROLL_ZONE_PX) element.scrollTop -= AUTOSCROLL_STEP_PX;
      else if (y > bounds.bottom - AUTOSCROLL_ZONE_PX) element.scrollTop += AUTOSCROLL_STEP_PX;
      measure();
      frame = requestAnimationFrame(scroll);
    };
    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key);
      cancelAnimationFrame(frame);
      document.body.style.cursor = '';
      setDrag(null);
    };
    const move = (moved: PointerEvent) => {
      y = moved.clientY;
      if (!isActive && Math.abs(y - startY) < DRAG_THRESHOLD_PX) return;
      if (!isActive) {
        isActive = true;
        document.body.style.cursor = 'grabbing';
        frame = requestAnimationFrame(scroll);
      }
      measure();
    };
    const up = () => {
      const wasActive = isActive;
      finish();
      if (!wasActive) return;
      reorderProject(cwd, dropAt);
      // The release must not also count as a click that folds the project.
      const swallow = (click: MouseEvent) => {
        click.stopPropagation();
        click.preventDefault();
      };
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, true), 50);
    };
    const cancel = () => finish();
    const key = (pressed: KeyboardEvent) => {
      if (pressed.key === 'Escape') finish();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key);
  };

  const toggle = (set: typeof setCollapsed, cwd: string) =>
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

  const row = (task: TaskSummary, indented: boolean) => (
    <TaskRow key={task.id} {...props} task={task} indented={indented} now={now} isRenaming={renamingId === task.id} />
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
      <nav ref={nav} className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {visiblePinned.length > 0 ? (
          <section className="mb-3 flex flex-col gap-0.5" aria-label={t('pinned')}>
            <h2 className={SECTION_TITLE}>{t('pinned')}</h2>
            {visiblePinned.map((task) => row(task, false))}
          </section>
        ) : null}
        <h2 className={SECTION_TITLE}>{t('projects')}</h2>
        {loaded && groups.length === 0 ? (
          <p className="px-3 py-2 text-13 text-[hsl(var(--sidebar-muted))]">
            {needle ? t('noMatches') : t('noTasks')}
          </p>
        ) : null}
        {groups.map(([cwd, group], groupIndex) => {
          const dragFrom = drag ? groups.findIndex(([root]) => root === drag.cwd) : -1;
          const isNoOpDrop = !drag || drag.dropAt === dragFrom || drag.dropAt === dragFrom + 1;
          const isCollapsed = collapsed.has(cwd) && !needle;
          const selectedHidden = group.findIndex((task) => task.id === selectedId) >= PREVIEW_COUNT;
          const showAll = expanded.has(cwd) || selectedHidden || Boolean(needle);
          const visible = showAll ? group : group.slice(0, PREVIEW_COUNT);
          return (
            <section key={cwd} data-project className={`relative flex flex-col gap-0.5 ${drag?.cwd === cwd ? 'opacity-40' : ''}`}>
              {!isNoOpDrop && drag?.dropAt === groupIndex ? (
                <div aria-hidden className="absolute inset-x-2 -top-px z-10 h-0.5 rounded-full bg-[var(--focus-ring)]" />
              ) : null}
              {!isNoOpDrop && drag?.dropAt === groups.length && groupIndex === groups.length - 1 ? (
                <div aria-hidden className="absolute inset-x-2 -bottom-px z-10 h-0.5 rounded-full bg-[var(--focus-ring)]" />
              ) : null}
              <div
                onPointerDown={(event) => startProjectDrag(event, cwd)}
                className="group flex h-8 w-full items-center gap-2.5 rounded-full pl-3 pr-2 text-sm font-normal text-[var(--sidebar-list-muted)] hover:bg-[hsl(var(--sidebar-item-hover))]"
              >
                <button
                  type="button"
                  aria-expanded={!isCollapsed}
                  title={cwd === CONVERSATION_CWD ? undefined : cwd}
                  onClick={() => toggle(setCollapsed, cwd)}
                  onKeyDown={(event) => {
                    if (!event.altKey || needle) return;
                    if (event.key === 'ArrowUp' && groupIndex > 0) reorderProject(cwd, groupIndex - 1);
                    else if (event.key === 'ArrowDown' && groupIndex < groups.length - 1) reorderProject(cwd, groupIndex + 2);
                    else return;
                    event.preventDefault();
                  }}
                  className="flex h-full min-w-0 flex-1 items-center gap-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                >
                  {cwd === CONVERSATION_CWD ? (
                    <MessagesSquare size={15} strokeWidth={1.8} aria-hidden className="shrink-0" />
                  ) : isCollapsed ? (
                    <Folder size={15} strokeWidth={1.8} aria-hidden className="shrink-0" />
                  ) : (
                    <FolderOpen size={15} strokeWidth={1.8} aria-hidden className="shrink-0" />
                  )}
                  <span className="min-w-0 truncate">{cwd === CONVERSATION_CWD ? t('conversations') : projectName(cwd)}</span>
                </button>
                <button
                  type="button"
                  data-no-drag
                  aria-label={t('newTaskIn', { project: cwd === CONVERSATION_CWD ? t('conversations') : projectName(cwd) })}
                  title={t('newTask')}
                  onClick={() => onNewTask(cwd)}
                  className="flex size-5 shrink-0 items-center justify-center rounded-md text-[hsl(var(--sidebar-action-icon))] opacity-0 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] group-hover:opacity-100"
                >
                  <Plus size={14} aria-hidden />
                </button>
              </div>
              {isCollapsed ? null : visible.map((task) => row(task, true))}
              {!isCollapsed && visible.length < group.length ? (
                <button
                  type="button"
                  onClick={() => toggle(setExpanded, cwd)}
                  className={`${PILL_ROW} justify-center text-xs font-normal text-[var(--sidebar-list-muted)] hover:bg-[hsl(var(--sidebar-item-hover))]`}
                >
                  {t('showAll', { count: String(group.length) })}
                </button>
              ) : null}
            </section>
          );
        })}
        {archivedTasks.length > 0 && !needle ? (
          <section className="mt-3 flex flex-col gap-0.5" aria-label={t('archived')}>
            <button
              type="button"
              aria-expanded={showArchived}
              onClick={() => setShowArchived((current) => !current)}
              className={`${PILL_ROW} pl-3 pr-2 text-left font-normal text-[var(--sidebar-list-muted)] hover:bg-[hsl(var(--sidebar-item-hover))]`}
            >
              <Archive size={15} strokeWidth={1.8} aria-hidden className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">{t('archivedCount', { count: String(archivedTasks.length) })}</span>
              <ChevronRight size={13} aria-hidden className={`shrink-0 transition-transform ${showArchived ? 'rotate-90' : ''}`} />
            </button>
            {showArchived ? archivedTasks.map((task) => row(task, true)) : null}
          </section>
        ) : null}
      </nav>
      <div className="mx-3 mb-3 flex h-[50px] shrink-0 items-center gap-2.5 rounded-xl border border-[var(--sidebar-user-card-border)] bg-[var(--sidebar-user-card-bg)] pl-2.5 pr-2">
        <img src={iconUrl} alt="" draggable={false} className="pointer-events-none size-7 shrink-0 select-none" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-13 font-medium leading-[1.3] text-[var(--sidebar-user-card-text)]">Tandem</span>
          <span className="truncate text-11 leading-[1.3] text-[var(--sidebar-list-muted)]">{version}</span>
        </span>
        <button
          type="button"
          aria-label={t('settings')}
          title={t('settings')}
          onClick={onOpenSettings}
          className="flex size-7 shrink-0 items-center justify-center rounded-full text-[var(--sidebar-user-card-text)] transition-colors hover:bg-[hsl(var(--sidebar-item-hover))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
        >
          <Settings size={15} strokeWidth={1.8} aria-hidden />
        </button>
      </div>
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
