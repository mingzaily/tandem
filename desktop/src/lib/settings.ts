import { getCurrentWindow } from '@tauri-apps/api/window';

export type ThemeSetting = 'system' | 'light' | 'dark';
export type LanguageSetting = 'system' | 'zh' | 'en';

export interface AppSettings {
  theme: ThemeSetting;
  language: LanguageSetting;
  uiFontSize: number;
  sendWithCmdEnter: boolean;
  translucentSidebar: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  language: 'system',
  uiFontSize: 14,
  sendWithCmdEnter: false,
  translucentSidebar: true,
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
  root.classList.toggle('dark', settings.theme === 'dark' || (settings.theme === 'system' && systemDark().matches));
  root.toggleAttribute('data-opaque-sidebar', !settings.translucentSidebar);
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
