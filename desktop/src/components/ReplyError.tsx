import { CircleAlert, ChevronRight } from 'lucide-react';
import { t } from '../lib/i18n';

/** A finished turn keeps its failure in the timeline, using the same card as Cindy's ErrorNotice. */
export function ReplyError({ details }: { details: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-elevated)] p-2">
      <span aria-hidden className="mt-0.5 inline-flex shrink-0 text-[var(--error-fg)]">
        <CircleAlert size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="break-words text-13 leading-[1.54] text-[var(--text-primary)]">{t('replyFailed')}</div>
        {details ? (
          <details className="group">
            <summary className="mt-2 flex h-7 w-fit cursor-pointer list-none items-center gap-1 rounded-full px-3 text-13 font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--button-secondary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] active:bg-[var(--button-secondary-pressed)] motion-reduce:transition-none">
              <ChevronRight size={12} aria-hidden className="transition-transform group-open:rotate-90 motion-reduce:transition-none" />
              {t('replyErrorDetails')}
            </summary>
            <pre className="selectable mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-[hsl(var(--surface-hsl))] p-2 font-mono text-12 leading-[1.667] text-[var(--text-secondary)]">{details}</pre>
          </details>
        ) : null}
      </div>
    </div>
  );
}
