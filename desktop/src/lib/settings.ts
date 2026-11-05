import { getCurrentWindow } from '@tauri-apps/api/window';

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
  conversationDir: null,
  pastConversationDirs: [],
};
export const MIN_UI_FONT_SIZE = 12;
export const MAX_UI_FONT_SIZE = 18;

const SETTINGS_KEY = 'tandem.settings';
const SCALED_SIZES: [string, number][] = [
  ...[10, 11, 12, 13, 14, 15, 16, 18, 20, 24, 28].map((size): [string, number] => [String(size), size]),
  ['xs', 12],
  ['sm', 14],
];

export function loadSettings(): AppSettings {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    return stored ? { ...DEFAULT_SETTINGS, ...(JSON.parse(stored) as Partial<AppSettings>) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: AppSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Keeps working for this session.
  }
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
  getCurrentWindow()
    .setTheme(settings.theme === 'system' ? null : settings.theme)
    .catch(console.error);
}

export function watchSystemTheme(current: () => AppSettings) {
  systemDark().addEventListener('change', () => applySettings(current()));
}
