import type { Agent, AgentStatus, CliInfo } from './api';
import type { TurnPrefs } from './composerStatus';
import { preferencesSnapshot, saveConfig, saveViewState } from './storage';
import type { TaskMeta } from './taskMeta';

// Rebuildable CLI discoveries stay in memory. Persistence belongs to the Rust stores.
let contextWindows: Record<string, number> = {};
let agentStatus: AgentStatus[] | null = null;
const infos: Record<Agent, CliInfo> = {
  claude: { models: [], usage: null }, codex: { models: [], usage: null }, pi: { models: [], usage: null },
};

export const loadContextWindows = () => contextWindows;
export const saveContextWindows = (windows: Record<string, number>) => { contextWindows = windows; };
export const loadSidebarCollapsed = () => preferencesSnapshot().state.sidebarCollapsed;
export const saveSidebarCollapsed = (collapsed: boolean) => saveViewState({ sidebarCollapsed: collapsed });
export const loadSidebarWidth = () => preferencesSnapshot().state.sidebarWidth;
export const saveSidebarWidth = (width: number) => saveViewState({ sidebarWidth: width });
export const loadTaskMeta = () => preferencesSnapshot().state.taskMeta;
export const saveTaskMeta = (meta: TaskMeta) => saveViewState({ taskMeta: meta });
export const loadExtraProjects = () => preferencesSnapshot().config.projects;
export const saveExtraProjects = (cwds: string[]) => saveConfig({ projects: cwds });
export const loadProjectOrder = () => preferencesSnapshot().state.projectOrder;
export const saveProjectOrder = (cwds: string[]) => saveViewState({ projectOrder: cwds });
export function loadPrefsFor(agent: Agent): TurnPrefs {
  const prefs = preferencesSnapshot().config.agents[agent];
  return { model: prefs.model || null, effort: prefs.effort || null, permissionMode: prefs.permission_mode as TurnPrefs['permissionMode'] };
}
export const savePrefsFor = (agent: Agent, prefs: TurnPrefs) => saveConfig({
  agents: { ...preferencesSnapshot().config.agents, [agent]: { model: prefs.model ?? '', effort: prefs.effort ?? '', permission_mode: prefs.permissionMode } },
});
export const loadInfoFor = (agent: Agent) => infos[agent];
export const saveInfoFor = (agent: Agent, info: CliInfo) => { infos[agent] = info; };
export const loadNewTaskAgent = () => preferencesSnapshot().config.new_task_agent;
export const saveNewTaskAgent = (agent: Agent) => saveConfig({ new_task_agent: agent });
export const areProjectsSeeded = () => preferencesSnapshot().state.projectsSeeded;
export const markProjectsSeeded = () => saveViewState({ projectsSeeded: true });
export const loadAgentStatus = () => agentStatus;
export const saveAgentStatus = (agents: AgentStatus[]) => { agentStatus = agents; };
