import { useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Folder, Monitor } from 'lucide-react';
import type { TaskSummary } from './lib/types';
import { t } from './lib/i18n';
import { AgentMark } from './AgentMark';
import { CONVERSATION_CWD, groupTasks } from './lib/tasks';

export function TaskList({
  tasks,
  projects,
  conversationRoots,
  busy,
  running,
  waiting,
  onSelect,
}: {
  tasks: TaskSummary[];
  projects: { cwd: string; name: string }[];
  conversationRoots: string[];
  busy: string[];
  running: string[];
  waiting: string[];
  onSelect: (task: TaskSummary) => void;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const rows: ({ kind: 'project'; path: string; count: number } | { kind: 'task'; task: TaskSummary })[] = [];
  for (const [path, group] of groupTasks(tasks, projects.map((p) => p.cwd), conversationRoots)) {
    rows.push({ kind: 'project', path, count: group.length });
    for (const task of group) rows.push({ kind: 'task', task });
  }
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroll.current,
    estimateSize: (i) => (rows[i].kind === 'project' ? 52 : 72),
    overscan: 5,
    getItemKey: (i) => {
      const row = rows[i];
      return row.kind === 'project' ? row.path : row.task.id;
    },
  });
  return (
    <div ref={scroll} className="task-list">
      {!tasks.length && <p className="empty-list">{t('empty')}</p>}
      <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
        {virtual.getVirtualItems().map((item) => {
          const row = rows[item.index];
          return (
            <div
              key={item.key}
              ref={virtual.measureElement}
              data-index={item.index}
              className="task-virtual-row"
              style={{ transform: `translateY(${item.start}px)` }}
            >
              {row.kind === 'project' ? (
                <h2 className="project-heading">
                  <Folder size={14} />
                  <span>
                    {row.path === CONVERSATION_CWD
                      ? t('conversations')
                      : projects.find((p) => p.cwd === row.path)?.name ??
                        row.path.split('/').filter(Boolean).at(-1) ?? row.path}
                  </span>
                  <small>{row.count}</small>
                </h2>
              ) : (
                <button className="task" onClick={() => onSelect(row.task)}>
                  <span
                    className={
                      'task-agent ' +
                      (running.includes(row.task.id) || busy.includes(row.task.id) ? 'task-running' : '')
                    }
                  >
                    <AgentMark agent={row.task.agent} size={18} />
                  </span>
                  <span className="task-copy">
                    <strong>{row.task.title}</strong>
                    <small>
                      {busy.includes(row.task.id) ? (
                        <>
                          <Monitor size={11} />
                          {t('busy')}
                        </>
                      ) : waiting.includes(row.task.id) ? (
                        t('statusAwaitingYou')
                      ) : running.includes(row.task.id) ? (
                        t('running')
                      ) : (
                        agentName(row.task.agent)
                      )}
                    </small>
                  </span>
                  <time className="task-age" dateTime={new Date(row.task.updatedAtMs).toISOString()}>
                    {age(now - row.task.updatedAtMs)}
                  </time>
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
export const agentName = (agent: string) =>
  ({ claude: 'Claude Code', codex: 'Codex', pi: 'Pi' })[agent] ?? agent;
const age = (ms: number) =>
  ms < 60_000
    ? t('justNow')
    : ms < 3_600_000
      ? `${Math.floor(ms / 60_000)}${t('minutesAgo')}`
      : ms < 86_400_000
        ? `${Math.floor(ms / 3_600_000)}${t('hoursAgo')}`
        : `${Math.floor(ms / 86_400_000)}${t('daysAgo')}`;
