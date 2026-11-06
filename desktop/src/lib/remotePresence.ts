import { useEffect, useReducer, useRef, useState } from 'react';
import { onRemoteChanged, remoteState, type RemoteClient, type RemoteState } from './api';

export interface RemotePresence {
  clients: RemoteClient[];
  collapsed: string[];
  error: string | null;
}

type Action =
  | { type: 'received'; state: RemoteState }
  | { type: 'failed'; error: string }
  | { type: 'collapse' | 'expand'; scope: string };

export const EMPTY_REMOTE_PRESENCE: RemotePresence = { clients: [], collapsed: [], error: null };

export function remotePresenceReducer(current: RemotePresence, action: Action): RemotePresence {
  switch (action.type) {
    case 'received': {
      const clients = action.state.enabled && action.state.status === 'online'
        ? action.state.clients.filter((client) => client.isOnline)
        : [];
      const sameConnections = clients.length === current.clients.length &&
        clients.every((client) => current.clients.some((previous) => previous.clientId === client.clientId));
      return { clients, collapsed: sameConnections ? current.collapsed : [], error: null };
    }
    case 'failed':
      return { ...current, error: action.error };
    case 'collapse':
      return { ...current, collapsed: [...current.collapsed, action.scope] };
    case 'expand':
      return { ...current, collapsed: current.collapsed.filter((scope) => scope !== action.scope) };
  }
}

/** Subscribe before reading; a later notification owns the latest snapshot. */
export function observeRemoteState(received: (state: RemoteState) => void, failed: (error: string) => void) {
  let active = true;
  let revision = 0;
  const refresh = async () => {
    const request = ++revision;
    try {
      const state = await remoteState();
      if (active && request === revision) received(state);
    } catch (error) {
      if (active && request === revision) failed(String(error));
    }
  };
  const subscribed = onRemoteChanged(() => void refresh());
  void subscribed.then(() => { if (active) void refresh(); }).catch((error) => {
    if (active) failed(String(error));
  });
  return {
    refresh,
    stop() {
      active = false;
      revision++;
      void subscribed.then((stop) => stop()).catch((error) => console.error(error));
    },
  };
}

export function useRemotePresence() {
  const [state, dispatch] = useReducer(remotePresenceReducer, EMPTY_REMOTE_PRESENCE);
  const [subscription, setSubscription] = useState(0);
  const observer = useRef<ReturnType<typeof observeRemoteState> | null>(null);
  useEffect(() => {
    const current = observeRemoteState(
      (state) => dispatch({ type: 'received', state }),
      (error) => dispatch({ type: 'failed', error }),
    );
    observer.current = current;
    return current.stop;
  }, [subscription]);
  return {
    ...state,
    refresh: () => observer.current!.refresh(),
    retry: () => setSubscription((current) => current + 1),
    collapse: (scope: string) => dispatch({ type: 'collapse', scope }),
    expand: (scope: string) => dispatch({ type: 'expand', scope }),
  };
}
