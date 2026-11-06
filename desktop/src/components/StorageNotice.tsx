import { AlertCircle, LoaderCircle, RotateCcw } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { preferencesSnapshot, retryMigration, subscribePreferences } from '../lib/storage';
import { t } from '../lib/i18n';

/** Storage failures remain visible while the last valid configuration keeps the page usable. */
export function StorageNotice() {
  const { errors, migrationPending } = useSyncExternalStore(subscribePreferences, preferencesSnapshot);
  const [retrying, setRetrying] = useState(false);
  if (errors.length === 0 && !migrationPending) return null;
  const retry = async () => {
    setRetrying(true);
    try { await retryMigration(); } finally { setRetrying(false); }
  };
  return (
    <div role={errors.length ? 'alert' : 'status'} data-storage-notice className="fixed inset-x-4 top-[52px] z-[90] mx-auto flex max-w-[760px] items-start gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 py-2 text-12 text-[var(--text-primary)] shadow-lg">
      {errors.length ? <AlertCircle size={15} className="mt-px shrink-0 text-[var(--warning-accent)]" /> : <LoaderCircle size={15} className="mt-px shrink-0 animate-spin text-[var(--text-secondary)]" />}
      <div className="min-w-0 flex-1 break-words">{errors.length ? [...new Set(errors)].map((error) => <p key={error}>{error}</p>) : t('storageMigrating')}</div>
      {migrationPending && errors.length > 0 ? <button type="button" onClick={() => void retry()} disabled={retrying} className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 hover:bg-[var(--surface-hover)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"><RotateCcw size={12} />{t(retrying ? 'storageMigrating' : 'storageRetryMigration')}</button> : null}
    </div>
  );
}
