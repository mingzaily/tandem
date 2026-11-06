import { describe, expect, it } from 'vitest';
import { INITIAL_REMOTE_FORM, remoteFormDirty, remoteFormReducer } from './remoteSettings';

const savedUrl = 'wss://relay.example.com/ws';
const loaded = () => remoteFormReducer(INITIAL_REMOTE_FORM, { type: 'received', relayUrl: savedUrl });

describe('remote settings drafts', () => {
  it('keeps an address empty while connection events refresh the saved settings', () => {
    const cleared = remoteFormReducer(loaded(), { type: 'editUrl', value: '' });
    const refreshed = remoteFormReducer(cleared, { type: 'received', relayUrl: savedUrl });
    expect(refreshed.relayUrl).toBe('');
    expect(remoteFormDirty(refreshed)).toBe(true);
  });

  it('retains an unsaved token through refreshes and only clears it on confirmed save or discard', () => {
    const typed = remoteFormReducer(loaded(), { type: 'editToken', value: 'new-token' });
    const refreshed = remoteFormReducer(typed, { type: 'received', relayUrl: savedUrl });
    expect(refreshed.hostToken).toBe('new-token');
    expect(remoteFormDirty(refreshed)).toBe(true);
    for (const type of ['saved', 'discarded'] as const) {
      const committed = remoteFormReducer(refreshed, { type, relayUrl: savedUrl });
      expect(committed.hostToken).toBe('');
      expect(remoteFormDirty(committed)).toBe(false);
    }
  });

  it('adopts external settings when pristine and preserves a local draft while rebasing', () => {
    const externalUrl = 'wss://other.example.com/ws';
    expect(remoteFormReducer(loaded(), { type: 'received', relayUrl: externalUrl }).relayUrl).toBe(externalUrl);
    const edited = remoteFormReducer(loaded(), { type: 'editUrl', value: 'wss://draft.example.com/ws' });
    const refreshed = remoteFormReducer(edited, { type: 'received', relayUrl: externalUrl });
    expect(refreshed.relayUrl).toBe('wss://draft.example.com/ws');
    expect(refreshed.savedRelayUrl).toBe(externalUrl);
  });

  it('matches the backend trimming rules when deciding whether to submit', () => {
    const spaced = remoteFormReducer(loaded(), { type: 'editUrl', value: `  ${savedUrl}  ` });
    expect(remoteFormDirty(spaced)).toBe(false);
    expect(remoteFormDirty(remoteFormReducer(spaced, { type: 'editToken', value: '   ' }))).toBe(false);
  });
});
