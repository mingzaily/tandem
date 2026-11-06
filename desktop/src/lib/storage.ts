import { migratePreferences, onPreferencesChanged, previewPreferences, readPreferences, setSystemLanguage, updatePreferences, type Agent } from './api';
import type { TaskMeta } from './taskMeta';

export interface StoredTurnPrefs { model: string; effort: string; permission_mode: string }
export interface Config {
  theme: 'system' | 'light' | 'dark';
  light_theme: string;
  dark_theme: string;
  language: 'system' | 'zh' | 'en';
  ui_font_size: number;
  send_with_cmd_enter: boolean;
  translucent_sidebar: boolean;
  keep_in_menu_bar: boolean;
  notify_when_done: boolean;
  conversation_dir: string;
  past_conversation_dirs: string[];
  projects: string[];
  new_task_agent: Agent;
  agents: Record<Agent, StoredTurnPrefs>;
}
export interface ViewState {
  taskMeta: TaskMeta;
  projectOrder: string[];
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  projectsSeeded: boolean;
  migrationVersion: number;
}
export interface PreferencesSnapshot {
  config: Config;
  state: ViewState;
  revision: number;
  migrationPending: boolean;
  errors: string[];
}
declare global { interface Window { __TANDEM_PREFERENCES__?: PreferencesSnapshot } }

const prefs = (): StoredTurnPrefs => ({ model: '', effort: '', permission_mode: 'ask' });
export const DEFAULT_SNAPSHOT: PreferencesSnapshot = {
  config: {
    theme: 'system', light_theme: 'tandem-light', dark_theme: 'tandem-dark', language: 'system', ui_font_size: 14,
    send_with_cmd_enter: false, translucent_sidebar: true, keep_in_menu_bar: true, notify_when_done: true,
    conversation_dir: '', past_conversation_dirs: [], projects: [], new_task_agent: 'claude',
    agents: { claude: prefs(), codex: prefs(), pi: prefs() },
  },
  state: { taskMeta: { pins: [], archived: [], titles: {} }, projectOrder: [], sidebarCollapsed: false, sidebarWidth: 260, projectsSeeded: false, migrationVersion: 0 },
  revision: 0, migrationPending: false, errors: [],
};

type Patch = Record<string, unknown>;
type Change = { target: 'config' | 'state'; patch: Patch };
const isObject = (value: unknown): value is Patch => value !== null && typeof value === 'object' && !Array.isArray(value);

/** JSON merge patches preserve unrelated changes and remove deleted local aliases. */
export function difference(before: unknown, after: unknown): unknown {
  if (JSON.stringify(before) === JSON.stringify(after)) return undefined;
  if (!isObject(before) || !isObject(after)) return after;
  const patch: Patch = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const value = key in after ? difference(before[key], after[key]) : null;
    if (value !== undefined) patch[key] = value;
  }
  return patch;
}

export function merge<T>(current: T, patch: unknown): T {
  if (!isObject(current) || !isObject(patch)) return patch as T;
  const result: Patch = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete result[key];
    else result[key] = merge(result[key], value);
  }
  return result as T;
}

/** Unchanged project arrays retain their identity, so a theme or pin update does not rescan CLIs. */
function share<T>(before: T, after: T): T {
  if (JSON.stringify(before) === JSON.stringify(after)) return before;
  if (!isObject(before) || !isObject(after)) return after;
  return Object.fromEntries(Object.entries(after).map(([key, value]) => [key, share(before[key], value)])) as T;
}

/** The injected snapshot is the only synchronous source on normal startup, in every window. */
export class PreferencesMemory {
  private canonical: PreferencesSnapshot;
  private snapshot: PreferencesSnapshot;
  private pending: Change[] = [];
  private listeners = new Set<() => void>();
  private failure: string | null = null;
  private saving = false;

