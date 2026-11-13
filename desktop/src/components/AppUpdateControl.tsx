import { ArrowDownToLine, RefreshCw, RotateCw } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { checkAppUpdate, downloadAppUpdate, installAppUpdate, onAppUpdateChanged, readAppUpdate } from '../lib/api';
import { acceptUpdate, INITIAL_UPDATE, observeAppUpdate, updateBusy, type UpdateState } from '../lib/appUpdate';
import { t } from '../lib/i18n';
import { SettingsButton } from './SettingsButton';

const UpdateDetails = lazy(() => import('./UpdateDetails').then((module) => ({ default: module.UpdateDetails })));

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

export function SidebarUpdate() {
  const { state } = useAppUpdate();
  return <UpdateStatus state={state} compact />;
}

export function UpdateStatus({ state, compact = false }: { state: UpdateState; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const status = state.phase === 'checking' ? t('updateChecking')
    : state.phase === 'downloading' ? t('updateDownloading')
    : state.phase === 'ready' ? t('updateReady')
    : state.phase === 'installing' ? t('updateInstalling')
    : state.phase === 'latest' ? t('updateLatest')
    : state.update ? t('updateAvailable', { version: state.update.version }) : null;
  const progress = state.progress?.total ? Math.min(100, Math.floor(state.progress.downloaded / state.progress.total * 100)) : null;
  if (!status && !state.error) return null;
  const label = state.error ? t('updateFailedBadge')
    : `${status}${state.phase === 'downloading' && progress !== null ? ` ${progress}%` : ''}`;
  const hint = [
    label,
    state.update?.notes,
    state.phase === 'ready' ? t('updateRestartHint') : null,
    state.error ? `${t('updateFailed')} ${state.error}` : null,
  ].filter(Boolean).join('\n\n');
  const compactLabel = state.phase === 'available' ? t('updateNewBadge') : label;
  return <>
    <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog"
      aria-label={`${hint}\n\n${t('updateViewDetails')}`} data-tooltip={`${label}\n${t('updateViewDetails')}`}
      className={`inline-flex min-w-0 shrink items-center whitespace-nowrap rounded-full border border-[var(--border-default)] bg-[var(--surface-chip)] cursor-pointer hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] ${compact ? 'h-5 max-w-[112px] px-2 text-11' : 'h-7 max-w-[240px] px-2.5 text-12'} ${state.error ? 'text-[var(--text-danger)]' : 'text-[var(--text-secondary)]'}`}>
      <span className="truncate">{compact ? compactLabel : label}</span>
    </button>
    <span className="sr-only" role={state.error ? 'alert' : 'status'} aria-live={state.error ? 'assertive' : 'polite'}>{label}</span>
    {open ? <Suspense fallback={null}><UpdateDetails state={state} onClose={() => setOpen(false)} /></Suspense> : null}
  </>;
}
