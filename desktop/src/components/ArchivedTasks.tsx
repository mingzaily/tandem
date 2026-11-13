import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef } from 'react';
import { currentLanguage, t } from '../lib/i18n';
import { AgentMark } from './AgentMark';
import { SettingsButton } from './SettingsButton';
import type { ArchivedTask } from './SettingsView';

const ROW = 'flex items-center justify-between gap-3 px-4 py-4';
const ROW_LABEL = 'text-13 font-medium text-[var(--settings-section-title)]';
const ROW_HINT = 'text-12 leading-[1.4] text-[var(--text-secondary)]';
const DIVIDER = 'mx-4 h-px bg-[var(--settings-theme-card-border)]';

const archivedDate = (ms: number) =>
  new Date(ms).toLocaleString(currentLanguage() === 'zh' ? 'zh-CN' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function ArchivedTasks({ tasks, onUnarchive, archiving }: { tasks: ArchivedTask[]; onUnarchive: (id: string) => void; archiving?: ReadonlySet<string> }) {
  const scroller = useRef<HTMLDivElement>(null);
  const virtual = tasks.length > 80;
  const rows = useVirtualizer({ count: tasks.length, enabled: virtual, getScrollElement: () => scroller.current,
    getItemKey: (index) => tasks[index].id, estimateSize: () => 76, overscan: 4, initialRect: { width: 0, height: 520 } });
  const shown = virtual ? rows.getVirtualItems() : tasks.map((task, index) => ({ index, start: 0, key: task.id }));
  return <div ref={scroller} data-archive-tasks role="list" aria-label={t('settingsArchived')} className={virtual ? 'max-h-[520px] overflow-y-auto overscroll-contain [scrollbar-gutter:stable]' : undefined}>
    <div className={virtual ? 'relative w-full' : undefined} style={virtual ? { height: rows.getTotalSize() } : undefined}>
      {shown.map((row) => {
        const task = tasks[row.index];
        return <div key={row.key} role="listitem" data-index={row.index} ref={virtual ? rows.measureElement : undefined}
          className={virtual ? 'absolute left-0 top-0 w-full' : undefined} style={virtual ? { transform: `translateY(${row.start}px)` } : undefined}>
          {row.index > 0 ? <div className={DIVIDER} /> : null}
          <div className={ROW}>
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="flex w-[15px] shrink-0 justify-center text-[var(--text-tertiary)]"><AgentMark agent={task.agent} /></span>
              <span className="flex min-w-0 flex-col gap-1">
                <span className={`${ROW_LABEL} truncate`}>{task.title || t('untitled')}</span>
                <span className={ROW_HINT}>{archivedDate(task.updatedAtMs)}</span>
              </span>
            </span>
            <SettingsButton busy={archiving?.has(task.id)} onClick={() => onUnarchive(task.id)}>{t('taskUnarchive')}</SettingsButton>
          </div>
        </div>;
      })}
    </div>
  </div>;
}
