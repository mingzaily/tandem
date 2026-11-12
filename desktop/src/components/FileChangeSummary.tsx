import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronUp, FileDiff, FileText } from 'lucide-react';
import { useId, useRef } from 'react';
import { t } from '../lib/i18n';
import { fileChangeLabel, type FileChanges, type ChangedFile } from '../lib/fileChanges';

const MAX_VISIBLE_FILES = 3;
const ROW_HEIGHT = 36;

function ChangedFileList({ files, cwd, label, id }: { files: ChangedFile[]; cwd: string | null; label: string; id: string }) {
  const scroller = useRef<HTMLDivElement>(null);
  const height = Math.min(files.length * ROW_HEIGHT, 252);
  const rows = useVirtualizer({ count: files.length, getScrollElement: () => scroller.current, getItemKey: (index) => files[index].path, estimateSize: () => ROW_HEIGHT, overscan: 3 });
  return (
    <div ref={scroller} id={id} role="list" aria-label={label} tabIndex={files.length > MAX_VISIBLE_FILES ? 0 : undefined}
      className="overflow-y-auto overscroll-contain rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)]" style={{ height }}>
      <div className="relative w-full" style={{ height: rows.getTotalSize() }}>
        {rows.getVirtualItems().map((row) => {
          const file = files[row.index];
          const { name, directory } = fileChangeLabel(file.path, cwd);
          return (
            <div key={file.path} role="listitem" data-tooltip={file.path} className="absolute left-0 top-0 flex w-full items-center gap-2 rounded-lg px-2" style={{ height: row.size, transform: `translateY(${row.start}px)` }}>
              <FileText size={15} aria-hidden className="shrink-0 text-[var(--text-secondary)]" />
              <span className="selectable min-w-0 flex-1 truncate text-13 text-[var(--text-primary)]">{name}{directory ? <span className="ml-2 text-12 text-[var(--text-tertiary)]">{directory}</span> : null}</span>
              {file.stats ? <span className="flex shrink-0 gap-1.5 whitespace-nowrap font-mono text-12 tabular-nums"><span className="text-[var(--diff-add-fg)]">+{file.stats.added}</span><span className="text-[var(--diff-del-fg)]">−{file.stats.removed}</span></span> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Read-only native edit records use the same in-stream card structure as turn results. */
export function FileChangeSummary({ summary, cwd, expanded, onToggle }: { summary: FileChanges; cwd: string | null; expanded: boolean; onToggle: () => void }) {
  const heading = useId();
  const list = useId();
  const { files, stats } = summary;
  const visibleFiles = expanded ? files : files.slice(0, MAX_VISIBLE_FILES);
  const label = t('filesChanged', { count: String(files.length) });
  return (
    <section aria-labelledby={heading} className="overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--surface-elevated)]">
      <div className="flex min-h-12 items-center gap-2.5 px-3 py-1.5">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-chip)] text-[var(--text-secondary)]"><FileDiff size={16} aria-hidden /></div>
        <div className="min-w-0 flex-1">
          <div id={heading} className="truncate text-14 font-medium text-[var(--text-primary)]">{label}</div>
          {stats ? <div className="mt-0.5 flex gap-1.5 font-mono text-12 tabular-nums"><span className="text-[var(--diff-add-fg)]">+{stats.added}</span><span className="text-[var(--diff-del-fg)]">−{stats.removed}</span></div> : null}
        </div>
      </div>
      <div className="border-t border-[var(--border-default)] px-3 py-2">
        <ChangedFileList files={visibleFiles} cwd={cwd} label={label} id={list} />
        {files.length > MAX_VISIBLE_FILES ? (
          <button type="button" onClick={onToggle} aria-expanded={expanded} aria-controls={list}
            className="flex h-8 items-center gap-1 rounded-lg px-2 text-13 text-[var(--text-secondary)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]">
            {expanded ? t('fileChangesLess') : t('fileChangesMore', { count: String(files.length - MAX_VISIBLE_FILES) })}
            {expanded ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
          </button>
        ) : null}
      </div>
    </section>
  );
}
