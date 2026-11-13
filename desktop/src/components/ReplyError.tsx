import { CircleAlert, ChevronRight } from 'lucide-react';
import { t } from '../lib/i18n';
import { replyErrorPresentation } from '../lib/replyError';

/** A finished turn keeps its readable failure at the same place in the timeline. */
export function ReplyError({ details }: { details: string }) {
  const error = replyErrorPresentation(details);
  return (
    <div role="note" aria-label={t('replyFailed')} className="grid grid-cols-[16px_minmax(0,1fr)] gap-x-2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-elevated)] p-2">
      <span aria-hidden className="inline-flex h-5 w-4 items-center justify-center text-[var(--error-fg)]">
        <CircleAlert size={16} />
      </span>
      <div className="min-w-0">
        <p className="selectable m-0 text-13 leading-5 text-[var(--text-primary)] [overflow-wrap:anywhere]">{error.message}</p>
        {error.description ? <p className="selectable mt-1 text-12 leading-5 text-[var(--text-secondary)] [overflow-wrap:anywhere]">{error.description}</p> : null}
        {error.details ? (
          <details className="group mt-1">
            <summary className="relative flex min-h-7 w-fit cursor-pointer list-none items-center rounded pr-1 text-12 text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] motion-reduce:transition-none [&::-webkit-details-marker]:hidden">
              <span aria-hidden className="absolute -left-6 inline-flex h-5 w-4 items-center justify-center">
                <ChevronRight size={12} className="transition-transform group-open:rotate-90 motion-reduce:transition-none" />
              </span>
              {t('replyErrorDetails')}
            </summary>
            <pre className="selectable -ml-2 mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-[hsl(var(--surface-hsl))] p-2 font-mono text-12 leading-[1.667] text-[var(--text-secondary)]">{error.details}</pre>
          </details>
        ) : null}
      </div>
    </div>
  );
}
