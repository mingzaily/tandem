import { describe, expect, it, vi } from 'vitest';
import { acceptUpdate, INITIAL_UPDATE, observeAppUpdate, updateBusy, type UpdateState } from './appUpdate';

const update = { version: '0.1.2026111102', notes: '修复任务列表' };
const view = (phase: UpdateState['phase'], revision: number): UpdateState => ({ phase, revision, update });

describe('backend-owned application updates', () => {
  it('ignores an older read or command response after a download event', () => {
    const ready = view('ready', 5);
    expect(acceptUpdate(ready, view('downloading', 4))).toBe(ready);
    expect(acceptUpdate(view('downloading', 4), ready)).toBe(ready);
    expect(updateBusy(ready)).toBe(false);
    for (const phase of ['checking', 'downloading', 'installing'] as const) expect(updateBusy(view(phase, 1))).toBe(true);
  });

  it('subscribes before reading and preserves a newer event that arrives during the read', async () => {
    const calls: string[] = [];
    let state = INITIAL_UPDATE;
    let event!: (state: UpdateState) => void;
    const stop = vi.fn();
    const observer = observeAppUpdate({
      subscribe: async (accept) => { calls.push('subscribe'); event = accept; return stop; },
      read: async () => { calls.push('read'); event(view('ready', 3)); return view('downloading', 2); },
    }, (next) => { state = acceptUpdate(state, next); }, () => { throw new Error('unexpected'); });
    await observer.ready;
    expect(calls).toEqual(['subscribe', 'read']);
    expect(state.phase).toBe('ready');
    observer.dispose();
    event(view('installing', 4));
    expect(state.phase).toBe('ready');
    expect(stop).toHaveBeenCalledOnce();
  });

  it('reads an ongoing download after the about page is reopened', async () => {
    const first = vi.fn();
    const transport = { read: async () => view('downloading', 8), subscribe: async () => vi.fn() };
    const closed = observeAppUpdate(transport, first, vi.fn());
    closed.dispose();
    await closed.ready;
    expect(first).not.toHaveBeenCalled();
    const reopened = vi.fn();
    const observer = observeAppUpdate(transport, reopened, vi.fn());
    await observer.ready;
    expect(reopened).toHaveBeenCalledWith(view('downloading', 8));
    observer.dispose();
  });

  it('releases subscriptions that finish registering after the page unmounts', async () => {
    let register!: (stop: () => void) => void;
    const read = vi.fn(async () => INITIAL_UPDATE);
    const stop = vi.fn();
    const observer = observeAppUpdate({ read, subscribe: () => new Promise((resolve) => { register = resolve; }) }, vi.fn(), vi.fn());
    observer.dispose();
    register(stop);
    await observer.ready;
    expect(stop).toHaveBeenCalledOnce();
    expect(read).not.toHaveBeenCalled();
  });

  it('reports connection failures without initiating a check or download', async () => {
    const fail = vi.fn();
    const observer = observeAppUpdate({ read: async () => { throw new Error('IPC failed'); }, subscribe: async () => vi.fn() }, vi.fn(), fail);
    await observer.ready;
    expect(fail.mock.calls[0][0].message).toBe('IPC failed');
    observer.dispose();
  });
});
