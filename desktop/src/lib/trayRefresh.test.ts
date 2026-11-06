import { beforeEach, describe, expect, it, vi } from 'vitest';
import { refreshTray } from './api';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  stop: vi.fn(),
  complete: (_event: { payload: string | null }) => {},
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke, Channel: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen, emitTo: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.invoke.mockResolvedValue(undefined);
  mocks.listen.mockImplementation(async (_event, handler) => {
    mocks.complete = handler;
    return mocks.stop;
  });
});

describe('menu bar refresh', () => {
  it('waits for the actual reads to finish and then removes its listener', async () => {
    let finished = false;
    const job = refreshTray().then(() => { finished = true; });
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('tray_panel_action', { action: 'refresh', taskId: null }));
    expect(mocks.listen.mock.invocationCallOrder[0]).toBeLessThan(mocks.invoke.mock.invocationCallOrder[0]);
    expect(finished).toBe(false);
    expect(mocks.stop).not.toHaveBeenCalled();
    mocks.complete({ payload: null });
    await job;
    expect(finished).toBe(true);
    expect(mocks.stop).toHaveBeenCalledOnce();
  });

  it('reports read failures and releases the listener for the next attempt', async () => {
    const job = refreshTray();
    const outcome = expect(job).rejects.toBe('Codex: read failed');
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalled());
    mocks.complete({ payload: 'Codex: read failed' });
    await outcome;
    expect(mocks.stop).toHaveBeenCalledOnce();
  });

  it('removes the listener when sending the refresh request fails', async () => {
    mocks.invoke.mockRejectedValueOnce('window unavailable');
    await expect(refreshTray()).rejects.toBe('window unavailable');
    expect(mocks.stop).toHaveBeenCalledOnce();
  });

  it('keeps the request unsent when the result listener cannot be registered', async () => {
    mocks.listen.mockRejectedValueOnce('event connection failed');
    await expect(refreshTray()).rejects.toBe('event connection failed');
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
