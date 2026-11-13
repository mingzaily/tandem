import { Copy, FolderOpen, Loader2, Sparkles } from 'lucide-react';
import { revealTaskFolder, type TaskSummary } from '../lib/api';
import { t } from '../lib/i18n';
import { isImeKey } from '../lib/ime';
import { terminalResumeCommand } from '../lib/terminalResume';
import { Tip } from './Tip';
import type { TaskMenuAnchor } from './TaskMenu';

const BUTTON = 'flex size-7 shrink-0 items-center justify-center rounded-md text-[hsl(var(--titlebar-icon))] transition-colors enabled:hover:bg-[var(--surface-hover)] enabled:hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]';

interface Props {
  task: TaskSummary;
  generatingTitle: boolean;
  onGenerateTitle: () => void;
  onOpenMenu: (anchor: TaskMenuAnchor) => void;
  onError: (error: unknown) => void;
}

export function TaskHeaderActions({ task, generatingTitle, onGenerateTitle, onOpenMenu, onError }: Props) {
  const titleLabel = t(generatingTitle ? 'taskGeneratingTitle' : 'taskGenerateTitle');
  const TitleIcon = generatingTitle ? Loader2 : Sparkles;
  return <div className="ml-2 flex shrink-0 items-center gap-1"
    onContextMenu={(event) => {
      event.preventDefault();
      event.stopPropagation();
      onOpenMenu({ source: 'header', id: task.id, x: event.clientX, y: event.clientY });
    }}
    onKeyDown={(event) => {
      if (isImeKey(event)) return;
      if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return;
      event.preventDefault();
      const bounds = event.currentTarget.getBoundingClientRect();
      onOpenMenu({ source: 'header', id: task.id, x: bounds.left, y: bounds.bottom + 4 });
    }}>
    <Tip text={t('taskReveal')}><button type="button" aria-label={t('taskReveal')} className={BUTTON} onClick={() => void revealTaskFolder(task.agent, task.id).catch(onError)}><FolderOpen size={15} aria-hidden /></button></Tip>
    <Tip text={t('taskCopyResume')}><button type="button" aria-label={t('taskCopyResume')} className={BUTTON} onClick={() => void navigator.clipboard.writeText(terminalResumeCommand(task)).catch(onError)}><Copy size={15} aria-hidden /></button></Tip>
    <Tip text={titleLabel}><button type="button" aria-label={titleLabel} aria-busy={generatingTitle || undefined} disabled={generatingTitle}
      className={`${BUTTON} ${generatingTitle ? 'bg-[var(--surface-hover)] text-[var(--text-primary)]' : ''}`} onClick={onGenerateTitle}>
      <TitleIcon size={15} aria-hidden className={generatingTitle ? 'motion-safe:animate-spin motion-safe:[animation-duration:var(--motion-spinner-cycle)]' : undefined} />
    </button></Tip>
  </div>;
}
