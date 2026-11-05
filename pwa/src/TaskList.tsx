import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { TaskSummary } from './lib/types';
import { t } from './lib/i18n';
export function TaskList({
  tasks,
  projects,
  busy,
  onSelect,
}: {
  tasks: TaskSummary[];
  projects: { cwd: string; name: string }[];
  busy: string[];
  onSelect: (task: TaskSummary) => void;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const rows: ({ kind: 'project'; path: string } | { kind: 'task'; task: TaskSummary })[] = [];
  for (const path of new Set(tasks.map((t) => t.cwd))) {
    rows.push({ kind: 'project', path });
    for (const task of tasks.filter((t) => t.cwd === path)) rows.push({ kind: 'task', task });
  }
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroll.current,
    estimateSize: (i) => (rows[i].kind === 'project' ? 52 : 76),
    overscan: 5,
  });
  return (
    <div ref={scroll} className="task-list">
      <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
        {virtual.getVirtualItems().map((item) => {
          const row = rows[item.index];
          return (
            <div
              key={item.key}
              ref={virtual.measureElement}
              data-index={item.index}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${item.start}px)`,
              }}
            >
              {row.kind === 'project' ? (
                <h2>{projects.find((p) => p.cwd === row.path)?.name ?? row.path}</h2>
              ) : (
                <button className="task" onClick={() => onSelect(row.task)}>
                  <strong>{row.task.title}</strong>
                  <small>
                    {row.task.agent}
                    {busy.includes(row.task.id) && ' · ' + t('busy')}
                  </small>
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
