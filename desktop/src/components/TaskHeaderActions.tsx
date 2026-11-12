import { Copy, FolderOpen, MoreHorizontal } from 'lucide-react';
import { revealTaskFolder, type TaskSummary } from '../lib/api';
import { t } from '../lib/i18n';
import { terminalResumeCommand } from '../lib/terminalResume';
import { Tip } from './Tip';
import type { TaskMenuAnchor } from './TaskMenu';

const BUTTON = 'flex size-7 shrink-0 items-center justify-center rounded-md text-[hsl(var(--titlebar-icon))] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]';

export function TaskHeaderActions({ task, menuAnchor, onMenu, onError }: { task: TaskSummary; menuAnchor: TaskMenuAnchor | null; onMenu: (bounds: DOMRect) => void; onError: (error: unknown) => void }) {
  const menuOpen = menuAnchor?.source === 'header' && menuAnchor.id === task.id;
  return <div className="ml-2 flex shrink-0 items-center gap-1">
    <Tip text={t('taskReveal')}><button type="button" aria-label={t('taskReveal')} className={BUTTON} onClick={() => void revealTaskFolder(task.agent, task.id).catch(onError)}><FolderOpen size={15} aria-hidden /></button></Tip>
    <Tip text={t('taskCopyResume')}><button type="button" aria-label={t('taskCopyResume')} className={BUTTON} onClick={() => void navigator.clipboard.writeText(terminalResumeCommand(task)).catch(onError)}><Copy size={15} aria-hidden /></button></Tip>
    <Tip text={t('taskMenu')}><button type="button" aria-label={t('taskMenu')} aria-expanded={menuOpen} aria-pressed={menuOpen}
      onMouseDown={(event) => { if (menuOpen) event.stopPropagation(); }}
      className={`${BUTTON} ${menuOpen ? 'bg-[var(--surface-hover)] text-[var(--text-primary)]' : ''}`} onClick={(event) => onMenu(event.currentTarget.getBoundingClientRect())}>
      <MoreHorizontal size={15} aria-hidden />
    </button></Tip>
  </div>;
}
