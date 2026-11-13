import { X } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { UpdateState } from '../lib/appUpdate';
import { t } from '../lib/i18n';
import { Markdown } from './Markdown';
import { UpdateAction, useAppUpdate } from './AppUpdateControl';

export function UpdateDetails({ state, onClose }: { state: UpdateState; onClose: () => void }) {
  const update = useAppUpdate();
  const current = update.state.revision >= state.revision ? update.state : state;
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  return createPortal(
    <dialog ref={dialog} aria-labelledby={id} onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) {
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
      } }}
      className="update-details-dialog m-auto w-[640px] max-w-[calc(100vw-48px)] max-h-[80vh] overflow-hidden rounded-2xl border border-[var(--settings-theme-card-border)] bg-[var(--settings-theme-card-bg)] p-0 text-[var(--text-primary)] shadow-[shadow:var(--shadow-menu)]">
      <div className="flex items-center justify-between gap-4 border-b border-[var(--settings-theme-card-border)] px-6 py-4">
        <div className="min-w-0">
          <h2 id={id} className="text-16 font-medium">{t('updateDetailsTitle')}</h2>
          {current.update ? <p className="mt-1 text-12 text-[var(--text-secondary)]">Tandem {current.update.version}</p> : null}
        </div>
        <button type="button" autoFocus aria-label={t('updateDetailsClose')} onClick={onClose}
          className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"><X size={16} aria-hidden /></button>
      </div>
      <div className="max-h-[50vh] overflow-y-auto px-6 py-5">
        {current.update?.notes?.trim() ? <Markdown text={current.update.notes} /> : <p className="text-13 text-[var(--text-secondary)]">{t(current.phase === 'latest' ? 'updateLatest' : 'updateNotesEmpty')}</p>}
        {current.error ? <p role="alert" className="mt-4 whitespace-pre-wrap break-words text-13 text-[var(--text-danger)]">{current.error}</p> : null}
      </div>
      <div className="flex items-center justify-between gap-4 border-t border-[var(--settings-theme-card-border)] px-6 py-4">
        <p className="text-12 text-[var(--text-secondary)]">{t(current.phase === 'ready' ? 'updateRestartHint' : 'updateAutomaticHint')}</p>
        <UpdateAction state={current} check={update.check} download={update.download} install={update.install} />
      </div>
    </dialog>, document.body,
  );
}
