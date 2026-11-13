import type { StringKey } from './i18n';

/** Application bindings are shared by the handler and the settings reference. */
export const APP_SHORTCUTS = [
  { id: 'settings', key: ',', label: 'shortcutOpenSettings' },
  { id: 'newTask', key: 'n', label: 'newTask' },
  { id: 'sidebar', key: 'b', label: 'shortcutToggleSidebar' },
  { id: 'back', key: '[', label: 'shortcutBack' },
  { id: 'forward', key: ']', label: 'shortcutForward' },
] as const satisfies readonly { id: string; key: string; label: StringKey }[];

export type AppShortcutId = typeof APP_SHORTCUTS[number]['id'];
