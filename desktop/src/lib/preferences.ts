import type { Agent, AgentStatus, CliInfo } from './api';
import { DEFAULT_PREFS, type TurnPrefs } from './composerStatus';
import { EMPTY_TASK_META, type TaskMeta } from './taskMeta';

const PREFS_KEY = 'tandem.turnPrefs';
const CLI_INFO_KEY = 'tandem.cliInfo';
const CONTEXT_WINDOWS_KEY = 'tandem.contextWindows';
const SIDEBAR_KEY = 'tandem.sidebar';
const AGENT_STATUS_KEY = 'tandem.agentStatus';
const PROJECTS_SEEDED_KEY = 'tandem.projectsSeeded';
const PREFS_KEYS: Record<Agent, string> = { claude: PREFS_KEY, codex: 'tandem.codexPrefs', pi: 'tandem.piPrefs' };
const INFO_KEYS: Record<Agent, string> = { claude: CLI_INFO_KEY, codex: 'tandem.codexInfo', pi: 'tandem.piInfo' };
const NEW_TASK_AGENT_KEY = 'tandem.newTaskAgent';
const SIDEBAR_WIDTH_KEY = 'tandem.sidebarWidth';
const TASK_META_KEY = 'tandem.taskMeta';
const EXTRA_PROJECTS_KEY = 'tandem.extraProjects';
const PROJECT_ORDER_KEY = 'tandem.projectOrder';

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

export const loadContextWindows = () => load<Record<string, number>>(CONTEXT_WINDOWS_KEY, {});
export const saveContextWindows = (windows: Record<string, number>) => save(CONTEXT_WINDOWS_KEY, windows);
export const loadSidebarCollapsed = () => load<{ collapsed: boolean }>(SIDEBAR_KEY, { collapsed: false }).collapsed;
export const saveSidebarCollapsed = (collapsed: boolean) => save(SIDEBAR_KEY, { collapsed });
export const loadSidebarWidth = (fallback: number) => load<{ width: number }>(SIDEBAR_WIDTH_KEY, { width: fallback }).width;
export const saveSidebarWidth = (width: number) => save(SIDEBAR_WIDTH_KEY, { width });
export const loadTaskMeta = () => load<TaskMeta>(TASK_META_KEY, EMPTY_TASK_META);
export const saveTaskMeta = (meta: TaskMeta) => save(TASK_META_KEY, meta);
export const loadExtraProjects = () => load<{ cwds: string[] }>(EXTRA_PROJECTS_KEY, { cwds: [] }).cwds;
export const saveExtraProjects = (cwds: string[]) => save(EXTRA_PROJECTS_KEY, { cwds });
export const loadProjectOrder = () => load<{ cwds: string[] }>(PROJECT_ORDER_KEY, { cwds: [] }).cwds;
export const saveProjectOrder = (cwds: string[]) => save(PROJECT_ORDER_KEY, { cwds });
export const loadPrefsFor = (agent: Agent) => load<TurnPrefs>(PREFS_KEYS[agent], DEFAULT_PREFS);
export const savePrefsFor = (agent: Agent, prefs: TurnPrefs) => save(PREFS_KEYS[agent], prefs);
export const loadInfoFor = (agent: Agent) => load<CliInfo>(INFO_KEYS[agent], { models: [], usage: null });
export const saveInfoFor = (agent: Agent, info: CliInfo) => save(INFO_KEYS[agent], info);
export const loadNewTaskAgent = () => load<{ agent: Agent }>(NEW_TASK_AGENT_KEY, { agent: 'claude' }).agent;
export const saveNewTaskAgent = (agent: Agent) => save(NEW_TASK_AGENT_KEY, { agent });
export const areProjectsSeeded = () => load<{ seeded: boolean }>(PROJECTS_SEEDED_KEY, { seeded: false }).seeded;
export const markProjectsSeeded = () => save(PROJECTS_SEEDED_KEY, { seeded: true });
export const loadAgentStatus = () => load<{ agents: AgentStatus[] | null }>(AGENT_STATUS_KEY, { agents: null }).agents;
export const saveAgentStatus = (agents: AgentStatus[]) => save(AGENT_STATUS_KEY, { agents });
