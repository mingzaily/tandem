import { CirclePlus, Folder, FolderOpen, Plus, Search } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import type { TaskSummary } from '../lib/api';
import { t } from '../lib/i18n';
import { projectName } from '../lib/items';
import { formatAge } from '../lib/tools';
import { AgentMark } from './AgentMark';

const PREVIEW_COUNT = 5;
const PILL_ROW =
  'flex h-8 w-full items-center gap-2.5 rounded-full text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]';

interface SidebarProps {
  tasks: TaskSummary[];
  loaded: boolean;
  selectedId: string | null;
  running: Set<string>;
  waiting: Set<string>;
  onSelect: (id: string) => void;
  onNewTask: (cwd?: string) => void;
}

export function Sidebar(props: SidebarProps) {
  const { tasks, loaded, selectedId, running, waiting, onSelect, onNewTask } = props;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState<string | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const now = Date.now();
  const needle = query?.trim().toLowerCase() ?? '';

  // Tasks arrive newest first, so groups and their rows keep that order.
  const groups = useMemo(() => {
    const byCwd = new Map<string, TaskSummary[]>();
    for (const task of tasks) {
      if (needle && !`${task.title} ${task.cwd}`.toLowerCase().includes(needle)) continue;
      const group = byCwd.get(task.cwd);
      if (group) group.push(task);
      else byCwd.set(task.cwd, [task]);
    }
    return [...byCwd.entries()];
  }, [tasks, needle]);

  const toggle = (set: typeof setCollapsed, cwd: string) =>
    set((current) => {
      const next = new Set(current);
      if (!next.delete(cwd)) next.add(cwd);
      return next;
    });

  return (
    <aside className="flex w-[280px] shrink-0 flex-col border-r border-[var(--border-default)] bg-[var(--surface-translucent-sidebar)]">
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
      <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <h2 className="flex h-8 items-center pl-3 text-xs font-normal text-[var(--sidebar-list-muted)]">
          {t('projects')}
        </h2>
        {loaded && groups.length === 0 ? (
          <p className="px-3 py-2 text-13 text-[hsl(var(--sidebar-muted))]">
            {needle ? t('noMatches') : t('noTasks')}
          </p>
        ) : null}
        {groups.map(([cwd, group]) => {
          const isCollapsed = collapsed.has(cwd) && !needle;
          const selectedHidden = group.findIndex((task) => task.id === selectedId) >= PREVIEW_COUNT;
          const showAll = expanded.has(cwd) || selectedHidden || Boolean(needle);
          const visible = showAll ? group : group.slice(0, PREVIEW_COUNT);
          return (
            <section key={cwd} className="flex flex-col gap-0.5">
              <div className="group flex h-8 w-full items-center gap-2.5 rounded-full pl-3 pr-2 text-sm font-normal text-[var(--sidebar-list-muted)] hover:bg-[hsl(var(--sidebar-item-hover))]">
                <button
                  type="button"
                  aria-expanded={!isCollapsed}
                  title={cwd}
                  onClick={() => toggle(setCollapsed, cwd)}
                  className="flex h-full min-w-0 flex-1 items-center gap-2.5 text-left focus-visible:outline-none"
                >
                  {isCollapsed ? (
                    <Folder size={15} strokeWidth={1.8} aria-hidden className="shrink-0" />
                  ) : (
                    <FolderOpen size={15} strokeWidth={1.8} aria-hidden className="shrink-0" />
                  )}
                  <span className="min-w-0 truncate">{projectName(cwd)}</span>
                </button>
                <button
                  type="button"
                  aria-label={t('newTask')}
                  title={t('newTask')}
                  onClick={() => onNewTask(cwd)}
                  className="flex size-5 shrink-0 items-center justify-center rounded-md text-[hsl(var(--sidebar-action-icon))] opacity-0 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] group-hover:opacity-100"
                >
                  <Plus size={14} aria-hidden />
                </button>
              </div>
              {isCollapsed
                ? null
                : visible.map((task) => {
                    const active = task.id === selectedId;
                    const isRunning = running.has(task.id);
                    const isWaiting = waiting.has(task.id);
                    return (
                      <button
                        key={task.id}
                        type="button"
                        onClick={() => onSelect(task.id)}
                        aria-current={active ? 'page' : undefined}
                        className={`${PILL_ROW} pl-5 pr-2 text-left font-medium ${
                          active
                            ? 'bg-[hsl(var(--sidebar-item-active))] text-[var(--sidebar-item-active-foreground)]'
                            : 'text-foreground hover:bg-[hsl(var(--sidebar-item-hover))]'
                        }`}
                      >
                        <span
                          className={`flex w-[15px] shrink-0 items-center justify-center ${
                            isRunning
                              ? 'task-running text-[var(--status-bar-accent)]'
                              : active
                                ? ''
                                : 'text-[hsl(var(--sidebar-muted))]'
                          }`}
                          {...(isRunning ? { role: 'img', 'aria-label': t('running') } : {})}
                        >
                          <AgentMark />
                        </span>
                        <span className="min-w-0 flex-1 truncate">{task.title || t('untitled')}</span>
                        {isWaiting ? (
                          <span
                            role="img"
                            aria-label={t('waitingForYou')}
                            title={t('waitingForYou')}
                            className="size-1.5 shrink-0 rounded-full bg-[var(--card-status-awaiting)]"
                          />
                        ) : null}
                        <span
                          className={`shrink-0 text-xs font-normal ${
                            active
                              ? 'text-[var(--sidebar-item-active-foreground)]'
                              : 'text-[var(--text-tertiary)]'
                          }`}
                        >
                          {formatAge(task.updatedAtMs, now)}
                        </span>
                      </button>
                    );
                  })}
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
      </nav>
    </aside>
  );
}
