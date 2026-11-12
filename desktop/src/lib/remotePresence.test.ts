import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_REMOTE_PRESENCE, observeRemoteState, remotePresenceReducer } from './remotePresence';
import { onRemoteChanged, remoteState, type RemoteClient, type RemoteState } from './api';

vi.mock('./api', () => ({ onRemoteChanged: vi.fn(), remoteState: vi.fn() }));
afterEach(() => vi.resetAllMocks());

const phone = (clientId: string, isOnline = true): RemoteClient => ({ clientId, name: clientId, isOnline, pairedAtMs: 0 });
const state = (clients: RemoteClient[], patch: Partial<RemoteState> = {}): RemoteState => ({
  enabled: true, relayUrl: 'ws://localhost/ws', hasHostToken: true, relayVersion: null, status: 'online',
  error: null, pairing: null, clients, ...patch,
});
const received = (value: RemoteState) => ({ type: 'received' as const, state: value });
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

describe('remote connection notice lifecycle', () => {
  it('shows encrypted phone connections rather than the relay or saved pairings', () => {
    const online = state([phone('online'), phone('saved', false)]);
    expect(remotePresenceReducer(EMPTY_REMOTE_PRESENCE, received(online)).clients.map((c) => c.clientId)).toEqual(['online']);
    for (const patch of [{ enabled: false }, { status: 'connecting' as const }, { status: 'failed' as const }]) {
      expect(remotePresenceReducer(EMPTY_REMOTE_PRESENCE, received({ ...online, ...patch })).clients).toEqual([]);
    }
  });

  it('collapses per task and expands when connections change', () => {
    let current = remotePresenceReducer(EMPTY_REMOTE_PRESENCE, received(state([phone('a')])));
    current = remotePresenceReducer(current, { type: 'collapse', scope: 'task-a' });
    expect(current.collapsed).toContain('task-a');
    expect(current.collapsed).not.toContain('task-b');
    current = remotePresenceReducer(current, received(state([phone('a'), phone('saved', false)])));
    expect(current.collapsed).toEqual(['task-a']);
    current = remotePresenceReducer(current, received(state([phone('a'), phone('b')])));
    expect(current.collapsed).toEqual([]);
    current = remotePresenceReducer(current, { type: 'collapse', scope: 'task-a' });
    current = remotePresenceReducer(current, received(state([])));
    expect(current.collapsed).toEqual([]);
    current = remotePresenceReducer(current, received(state([phone('a')])));
    expect(current.collapsed).toEqual([]);
  });

  it('expands one task while preserving another task preference', () => {
    const current = { clients: [phone('a')], collapsed: ['task-a', 'task-b'], error: null };
    expect(remotePresenceReducer(current, { type: 'expand', scope: 'task-a' }).collapsed).toEqual(['task-b']);
    expect(current.collapsed).toEqual(['task-a', 'task-b']);
  });
});

describe('remote state subscription', () => {
  it('keeps a newer disconnect when the initial read arrives late', async () => {
    const initial = deferred<RemoteState>();
    const latest = deferred<RemoteState>();
    let push!: () => void;
    const stop = vi.fn();
    vi.mocked(onRemoteChanged).mockImplementation(async (callback) => { push = callback; return stop; });
    vi.mocked(remoteState).mockReturnValueOnce(initial.promise).mockReturnValueOnce(latest.promise);
    const read = vi.fn();
    const errors = vi.fn();
    const observer = observeRemoteState(read, errors);
    await vi.waitFor(() => expect(remoteState).toHaveBeenCalledTimes(1));
    push();
    latest.resolve(state([]));
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    initial.resolve(state([phone('old')]));
    await initial.promise;
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0][0].clients).toEqual([]);
    expect(errors).not.toHaveBeenCalled();
    observer.stop();
    await Promise.resolve();
    expect(stop).toHaveBeenCalledOnce();
  });

  it('reports a failed read and accepts a later refresh', async () => {
    vi.mocked(onRemoteChanged).mockResolvedValue(vi.fn());
    vi.mocked(remoteState).mockRejectedValueOnce('IPC unavailable').mockResolvedValue(state([phone('phone')]));
    const read = vi.fn();
    const errors = vi.fn();
    const observer = observeRemoteState(read, errors);
    await vi.waitFor(() => expect(errors).toHaveBeenCalledWith('IPC unavailable'));
    await observer.refresh();
    expect(read.mock.calls[0][0].clients[0].clientId).toBe('phone');
    observer.stop();
  });

  it('removes a subscription that finishes registering after unmount', async () => {
    const subscribing = deferred<() => void>();
    const stop = vi.fn();
    vi.mocked(onRemoteChanged).mockReturnValue(subscribing.promise);
    const read = vi.fn();
    const observer = observeRemoteState(read, vi.fn());
    observer.stop();
    subscribing.resolve(stop);
    await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce());
    expect(remoteState).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });
});
