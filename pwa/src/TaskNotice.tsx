import { useState } from 'react';
import { CircleAlert, ChevronDown, ChevronRight, X } from 'lucide-react';
import { t } from './lib/i18n';

export function TaskNotice({ details, onDismiss }: { details: string; onDismiss: () => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <section className="task-notice" aria-label={t('turnFailed')}>
      <CircleAlert size={16} className="task-notice-icon" aria-hidden />
      <div className="task-notice-copy">
        <p role="alert">{t('turnFailed')}</p>
        {details && (
          <button
            className="notice-details"
            aria-expanded={expanded}
            onClick={() => setExpanded((open) => !open)}
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {t(expanded ? 'hideDetails' : 'showDetails')}
          </button>
        )}
        {expanded && <pre>{details}</pre>}
      </div>
      <button className="icon-button" aria-label={t('close')} onClick={onDismiss}>
        <X size={14} />
      </button>
    </section>
  );
}
