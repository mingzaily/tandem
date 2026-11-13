import { onPreferencesChanged, readPreferences, setSystemLanguage, updatePreferences, type Agent } from './api';
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
  auto_update: boolean;
  update_check_interval_hours: number;
  debug_log: boolean;
  conversation_dir: string;
  past_conversation_dirs: string[];
  projects: string[];
  new_task_agent: Agent;
  sidebar_group_by_cli: boolean;
  sidebar_sort: 'time' | 'type' | 'priority';
  hidden_task_agents: Agent[];
  agents: Record<Agent, StoredTurnPrefs>;
}
export interface ViewState {
  taskMeta: TaskMeta;
  projectOrder: string[];
  pinnedProjects: string[];
  collapsedSidebarGroups: string[];
  unreadTasks: string[];
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  projectsSeeded: boolean;
}
export interface PreferencesSnapshot {
  config: Config;
  state: ViewState;
  revision: number;
  errors: string[];
}
declare global { interface Window { __TANDEM_PREFERENCES__?: PreferencesSnapshot } }

const prefs = (): StoredTurnPrefs => ({ model: '', effort: '', permission_mode: 'ask' });
export const DEFAULT_SNAPSHOT: PreferencesSnapshot = {
  config: {
    theme: 'system', light_theme: 'tandem-light', dark_theme: 'tandem-dark', language: 'system', ui_font_size: 14,
    send_with_cmd_enter: false, translucent_sidebar: true, keep_in_menu_bar: true, notify_when_done: true,
    auto_update: false, update_check_interval_hours: 6, debug_log: false,
    conversation_dir: '', past_conversation_dirs: [], projects: [], new_task_agent: 'claude', sidebar_group_by_cli: false, sidebar_sort: 'time', hidden_task_agents: [],
    agents: { claude: prefs(), codex: prefs(), pi: prefs() },
  },
  state: { taskMeta: { pins: [], archived: [], titles: {} }, projectOrder: [], pinnedProjects: [], collapsedSidebarGroups: [], unreadTasks: [], sidebarCollapsed: false, sidebarWidth: 260, projectsSeeded: false },
  revision: 0, errors: [],
};

type Patch = Record<string, unknown>;
type Change = { target: 'config' | 'state'; patch: Patch };
interface PinChange { added: string[]; removed: string[] }
type PendingChange = Change & { pins?: PinChange };
interface Operation { run: () => Promise<PreferencesSnapshot>; resolve: () => void; reject: (error: unknown) => void }
type PendingWrite = PendingChange | Operation;
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
  private pending: PendingWrite[] = [];
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

  change(target: Change['target'], next: Patch) {
    const patch = difference(this.snapshot[target], { ...this.snapshot[target], ...next }) as Patch | undefined;
    if (!patch || Object.keys(patch).length === 0) return;
    const pins = target === 'state' && isObject(patch.taskMeta) && Array.isArray(patch.taskMeta.pins)
      ? { added: (patch.taskMeta.pins as string[]).filter((id) => !this.snapshot.state.taskMeta.pins.includes(id)),
          removed: this.snapshot.state.taskMeta.pins.filter((id) => !(patch.taskMeta as { pins: string[] }).pins.includes(id)) }
      : undefined;
    this.pending.push({ target, patch, pins });
    // Callers already update their React state. Do not notify synchronously from their setState
    // updater; the queued write and incoming backend events notify outside that render.
    this.rebuild(false);
    void this.flush();
  }

  /** Native archive operations share the preference writer so queued pins keep their intent. */
  async operation(run: () => Promise<PreferencesSnapshot>): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.pending.push({ run, resolve, reject });
      void this.flush();
    });
  }

  private patch(change: PendingChange, snapshot: PreferencesSnapshot): Patch {
    if (!change.pins) return change.patch;
    const { added, removed } = change.pins;
    const pins = [...added, ...snapshot.state.taskMeta.pins.filter((id) => !added.includes(id) && !removed.includes(id))];
    return { ...change.patch, taskMeta: { ...(change.patch.taskMeta as Patch), pins } };
  }

  private rebuild(notify = true) {
    this.snapshot = this.pending.reduce((snapshot, change) => 'run' in change ? snapshot
      : { ...snapshot, [change.target]: merge(snapshot[change.target], this.patch(change, snapshot)) }, this.canonical);
    if (this.failure) this.snapshot = { ...this.snapshot, errors: [...this.snapshot.errors, this.failure] };
    if (notify) this.listeners.forEach((listener) => listener());
  }
  private async flush() {
    if (this.saving) return;
    this.saving = true;
    while (this.pending.length > 0) {
      const change = this.pending[0];
      try {
        const saved = 'run' in change ? await change.run() : await this.write({ target: change.target, patch: this.patch(change, this.canonical) });
        if (saved.revision >= this.canonical.revision) this.canonical = share(this.canonical, saved);
        this.failure = null;
        if ('run' in change) change.resolve();
      } catch (error) {
        if ('run' in change) change.reject(error);
        else this.failure = String(error);
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

export async function connectPreferences(isMain: boolean) {
  // Subscribe before fetching, closing the race between window creation and listener setup.
  await onPreferencesChanged(preferencesMemory.accept);
  preferencesMemory.accept(await readPreferences());
  if (isMain) {
    const updateLanguage = () => setSystemLanguage(navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en');
    await updateLanguage();
    window.addEventListener('languagechange', () => { void updateLanguage().catch((error) => preferencesMemory.report(error)); });
  }
}
