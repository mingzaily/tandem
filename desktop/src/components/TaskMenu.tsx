import { Archive, ArchiveRestore, Loader2, Sparkles, Copy, FolderOpen, Pencil, Pin, PinOff, type LucideIcon } from 'lucide-react';
import { revealTaskFolder, type Agent, type TaskSummary } from '../lib/api';
import { t } from '../lib/i18n';
import { toggleArchived, togglePin, type TaskMeta } from '../lib/taskMeta';
import { terminalResumeCommand } from '../lib/terminalResume';
import { MENU_ROW } from './ComposerMenu';
import { FloatingMenu } from './FloatingMenu';

export interface TaskMenuAnchor {
  source: 'sidebar' | 'header';
  id: string;
  x: number;
  y: number;
}

interface TaskMenuProps {
  anchor: TaskMenuAnchor;
  task: TaskSummary;
  meta: TaskMeta;
  onMetaChange: (meta: TaskMeta) => void;
  onRename: (id: string) => void;
  onGenerateTitle: (agent: Agent, id: string) => void;
  generatingTitle: boolean;
  onClose: () => void;
}

export function TaskMenu({ anchor, task, meta, onMetaChange, onRename, onGenerateTitle, generatingTitle, onClose }: TaskMenuProps) {
  const { id, agent } = task;
  const isPinned = meta.pins.includes(id);
  const isArchived = meta.archived.includes(id);
  const items: { label: string; icon: LucideIcon; run: () => void; busy?: boolean }[] = [
    { label: t('taskRename'), icon: Pencil, run: () => onRename(id) },
    { label: t(generatingTitle ? 'taskGeneratingTitle' : 'taskGenerateTitle'), icon: generatingTitle ? Loader2 : Sparkles, run: () => onGenerateTitle(agent, id), busy: generatingTitle },
    ...(isArchived
      ? []
      : [
          {
            label: isPinned ? t('taskUnpin') : t('taskPin'),
            icon: isPinned ? PinOff : Pin,
            run: () => onMetaChange(togglePin(meta, id)),
          },
        ]),
    {
      label: isArchived ? t('taskUnarchive') : t('taskArchive'),
      icon: isArchived ? ArchiveRestore : Archive,
      run: () => onMetaChange(toggleArchived(meta, id)),
    },
    {
      label: t('taskCopyResume'),
      icon: Copy,
      run: () => void navigator.clipboard.writeText(terminalResumeCommand(task)).catch(console.error),
    },
    { label: t('taskReveal'), icon: FolderOpen, run: () => void revealTaskFolder(agent, id).catch(console.error) },
  ];
  return (
    <FloatingMenu x={anchor.x} y={anchor.y} label={t('taskMenu')} onClose={onClose}>
      {items.map(({ label, icon: Icon, run, busy }) => (
        <button
          key={label}
          type="button"
          role="menuitem"
          aria-busy={busy || undefined}
          disabled={busy}
          onClick={() => {
            onClose();
            run();
          }}
          className={`${MENU_ROW} aria-busy:opacity-100`}
        >
          <Icon size={15} strokeWidth={1.8} aria-hidden className={`shrink-0 text-[var(--cmd-palette-item-icon)] ${busy ? 'motion-safe:animate-spin motion-safe:[animation-duration:var(--motion-spinner-cycle)]' : ''}`} />
          <span className="min-w-0 flex-1 truncate">{label}</span>
        </button>
      ))}
    </FloatingMenu>
  );
}
