import { Pause } from 'lucide-react';
import { resumeQueue, type TaskQueue } from '../lib/api';
import { t } from '../lib/i18n';
import { ComposerStatusRow, type ComposerStatusSlots } from './ComposerStatusRow';

export function QueuePauseStatus({ queue, onChange, onError, center, indicator }: ComposerStatusSlots & {
  queue: TaskQueue;
  onChange: (queue: TaskQueue) => void;
  onError: (error: unknown) => void;
}) {
  return (
    <ComposerStatusRow center={center} indicator={indicator} actions={
      <button type="button" onClick={() => void resumeQueue(queue.taskId).then(onChange).catch(onError)}
        className="mr-1 flex h-6 cursor-pointer items-center rounded-full border border-[var(--chat-input-border)] px-2 text-13 font-medium text-[var(--status-bar-meta)] transition-colors hover:bg-[var(--surface-hover)] active:bg-[var(--button-secondary-pressed)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]">
        {t('queueResume')}
      </button>
    }>
      <span role="status" title={t('queuePaused')} className="flex min-w-0 items-center gap-1.5 text-13 font-medium text-[var(--status-bar-accent)]">
        <Pause size={14} strokeWidth={2} aria-hidden className="shrink-0" />
        <span className="truncate">{t('queuePaused')}</span>
      </span>
    </ComposerStatusRow>
  );
}
