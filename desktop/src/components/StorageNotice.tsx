import { AlertCircle } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { preferencesSnapshot, subscribePreferences } from '../lib/storage';

/** Storage failures remain visible while the last valid configuration keeps the page usable. */
export function StorageNotice() {
  const { errors } = useSyncExternalStore(subscribePreferences, preferencesSnapshot);
  if (errors.length === 0) return null;
  return (
    <div role="alert" data-storage-notice className="fixed inset-x-4 top-[52px] z-[90] mx-auto flex max-w-[760px] items-start gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 py-2 text-12 text-[var(--text-primary)] shadow-lg">
      <AlertCircle size={15} className="mt-px shrink-0 text-[var(--warning-accent)]" />
      <div className="min-w-0 flex-1 break-words">{[...new Set(errors)].map((error) => <p key={error}>{error}</p>)}</div>
    </div>
  );
}
