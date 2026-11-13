import { CircleAlert, ChevronRight } from 'lucide-react';
import { t } from './lib/i18n';
import { replyErrorPresentation } from './lib/replyError';

export function ReplyError({ details }: { details: string }) {
  const error = replyErrorPresentation(details);
  return (
    <div role="note" aria-label={t('replyFailed')} className="reply-error">
      <span aria-hidden className="reply-error-icon"><CircleAlert size={16} /></span>
      <div>
        <p>{error.message}</p>
        {error.description ? <p className="reply-error-description">{error.description}</p> : null}
        {error.details ? (
          <details>
            <summary>
              <span aria-hidden className="reply-error-chevron"><ChevronRight size={12} /></span>
              {t('showDetails')}
            </summary>
            <pre>{error.details}</pre>
          </details>
        ) : null}
      </div>
    </div>
  );
}
