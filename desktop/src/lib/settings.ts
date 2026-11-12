import { getCurrentWindow } from '@tauri-apps/api/window';
import { preferencesMemory, preferencesSnapshot, saveConfig, type Config } from './storage';

export type ThemeSetting = 'system' | 'light' | 'dark';
export type LanguageSetting = 'system' | 'zh' | 'en';

export interface ThemeChoice {
  id: string;
  name: string;
  isDark: boolean;
  /** Only the Tandem themes let the window material show through the sidebar. */
  isTranslucent: boolean;
}

export const LIGHT_THEMES: ThemeChoice[] = [
  { id: 'tandem-light', name: 'Tandem', isDark: false, isTranslucent: true },
  { id: 'default-light', name: 'Plain', isDark: false, isTranslucent: false },
  { id: 'atom-one-light', name: 'Atom One Light', isDark: false, isTranslucent: false },
  { id: 'solarized-light', name: 'Solarized Light', isDark: false, isTranslucent: false },
];

export const DARK_THEMES: ThemeChoice[] = [
  { id: 'tandem-dark', name: 'Tandem', isDark: true, isTranslucent: true },
  { id: 'default-dark', name: 'Plain', isDark: true, isTranslucent: false },
  { id: 'one-dark-pro', name: 'One Dark Pro', isDark: true, isTranslucent: false },
  { id: 'github-dark', name: 'GitHub Dark', isDark: true, isTranslucent: false },
  { id: 'monokai-pro', name: 'Monokai Pro', isDark: true, isTranslucent: false },
  { id: 'eclipse', name: 'Eclipse', isDark: true, isTranslucent: false },
  { id: 'material-ocean', name: 'Material Ocean', isDark: true, isTranslucent: false },
];

export interface AppSettings {
  theme: ThemeSetting;
  lightTheme: string;
  darkTheme: string;
  language: LanguageSetting;
  uiFontSize: number;
  sendWithCmdEnter: boolean;
  translucentSidebar: boolean;
  keepInMenuBar: boolean;
  notifyWhenDone: boolean;
  autoUpdate: boolean;
  updateCheckIntervalHours: number;
  /** Detailed local diagnostic log; errors are logged either way. */
  debugLog: boolean;
  /** Where new conversations go. Null means the default under `~/.tandem`. */
  conversationDir: string | null;
  /** Earlier choices, whose conversations stay listed after the setting changes. */
  pastConversationDirs: string[];
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  lightTheme: 'tandem-light',
  darkTheme: 'tandem-dark',
  language: 'system',
  uiFontSize: 14,
  sendWithCmdEnter: false,
  translucentSidebar: true,
  keepInMenuBar: true,
  notifyWhenDone: true,
  autoUpdate: false,
  updateCheckIntervalHours: 6,
  debugLog: false,
  conversationDir: null,
  pastConversationDirs: [],
};
export const MIN_UI_FONT_SIZE = 12;
export const MAX_UI_FONT_SIZE = 18;

const SCALED_SIZES: [string, number][] = [
  ...[10, 11, 12, 13, 14, 15, 16, 18, 20, 24, 28].map((size): [string, number] => [String(size), size]),
  ['xs', 12],
  ['sm', 14],
];

export function loadSettings(): AppSettings {
  return settingsFromConfig(preferencesSnapshot().config);
}

/** Window appearance follows accepted Rust snapshots, including after a failed save. */
export const loadConfirmedSettings = () => settingsFromConfig(preferencesMemory.confirmed().config);

function settingsFromConfig(config: Config): AppSettings {
  return {
    theme: config.theme, lightTheme: config.light_theme, darkTheme: config.dark_theme, language: config.language,
    uiFontSize: config.ui_font_size, sendWithCmdEnter: config.send_with_cmd_enter, translucentSidebar: config.translucent_sidebar,
    keepInMenuBar: config.keep_in_menu_bar, notifyWhenDone: config.notify_when_done, conversationDir: config.conversation_dir || null,
    pastConversationDirs: config.past_conversation_dirs,
    autoUpdate: config.auto_update, updateCheckIntervalHours: config.update_check_interval_hours, debugLog: config.debug_log,
  };
}

export function saveSettings(settings: AppSettings) {
  saveConfig({
    theme: settings.theme, light_theme: settings.lightTheme, dark_theme: settings.darkTheme, language: settings.language,
    ui_font_size: settings.uiFontSize, send_with_cmd_enter: settings.sendWithCmdEnter, translucent_sidebar: settings.translucentSidebar,
    keep_in_menu_bar: settings.keepInMenuBar, notify_when_done: settings.notifyWhenDone, conversation_dir: settings.conversationDir ?? '',
    past_conversation_dirs: settings.pastConversationDirs,
    auto_update: settings.autoUpdate, update_check_interval_hours: settings.updateCheckIntervalHours, debug_log: settings.debugLog,
  });
}

/** Sizes are tokens, so scaling the tokens scales the whole interface from one number. */
export function scaledFontTokens(uiFontSize: number): [string, string][] {
  const scale = uiFontSize / DEFAULT_SETTINGS.uiFontSize;
  return SCALED_SIZES.map(([name, size]) => [`--text-${name}`, `${Math.round(size * scale)}px`]);
}

const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)');

export function applySettings(settings: AppSettings) {
  const root = document.documentElement;
  const isDark = settings.theme === 'dark' || (settings.theme === 'system' && systemDark().matches);
  root.classList.toggle('dark', isDark);
  const choices = isDark ? DARK_THEMES : LIGHT_THEMES;
  const theme = choices.find(({ id }) => id === (isDark ? settings.darkTheme : settings.lightTheme)) ?? choices[0];
  root.dataset.theme = theme.id;
  root.toggleAttribute('data-opaque-sidebar', !settings.translucentSidebar || !theme.isTranslucent);
  for (const [name, value] of scaledFontTokens(settings.uiFontSize)) root.style.setProperty(name, value);
  root.style.setProperty('--app-ui-font-size', `${settings.uiFontSize}px`);
  // The window's own material and controls follow this too, not only the page.
  return getCurrentWindow()
    .setTheme(settings.theme === 'system' ? null : settings.theme)
    .catch(console.error);
}

export function watchSystemTheme(current: () => AppSettings) {
  const onChange = () => applySettings(current());
  systemDark().addEventListener('change', onChange);
  return () => systemDark().removeEventListener('change', onChange);
}
