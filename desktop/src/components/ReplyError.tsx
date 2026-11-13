import { CircleAlert, ChevronRight } from 'lucide-react';
import { t } from '../lib/i18n';
import { replyErrorPresentation } from '../lib/replyError';

/** A finished turn keeps its readable failure at the same place in the timeline. */
export function ReplyError({ details }: { details: string }) {
  const error = replyErrorPresentation(details);
  return (
    <div role="note" aria-label={t('replyFailed')} className="flex items-start gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-elevated)] p-2">
      <span aria-hidden className="mt-0.5 inline-flex shrink-0 text-[var(--error-fg)]">
        <CircleAlert size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="selectable m-0 text-13 leading-5 text-[var(--text-primary)] [overflow-wrap:anywhere]">{error.message}</p>
        {error.description ? <p className="selectable mt-1 text-12 leading-5 text-[var(--text-secondary)] [overflow-wrap:anywhere]">{error.description}</p> : null}
        {error.details ? (
          <details key={error.details} className="group mt-2">
            <summary className="inline-flex h-7 w-fit cursor-pointer list-none items-center justify-center gap-1.5 rounded-full border border-transparent px-3 text-13 font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--button-secondary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] motion-reduce:transition-none [&::-webkit-details-marker]:hidden">
              <ChevronRight size={12} aria-hidden className="shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none" />
              <span className="group-open:hidden">{t('replyErrorDetails')}</span>
              <span className="hidden group-open:inline">{t('replyErrorHideDetails')}</span>
            </summary>
            <pre className="selectable mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-[hsl(var(--surface-hsl))] p-2 font-mono text-12 leading-[1.667] text-[var(--text-secondary)]">{error.details}</pre>
          </details>
        ) : null}
      </div>
    </div>
  );
}
