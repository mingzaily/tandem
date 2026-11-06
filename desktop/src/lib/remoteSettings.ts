export interface RemoteSettingsForm {
  relayUrl: string;
  hostToken: string;
  savedRelayUrl: string | null;
}

export const INITIAL_REMOTE_FORM: RemoteSettingsForm = { relayUrl: '', hostToken: '', savedRelayUrl: null };

export type RemoteFormAction =
  | { type: 'received'; relayUrl: string }
  | { type: 'editUrl' | 'editToken'; value: string }
  | { type: 'saved' | 'discarded'; relayUrl: string };

export function remoteFormDirty(form: RemoteSettingsForm): boolean {
  return form.savedRelayUrl !== null && (form.relayUrl.trim() !== form.savedRelayUrl || form.hostToken.trim().length > 0);
}

export function remoteFormReducer(form: RemoteSettingsForm, action: RemoteFormAction): RemoteSettingsForm {
  switch (action.type) {
    case 'received':
      // Link status updates must preserve edits, including a deliberately cleared address.
      return remoteFormDirty(form)
        ? { ...form, savedRelayUrl: action.relayUrl }
        : { relayUrl: action.relayUrl, hostToken: '', savedRelayUrl: action.relayUrl };
    case 'editUrl':
      return { ...form, relayUrl: action.value };
    case 'editToken':
      return { ...form, hostToken: action.value };
    case 'saved':
    case 'discarded':
      return { relayUrl: action.relayUrl, hostToken: '', savedRelayUrl: action.relayUrl };
  }
}
