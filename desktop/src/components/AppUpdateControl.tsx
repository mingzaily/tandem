import { ArrowDownToLine, RefreshCw, RotateCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { checkAppUpdate, downloadAppUpdate, installAppUpdate, onAppUpdateChanged, readAppUpdate } from '../lib/api';
import { acceptUpdate, INITIAL_UPDATE, observeAppUpdate, updateBusy, type UpdateState } from '../lib/appUpdate';
import { t } from '../lib/i18n';
import { SettingsButton } from './SettingsButton';

export function useAppUpdate() {
  const [state, setState] = useState(INITIAL_UPDATE);
  const active = useRef(false);
  const pending = useRef(false);
  const accept = useCallback((next: UpdateState) => setState((current) => acceptUpdate(current, next)), []);
  const fail = useCallback((error: unknown) => setState((current) => ({ ...current, error: String(error) })), []);
  useEffect(() => {
    active.current = true;
    const observer = observeAppUpdate({ read: readAppUpdate, subscribe: onAppUpdateChanged }, accept, fail);
    return () => { active.current = false; observer.dispose(); };
  }, [accept, fail]);
  const perform = async (operation: () => Promise<UpdateState>) => {
    if (pending.current || updateBusy(state)) return;
    pending.current = true;
    try { const next = await operation(); if (active.current) accept(next); }
    catch (error) { if (active.current) fail(error); }
    finally { pending.current = false; }
  };
  return { state, check: () => void perform(checkAppUpdate), download: () => void perform(downloadAppUpdate), install: () => void perform(installAppUpdate) };
}

export function UpdateAction({ state, check, download, install }: {
  state: UpdateState; check: () => void; download: () => void; install: () => void;
}) {
  const action = state.phase === 'available' ? { label: 'updateDownload' as const, icon: ArrowDownToLine, run: download }
    : state.phase === 'ready' ? { label: 'updateRestart' as const, icon: RotateCw, run: install }
    : { label: 'updateCheck' as const, icon: RefreshCw, run: check };
  const label = state.phase === 'checking' ? 'updateChecking' : state.phase === 'downloading' ? 'updateDownloading'
    : state.phase === 'installing' ? 'updateInstalling' : action.label;
  return <SettingsButton busy={updateBusy(state)} onClick={action.run}>
    <action.icon size={14} aria-hidden />{t(label)}
  </SettingsButton>;
}

export function UpdateDetails({ state }: { state: UpdateState }) {
  const status = state.phase === 'checking' ? t('updateChecking')
    : state.phase === 'downloading' ? t('updateDownloading')
    : state.phase === 'ready' ? t('updateReady')
    : state.phase === 'installing' ? t('updateInstalling')
    : state.phase === 'latest' ? t('updateLatest')
    : state.update ? t('updateAvailable', { version: state.update.version }) : null;
  const progress = state.progress?.total ? Math.min(100, Math.floor(state.progress.downloaded / state.progress.total * 100)) : null;
  if (!status && !state.error) return null;
  return <div className="px-4 pb-4">
    {status ? <p className="text-13 font-medium text-[var(--settings-section-title)]" role="status" aria-live="polite">{status}{state.phase === 'downloading' && progress !== null ? ` ${progress}%` : ''}</p> : null}
    {state.phase === 'downloading' ? <progress aria-label={t('updateDownloading')} className="mt-2 h-1 w-full accent-[var(--status-bar-accent)]" max={100} value={progress ?? undefined} /> : null}
    {state.update?.notes ? <p className="selectable mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-12 text-[var(--text-secondary)]">{state.update.notes}</p> : null}
    {state.phase === 'ready' ? <p className="mt-2 text-12 text-[var(--text-secondary)]">{t('updateRestartHint')}</p> : null}
    {state.error ? <p role="alert" className="selectable mt-2 break-words text-12 text-[var(--text-danger)]">{t('updateFailed')} {state.error}</p> : null}
  </div>;
}
