import { Archive, ArchiveRestore, Copy, FolderOpen, Pencil, Pin, PinOff, type LucideIcon } from 'lucide-react';
import { revealTaskFolder } from '../lib/api';
import { t } from '../lib/i18n';
import { toggleArchived, togglePin, type TaskMeta } from '../lib/taskMeta';
import { MENU_ROW } from './ComposerMenu';
import { FloatingMenu } from './FloatingMenu';

export interface TaskMenuAnchor {
  id: string;
  x: number;
  y: number;
}

interface TaskMenuProps {
  anchor: TaskMenuAnchor;
  meta: TaskMeta;
  onMetaChange: (meta: TaskMeta) => void;
  onRename: (id: string) => void;
  onClose: () => void;
}

export function TaskMenu({ anchor, meta, onMetaChange, onRename, onClose }: TaskMenuProps) {
  const { id } = anchor;
  const isPinned = meta.pins.includes(id);
  const isArchived = meta.archived.includes(id);
  const items: { label: string; icon: LucideIcon; run: () => void }[] = [
    { label: t('taskRename'), icon: Pencil, run: () => onRename(id) },
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
      run: () => void navigator.clipboard.writeText(`claude --resume ${id}`).catch(console.error),
    },
    { label: t('taskReveal'), icon: FolderOpen, run: () => void revealTaskFolder(id).catch(console.error) },
  ];
  return (
    <FloatingMenu x={anchor.x} y={anchor.y} label={t('taskMenu')} onClose={onClose}>
      {items.map(({ label, icon: Icon, run }) => (
        <button
          key={label}
          type="button"
          role="menuitem"
          onClick={() => {
            onClose();
            run();
          }}
          className={MENU_ROW}
        >
          <Icon size={15} strokeWidth={1.8} aria-hidden className="shrink-0 text-[var(--cmd-palette-item-icon)]" />
          <span className="min-w-0 flex-1 truncate">{label}</span>
        </button>
      ))}
    </FloatingMenu>
  );
}
