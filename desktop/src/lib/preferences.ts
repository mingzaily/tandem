import type { CliInfo } from './api';
import { DEFAULT_PREFS, type TurnPrefs } from './composerStatus';

const PREFS_KEY = 'tandem.turnPrefs';
const CLI_INFO_KEY = 'tandem.cliInfo';
const CONTEXT_WINDOWS_KEY = 'tandem.contextWindows';
const SIDEBAR_KEY = 'tandem.sidebar';

/** Browser storage can be missing or cleared. Everything here can be lost without harm. */
function load<T>(key: string, fallback: T): T {
  try {
    const stored = localStorage.getItem(key);
    return stored ? { ...fallback, ...(JSON.parse(stored) as T) } : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Keeps working for this session.
  }
}

export const loadTurnPrefs = () => load<TurnPrefs>(PREFS_KEY, DEFAULT_PREFS);
export const saveTurnPrefs = (prefs: TurnPrefs) => save(PREFS_KEY, prefs);
export const loadCliInfo = () => load<CliInfo>(CLI_INFO_KEY, { models: [], usage: null });
export const saveCliInfo = (info: CliInfo) => save(CLI_INFO_KEY, info);
export const loadContextWindows = () => load<Record<string, number>>(CONTEXT_WINDOWS_KEY, {});
export const saveContextWindows = (windows: Record<string, number>) => save(CONTEXT_WINDOWS_KEY, windows);
export const loadSidebarCollapsed = () => load<{ collapsed: boolean }>(SIDEBAR_KEY, { collapsed: false }).collapsed;
export const saveSidebarCollapsed = (collapsed: boolean) => save(SIDEBAR_KEY, { collapsed });