  constructor(initial: PreferencesSnapshot, private write: (change: Change) => Promise<PreferencesSnapshot>) {
    this.canonical = initial;
    this.snapshot = initial;
  }
  get = () => this.snapshot;
  confirmed = () => this.canonical;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  accept = (snapshot: PreferencesSnapshot) => {
    if (snapshot.revision < this.canonical.revision) return;
    this.canonical = share(this.canonical, snapshot);
    this.rebuild();
  };
  report = (error: unknown) => { this.failure = String(error); this.rebuild(); };
  clearFailure = () => { this.failure = null; this.rebuild(); };

  change(target: Change['target'], next: Patch) {
    const patch = difference(this.snapshot[target], { ...this.snapshot[target], ...next }) as Patch | undefined;
    if (!patch || Object.keys(patch).length === 0) return;
    this.pending.push({ target, patch });
    // Callers already update their React state. Do not notify synchronously from their setState
    // updater; the queued write and incoming backend events notify outside that render.
    this.rebuild(false);
    void this.flush();
  }

  private rebuild(notify = true) {
    this.snapshot = this.pending.reduce((snapshot, { target, patch }) => ({ ...snapshot, [target]: merge(snapshot[target], patch) }), this.canonical);
    if (this.failure) this.snapshot = { ...this.snapshot, errors: [...this.snapshot.errors, this.failure] };
    if (notify) this.listeners.forEach((listener) => listener());
  }
  private async flush() {
    if (this.saving) return;
    this.saving = true;
    while (this.pending.length > 0) {
      const change = this.pending[0];
      try {
        const saved = await this.write(change);
        if (saved.revision >= this.canonical.revision) this.canonical = share(this.canonical, saved);
        this.failure = null;
      } catch (error) {
        this.failure = String(error);
      }
      this.pending.shift();
      this.rebuild();
    }
    this.saving = false;
  }
}

const initial = typeof window === 'undefined' ? DEFAULT_SNAPSHOT : window.__TANDEM_PREFERENCES__ ?? DEFAULT_SNAPSHOT;
export const preferencesMemory = new PreferencesMemory(initial, ({ target, patch }) => updatePreferences(target, patch));
export const preferencesSnapshot = preferencesMemory.get;
export const subscribePreferences = preferencesMemory.subscribe;
export const saveConfig = (patch: Patch) => preferencesMemory.change('config', patch);
export const saveViewState = (patch: Patch) => preferencesMemory.change('state', patch);

// Kept in the old WebView for one version. Normal reads/writes never use localStorage.
const LEGACY_KEYS = [
  'tandem.settings', 'tandem.turnPrefs', 'tandem.codexPrefs', 'tandem.piPrefs', 'tandem.newTaskAgent',
  'tandem.taskMeta', 'tandem.extraProjects', 'tandem.projectOrder', 'tandem.sidebar', 'tandem.sidebarWidth', 'tandem.projectsSeeded',
];
export function legacyPreferences(): Record<string, string> {
  return Object.fromEntries(LEGACY_KEYS.flatMap((key) => { const value = localStorage.getItem(key); return value === null ? [] : [[key, value]]; }));
}
async function runMigration(legacy: Record<string, string>) {
  try {
    preferencesMemory.accept(await migratePreferences(legacy));
    preferencesMemory.clearFailure();
  } catch (error) { preferencesMemory.report(error); }
}
export async function retryMigration() {
  try { await runMigration(legacyPreferences()); } catch (error) { preferencesMemory.report(error); }
}

export async function connectPreferences(isMain: boolean) {
  // Subscribe before fetching, closing the race between window creation and listener setup.
  await onPreferencesChanged(preferencesMemory.accept);
  preferencesMemory.accept(await readPreferences());
  if (isMain) {
    const updateLanguage = () => setSystemLanguage(navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en');
    await updateLanguage();
    window.addEventListener('languagechange', () => { void updateLanguage().catch((error) => preferencesMemory.report(error)); });
    if (preferencesSnapshot().migrationPending) {
      try {
        const legacy = legacyPreferences();
        preferencesMemory.accept(await previewPreferences(legacy));
        void runMigration(legacy);
      } catch (error) { preferencesMemory.report(error); }
    }
  }
}
