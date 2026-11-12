import { CircleAlert, ChevronRight } from 'lucide-react';
import { t } from '../lib/i18n';

/** The failure stays at its turn boundary when a new message starts. */
export function ReplyError({ details }: { details: string }) {
  return <div className="py-1 text-13 text-[var(--text-secondary)]">
    <div className="flex items-center gap-1.5">
      <CircleAlert size={14} aria-hidden className="shrink-0 text-[var(--text-danger)]" />
      <span>{t('replyFailed')}</span>
    </div>
    {details ? <details className="group mt-1 pl-5">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded text-12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]">
        <ChevronRight size={12} aria-hidden className="transition-transform group-open:rotate-90 motion-reduce:transition-none" />
        {t('replyErrorDetails')}
      </summary>
      <pre className="selectable mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--surface-chip)] p-2 font-mono text-12 leading-5">{details}</pre>
    </details> : null}
  </div>;
}
