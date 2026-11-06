import { AlertCircle, Eye, MonitorOff, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { RemoteClient } from '../lib/api';
import { t } from '../lib/i18n';

const ACTION = 'flex h-5 shrink-0 cursor-pointer items-center justify-center gap-1 rounded-full px-1.5 text-12 text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]';
const deviceName = (client: RemoteClient) => client.name || t('remoteDeviceUnnamed');
const connectionLabel = (clients: RemoteClient[]) => clients.length === 1
  ? t('remoteConnectedDevice', { name: deviceName(clients[0]) })
  : t('remoteConnectedDevices', { count: String(clients.length) });
const connectionHint = (clients: RemoteClient[]) =>
  `${clients.map(deviceName).join(' · ')}\n${t('remoteConnectedHint')}`;

export function RemoteAccessIndicator({ clients, onExpand }: { clients: RemoteClient[]; onExpand: () => void }) {
  return (
    <button type="button" onClick={onExpand} aria-label={t('remoteExpandNotice')}
      title={`${connectionLabel(clients)}\n${connectionHint(clients)}`}
      className={`${ACTION} relative w-5 px-0 before:absolute before:-inset-1 before:content-['']`}>
      <span aria-hidden className="remote-access-dot h-2 w-2 rounded-full bg-[var(--status-bar-accent)]" />
    </button>
  );
}

export function RemoteAccessNotice({ clients, error, onRetry, onManage, onCollapse, onRevoke }: {
  clients: RemoteClient[];
  error: string | null;
  onRetry: () => void;
  onManage: () => void;
  onCollapse: () => void;
  onRevoke: (client: RemoteClient) => void;
}) {
  if (!clients.length && !error) return null;
  if (error) return (
    <div role="alert" title={error} className="flex h-7 min-w-0 max-w-full items-center gap-2 rounded-full border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 text-12">
      <AlertCircle size={13} aria-hidden className="shrink-0 text-[var(--text-danger)]" />
      <span className="min-w-0 truncate text-[var(--text-secondary)]">{t('remotePresenceFailed')}</span>
      <button type="button" onClick={onRetry} className={ACTION}>{t('remoteRefresh')}</button>
    </div>
  );
  return (
    <div data-remote-access="expanded" title={connectionHint(clients)}
      className="flex h-7 min-w-0 max-w-full select-none items-center gap-2 overflow-hidden rounded-full border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 py-0">
      <span aria-hidden className="remote-access-dot h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--status-bar-accent)]" />
      <span role="status" className="min-w-0 truncate text-12 text-[var(--text-primary)]">{connectionLabel(clients)}</span>
      <button type="button" onClick={clients.length > 1 ? onManage : () => onRevoke(clients[0])} className={ACTION}>
        {clients.length > 1 ? <Eye size={13} aria-hidden /> : <MonitorOff size={13} aria-hidden />}
        {t(clients.length > 1 ? 'remoteManageDevices' : 'remoteRevokeAccess')}
      </button>
      <button type="button" onClick={onCollapse} aria-label={t('remoteCollapseNotice')} title={t('remoteCollapseNotice')}
        className={`${ACTION} w-5 px-0`}><X size={13} aria-hidden /></button>
    </div>
  );
}

export function RemoteRevokeDialog({ client, onRevoke, onClose }: {
  client: RemoteClient;
  onRevoke: (clientId: string) => Promise<void>;
  onClose: () => void;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    dialog.current!.showModal();
    cancel.current!.focus();
    return () => dialog.current?.close();
  }, []);
  const revoke = async () => {
    setBusy(true);
    setError(null);
    try {
      // Revoke the device named when the dialog opened, even when another phone connects.
      await onRevoke(client.clientId);
      onClose();
    } catch (reason) {
      setError(t('remoteRevokeFailed', { error: String(reason) }));
      setBusy(false);
    }
  };
  const button = 'h-8 cursor-pointer rounded-full px-3 text-13 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:cursor-default disabled:opacity-60';
  return createPortal(
    <dialog ref={dialog} role="alertdialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
      className="remote-revoke-dialog m-auto w-[360px] max-w-[calc(100vw-32px)] rounded-xl border border-[var(--border-default)] bg-[var(--surface-elevated)] p-5 text-[var(--text-primary)] shadow-[shadow:var(--shadow-menu)]">
      <h2 id={`${id}-title`} className="break-words text-15 font-medium">{t('remoteRevokeTitle', { name: deviceName(client) })}</h2>
      <p id={`${id}-description`} className="mt-2 text-13 leading-relaxed text-[var(--text-secondary)]">{t('remoteRevokeHint')}</p>
      {error ? <p role="alert" className="mt-3 break-words text-13 text-[var(--text-danger)]">{error}</p> : null}
      <div className="mt-5 flex justify-end gap-2">
        <button ref={cancel} type="button" disabled={busy} onClick={onClose}
          className={`${button} border border-[var(--border-default)] hover:bg-[var(--surface-hover)]`}>{t('remoteRevokeCancel')}</button>
        <button type="button" disabled={busy} aria-busy={busy || undefined} onClick={() => void revoke()}
          className={`${button} bg-[var(--danger-bg-soft)] text-[var(--text-danger)] hover:bg-[var(--surface-hover)]`}>{t('remoteRevokeAccess')}</button>
      </div>
    </dialog>, document.body,
  );
}
