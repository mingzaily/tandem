import type { AppUpdate, UpdateProgress } from './api';

export interface UpdateState {
  phase: 'idle' | 'checking' | 'latest' | 'available' | 'downloading' | 'ready' | 'installing';
  revision: number;
  update?: AppUpdate | null;
  progress?: UpdateProgress | null;
  error?: string | null;
}
export const INITIAL_UPDATE: UpdateState = { phase: 'idle', revision: 0 };
export const updateBusy = (state: UpdateState) => ['checking', 'downloading', 'installing'].includes(state.phase);
export const acceptUpdate = (current: UpdateState, next: UpdateState) => next.revision >= current.revision ? next : current;

/** Subscribe before reading so downloads completed during navigation remain visible. */
export function observeAppUpdate(transport: {
  read: () => Promise<UpdateState>;
  subscribe: (accept: (state: UpdateState) => void) => Promise<() => void>;
}, accept: (state: UpdateState) => void, fail: (error: unknown) => void) {
  let active = true;
  let unlisten: (() => void) | undefined;
  const receive = (state: UpdateState) => { if (active) accept(state); };
  const ready = (async () => {
    try {
      const stop = await transport.subscribe(receive);
      if (!active) { stop(); return; }
      unlisten = stop;
      receive(await transport.read());
    } catch (error) { if (active) fail(error); }
  })();
  return { ready, dispose: () => { active = false; unlisten?.(); } };
}
