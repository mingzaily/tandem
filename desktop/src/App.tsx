import { getVersion } from '@tauri-apps/api/app';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BrandLockup } from './components/BrandLockup';
import { AgentMark } from './components/AgentMark';
import { AGENT_NAMES } from './lib/modelRows';
import { Composer } from './components/Composer';
import { ConversationLayout } from './components/ConversationLayout';
import { BranchPill, ComposerFooter, ModelSelect, PermissionSelect, ProjectSelect } from './components/ComposerControls';
import { HomeSuggestions } from './components/HomeSuggestions';
import { PermissionPrompt } from './components/PermissionPrompt';
import { QuestionPrompt } from './components/QuestionPrompt';
import { RunningStatus } from './components/RunningStatus';
import { QueuePauseStatus } from './components/QueuePauseStatus';
import { ComposerStatusRow } from './components/ComposerStatusRow';
import { RemoteAccessIndicator, RemoteAccessNotice, RemoteRevokeDialog } from './components/RemoteAccessNotice';
import { SettingsView, type ArchivedGroup } from './components/SettingsView';
import { Sidebar } from './components/Sidebar';
import { TaskMenu, type TaskMenuAnchor } from './components/TaskMenu';
import { TaskHeaderActions } from './components/TaskHeaderActions';
import { markUnread, type SidebarOptions } from './lib/sidebarModel';
import { TitleBarActions } from './components/TitleBarActions';
import {
  answerRequest,
  appReady,
  cancelTurn,
  completeTrayRefresh,
  createConversationDir,
  defaultConversationDir,
  discoverProjects,
  externalWriters,
  gitBranch,
  generateTaskTitle,
  renameNativeTask,
  listCodexTasks,
  listPiTasks,
  notifyUser,
  updateAppBadge,
  onTrayOpenSettings,
  onTrayOpenTask,
  onTrayPanelOpened,
  onTrayRefresh,
  listTasks,
  pickProject,
  readCodexInfo,
  readPiInfo,
  readCliInfo,
  readTask,
  onRemoteTurn,
  remoteRevoke,
  sendTurn,
  enqueueTurn,
  NO_ACTIVE_TURN,
  steerTurn,
  steerQueuedTurn,
  reorderQueuedTurn,
  resumeQueue,
  editQueuedTurn,
  listQueues,
  onQueueChanged,
  onQueueError,
  onQueuedTurn,
  setQueueLock,
  taskStamp,
  updateTray,
  type Agent,
  type Attachment,
  type CliInfo,
  type Decision,
  type ExternalWriter,
  type PendingRequest,
  type RemoteClient,
  type TaskContext,
  type TaskModel,
  type TaskSummary,
  type TraySource,
  type TrayWindow,
  type TraySummary,
  type TrayTask,
  type TurnEvent,
  type TaskQueue,
  type QueuedMessage,
} from './lib/api';
import { describeUsage, selectedModel, sessionPermissionMode, taskPreferences, usageExpired, titleOptions, turnOptions, type PermissionMode, type TurnPrefs } from './lib/composerStatus';
import type { ModelReadState } from './lib/modelEffort';
import { t } from './lib/i18n';
import { clearTaskPreviews, taskListWithPreviews, type TaskPreviews } from './lib/taskList';
import { attentionTaskCount, shouldMarkUnread } from './lib/notifications';
import { emptyRateHistory, recordSpeed, type RateHistory } from './lib/tokenRate';
import { deriveInputHistory } from './lib/recallInput';
import { applyTurnEvent, buildItems, CONVERSATION_CWD, historyBeforeLiveTurn, groupRoot, isUnder, lastEditablePrompt, projectName, turnStatus, withTurnFailures, type TurnFailure, type Item } from './lib/items';
import { canGoBack, canGoForward, currentEntry, goBack, goForward, pushEntry, replaceEntry, startHistory } from './lib/navHistory';
import {
  areProjectsSeeded,
  loadContextWindows,
  loadExtraProjects,
  loadProjectOrder,
  loadSidebarCollapsed,
  loadSidebarWidth,
  loadTaskMeta,
  loadInfoFor,
  loadNewTaskAgent,
  loadPrefsFor,
  saveInfoFor,
  saveNewTaskAgent,
  savePrefsFor,
  markProjectsSeeded,
  saveContextWindows,
  saveExtraProjects,
  saveProjectOrder,
  saveSidebarCollapsed,
  saveSidebarWidth,
  saveTaskMeta,
} from './lib/preferences';

import { loadSettings, saveSettings, type AppSettings } from './lib/settings';
import { preferencesSnapshot, saveConfig, saveViewState, subscribePreferences } from './lib/storage';
import { acceptNativeTitle, taskTitle, unarchive, type TaskMeta } from './lib/taskMeta';
import { mergeQueue } from './lib/pendingQueue';
import { requestAnswerFailure } from './lib/requestAnswer';
import { useRemotePresence } from './lib/remotePresence';

/** Listing Codex tasks starts a helper process, so a run of window focus changes shares one. */
const CODEX_LIST_MIN_INTERVAL_MS = 30_000;

/** Only reads a few small files, so this is cheap enough to do while the window is in use. */
const WRITER_POLL_MS = 5000;
/**
 * Plan usage moves with work done elsewhere too. A finished turn and an opened panel read it again
 * when the last reading is older than this, as the reference throttles its own (3 minutes).
 */
const USAGE_STALE_MS = 3 * 60_000;
const COMPACT_COMMAND = '/compact';
const HIDDEN_POLL_EVERY = 6;
/** A task that takes a while to read reloads less often, so following it stays cheap. */
const RELOAD_COST_FACTOR = 10;
/** On first launch, projects used this recently are added, so the list does not start empty. */
const SEED_RECENT_MS = 30 * 24 * 60 * 60 * 1000;

const MessageStream = lazy(() => import('./components/MessageStream'));
const PendingQueuePanel = lazy(() => import('./components/PendingQueuePanel').then((module) => ({ default: module.PendingQueuePanel })));

type Selection = { kind: 'task'; id: string } | { kind: 'new'; cwd: string | null } | { kind: 'settings'; tab?: 'remote' };
type Notice = { text: string; isError: boolean };
type TurnProgress = { startedAt: number; outputTokens: number; activity: number; rate: RateHistory };
type QueueEdit = { taskId: string; entry: QueuedMessage; owner: string };

export function App() {
  const [claudeTasks, setClaudeTasks] = useState<TaskSummary[] | null>(null);
  const [codexTasks, setCodexTasks] = useState<TaskSummary[]>([]);
  const [piTasks, setPiTasks] = useState<TaskSummary[]>([]);
  const [taskPreviews, setTaskPreviews] = useState<TaskPreviews>({});
  const lastCodexList = useRef(0);
  // A CLI the user drives elsewhere can stay out of the lists; its login, MCP and skills still show.
  const [sessionModes, setSessionModes] = useState<Record<string, PermissionMode>>({});
  const [chosenPrefs, setChosenPrefs] = useState<Record<string, TurnPrefs>>({});
  const [nativeModels, setNativeModels] = useState<Record<string, TaskModel | null>>({});
  const [hiddenAgents, setHiddenAgents] = useState<Agent[]>(() => preferencesSnapshot().config.hidden_task_agents ?? []);
  const hiddenAgentsRef = useRef(hiddenAgents);
  hiddenAgentsRef.current = hiddenAgents;
  const tasks = useMemo(
    () =>
      claudeTasks && [...claudeTasks, ...codexTasks, ...piTasks]
        .filter((task) => !hiddenAgents.includes(task.agent))
        .sort((first, second) => second.updatedAtMs - first.updatedAtMs),
    [claudeTasks, codexTasks, piTasks, hiddenAgents],
  );
  const sidebarTasks = useMemo(
    () => taskListWithPreviews(tasks ?? [], taskPreviews).filter((task) => !hiddenAgents.includes(task.agent)),
    [tasks, taskPreviews, hiddenAgents],
  );
  const pendingTaskIds = useMemo(() => new Set(Object.keys(taskPreviews)), [taskPreviews]);
  useEffect(() => {
    if (tasks) setTaskPreviews((current) => clearTaskPreviews(current, tasks.map(({ id }) => id)));
  }, [tasks, taskPreviews]);
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const [nav, setNav] = useState(() => startHistory<Selection>({ kind: 'new', cwd: null }));
  const selection = currentEntry(nav);
  // Choosing a project, or a new task getting its id, is still the same page.
  const setSelection = useCallback((next: Selection) => setNav((current) => replaceEntry(current, next)), []);
  const navigate = useCallback((next: Selection) => setNav((current) => pushEntry(current, next)), []);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(loadSidebarCollapsed);
  const [draftFill, setDraftFill] = useState<{ text: string }>();
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [settings, setSettings] = useState(loadSettings);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const [taskMeta, setTaskMeta] = useState(loadTaskMeta);
  const taskMetaRef = useRef(taskMeta);
  taskMetaRef.current = taskMeta;
  const [extraProjects, setExtraProjects] = useState(loadExtraProjects);
  const [projectOrder, setProjectOrder] = useState(loadProjectOrder);
  const [pinnedProjects, setPinnedProjects] = useState(() => preferencesSnapshot().state.pinnedProjects);
  const [unreadTasks, setUnreadTasks] = useState(() => preferencesSnapshot().state.unreadTasks);
  const changeUnread = useCallback((change: (current: string[]) => string[]) => {
    setUnreadTasks((current) => {
      const next = change(current);
      if (next !== current) saveViewState({ unreadTasks: next });
      return next;
    });
  }, []);
  const [sidebarOptions, setSidebarOptions] = useState<SidebarOptions>(() => ({ groupByCli: preferencesSnapshot().config.sidebar_group_by_cli, sort: preferencesSnapshot().config.sidebar_sort }));
  const remotePresence = useRemotePresence();
  const [remoteRevokeTarget, setRemoteRevokeTarget] = useState<RemoteClient | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<TaskMenuAnchor | null>(null);
  const [version, setVersion] = useState('');
  const [branch, setBranch] = useState<string | null>(null);
  const [useWorktree, setUseWorktree] = useState(false);
  const [writers, setWriters] = useState<ExternalWriter[]>([]);
  const [overriddenWriters, setOverriddenWriters] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<Item[]>([]);
  const historyRef = useRef(history);
  historyRef.current = history;
  const [live, setLive] = useState<Record<string, Item[]>>({});
  const [stoppedTasks, setStoppedTasks] = useState<Set<string>>(new Set());
  const [notices, setNotices] = useState<Record<string, Notice>>({});
  const [turnFailures, setTurnFailures] = useState<Record<string, TurnFailure[]>>({});
  const [pending, setPending] = useState<Record<string, PendingRequest[]>>({});
  const answering = useRef(new Set<string>());
  const [answeringRequests, setAnsweringRequests] = useState(new Set<string>());
  const [progress, setProgress] = useState<Record<string, TurnProgress>>({});
  const [contexts, setContexts] = useState<Record<string, TaskContext>>({});
  const [contextWindows, setContextWindows] = useState(loadContextWindows);
  const [infos, setInfos] = useState<Record<Agent, CliInfo>>(() => ({
    claude: loadInfoFor('claude'),
    codex: loadInfoFor('codex'),
    pi: loadInfoFor('pi'),
  }));
  const [infoStates, setInfoStates] = useState<Record<Agent, ModelReadState>>({
    claude: { loading: false, error: null }, codex: { loading: false, error: null }, pi: { loading: false, error: null },
  });
  const infoJobs = useRef(new Map<Agent, Promise<string | null>>());
  /** When usage was last asked for or reported, which also spaces out retries after a failure. */
  const usageReadAt = useRef<Record<Agent, number>>({ claude: 0, codex: 0, pi: 0 });
  const [allPrefs, setAllPrefs] = useState<Record<Agent, TurnPrefs>>(() => ({
    claude: loadPrefsFor('claude'),
    codex: loadPrefsFor('codex'),
    pi: loadPrefsFor('pi'),
  }));
  const [newTaskAgent, setNewTaskAgent] = useState<Agent>(loadNewTaskAgent);
  const [newTaskAgents, setNewTaskAgents] = useState<Record<string, Agent>>({});
  const [newTaskError, setNewTaskError] = useState<string | null>(null);
  const [generatingTitles, setGeneratingTitles] = useState<Set<string>>(new Set());
  const titleJobs = useRef(new Set<string>());
  const [titleErrors, setTitleErrors] = useState<Record<string, string>>({});
  const [queueLoadError, setQueueLoadError] = useState<string | null>(null);
  const [queuesLoaded, setQueuesLoaded] = useState(false);
  const queueListening = useRef<Promise<unknown>>(Promise.resolve());
  const [queues, setQueues] = useState<Record<string, TaskQueue>>({});
  const [queueEdit, setQueueEdit] = useState<QueueEdit | null>(null);
  const queueEditRef = useRef<QueueEdit | null>(null);
  const turnGenerations = useRef(new Map<string, string>());
  /** Adds a message sent into a running turn to that turn's own view of itself. */
  const turnAppenders = useRef(new Map<string, (item: Item) => void>());
  /** Queues a message a running turn refused, set once the queue helpers exist. */
  const steerFallback = useRef<(agent: Agent, taskId: string, prompt: string) => void>(() => undefined);
  const updateQueue = useCallback((queue: TaskQueue) => setQueues((current) => mergeQueue(current, queue)), []);
  // A new task has a prompt preview until the native list takes over its stored metadata.
  const [draftTitles, setDraftTitles] = useState<Record<string, string>>({});
  const draftTitlesRef = useRef(draftTitles);
  draftTitlesRef.current = draftTitles;
  const [newTaskCwds, setNewTaskCwds] = useState<Record<string, string>>({});
  // The CLI has not written a new task's file yet, so its live items are all there is to show.
  const unwrittenTasks = useRef(new Set<string>());
  const selectedId = selection.kind === 'task' ? selection.id : null;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  const scanRoots = useRef<{ projects: string[]; conversations: string[] } | null>(null);
  const codexListJob = useRef<Promise<string | null> | null>(null);
  const refreshCodexTasks = useCallback((force: boolean): Promise<string | null> => {
    if (codexListJob.current) return codexListJob.current;
    if (hiddenAgentsRef.current.includes('codex')) {
      setCodexTasks([]);
      return Promise.resolve(null);
    }
    if (!scanRoots.current || (!force && Date.now() - lastCodexList.current < CODEX_LIST_MIN_INTERVAL_MS)) return Promise.resolve(null);
    lastCodexList.current = Date.now();
    const { projects, conversations } = scanRoots.current;
    const job = listCodexTasks(projects, conversations).then((next) => {
      setCodexTasks(next);
      return null;
    }).catch((error) => {
      console.error(error);
      return `Codex: ${error}`;
    }).finally(() => { codexListJob.current = null; });
    codexListJob.current = job;
    return job;
  }, []);

  const refreshTasks = useCallback(
    async (forceCodex = false) => {
      // Waits for the first-launch project list, or it would show nothing and then everything.
      if (!scanRoots.current) return [];
      const { projects, conversations } = scanRoots.current;
      // Each list paints as it arrives; callers can await the complete refresh.
      const hidden = hiddenAgentsRef.current;
      const errors = await Promise.all([
        hidden.includes('claude') ? Promise.resolve(setClaudeTasks([])).then(() => null) : listTasks([...projects, ...conversations]).then((next) => {
          setClaudeTasks(next);
          return null;
        }).catch((error) => {
          setClaudeTasks((current) => current ?? []);
          console.error(error);
          return `Claude Code: ${error}`;
        }),
        hidden.includes('pi') ? Promise.resolve(setPiTasks([])).then(() => null) : listPiTasks(projects, conversations).then((next) => {
          setPiTasks(next);
          return null;
        }).catch((error) => {
          console.error(error);
          return `Pi: ${error}`;
        }),
        refreshCodexTasks(forceCodex),
      ]);
      return errors.filter((error): error is string => error !== null);
    },
    [refreshCodexTasks],
  );

  const loadHistory = useCallback(async (agent: Agent, id: string, currentTurn: () => boolean = () => true) => {
    try {
      const { messages, context, permissionMode, modelSelection } = await readTask(agent, id);
      if (!currentTurn()) return;
      setNativeModels((current) => ({ ...current, [id]: modelSelection ?? null }));
      const mode = sessionPermissionMode(permissionMode);
      if (mode) setSessionModes((current) => current[id] === mode ? current : { ...current, [id]: mode });
      if (selectedIdRef.current === id) setHistory(buildItems(messages));
      if (context) setContexts((current) => ({ ...current, [id]: context }));
    } catch (error) {
      if (!currentTurn()) return;
      setNotices((current) => ({
        ...current,
        [id]: { text: t('loadFailed', { error: String(error) }), isError: true },
      }));
    } finally {
      if (selectedIdRef.current === id && currentTurn()) setLoadedId(id);
    }
  }, []);

  const [defaultConversationRoot, setDefaultConversationRoot] = useState('');
  const conversationRoots = useMemo(
    () =>
      [...new Set([settings.conversationDir, ...settings.pastConversationDirs, defaultConversationRoot])].filter(
        (dir): dir is string => Boolean(dir),
      ),
    [settings.conversationDir, settings.pastConversationDirs, defaultConversationRoot],
  );

  useEffect(() => {
    let isCurrent = true;
    void (async () => {
      const root = await defaultConversationDir().catch(() => '');
      if (isCurrent) setDefaultConversationRoot(root);
      if (areProjectsSeeded()) return;
      const found = await discoverProjects().catch(() => []);
      markProjectsSeeded();
      const cutoff = Date.now() - SEED_RECENT_MS;
      const recent = found.filter((project) => project.lastActiveMs >= cutoff).map((project) => project.cwd);
      if (isCurrent && recent.length > 0) {
        setExtraProjects((current) => {
          const next = [...new Set([...current, ...recent])];
          saveExtraProjects(next);
          return next;
        });
      }
    })();
    return () => {
      isCurrent = false;
    };
  }, []);

  // Scanning starts once the default folder is known, and again when the projects change.
  useEffect(() => {
    if (!defaultConversationRoot) return;
    scanRoots.current = { projects: extraProjects, conversations: conversationRoots };
    void refreshTasks(true);
  }, [defaultConversationRoot, extraProjects, conversationRoots, refreshTasks]);

  useEffect(() => {
    // Tasks can change in a terminal while Tandem is in the background.
    const onFocus = () => void refreshTasks();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshTasks]);

  // The window opens after the first render, and tasks fill in without holding it back.
  // requestAnimationFrame would not work here: a hidden webview does not fire it.
  useEffect(() => {
    void appReady();
  }, []);

  const refreshInfo = useCallback((agent: Agent) => {
    const current = infoJobs.current.get(agent);
    if (current) return current;
    usageReadAt.current[agent] = Date.now();
    setInfoStates((current) => ({ ...current, [agent]: { loading: true, error: null } }));
    const read = { claude: readCliInfo, codex: readCodexInfo, pi: readPiInfo }[agent];
    const job = read().then((info) => {
      setInfos((current) => ({ ...current, [agent]: info }));
      saveInfoFor(agent, info);
      setInfoStates((current) => ({ ...current, [agent]: { loading: false, error: null } }));
      return null;
    }).catch((error) => {
      setInfoStates((current) => ({ ...current, [agent]: { loading: false, error: String(error) } }));
      return `${AGENT_NAMES[agent]}: ${error}`;
    }).finally(() => { infoJobs.current.delete(agent); });
    infoJobs.current.set(agent, job);
    return job;
  }, []);

  // Model discovery starts after the first task list; the menu also offers an explicit refresh.
  const tasksLoaded = tasks !== null;
  useEffect(() => {
    if (tasksLoaded) for (const agent of ['claude', 'codex', 'pi'] as const) refreshInfo(agent);
  }, [tasksLoaded, refreshInfo]);

  // A CLI whose tasks are hidden is not offered for new ones; the saved choice returns with it.
  const startAgent: Agent = hiddenAgents.includes(newTaskAgent)
    ? ((['claude', 'codex', 'pi'] as const).find((agent) => !hiddenAgents.includes(agent)) ?? newTaskAgent)
    : newTaskAgent;
  const selectedTaskAgent = tasks?.find((task) => task.id === selectedId)?.agent;
  const selectedAgent: Agent = selectedId
    ? (selectedTaskAgent ?? newTaskAgents[selectedId] ?? queues[selectedId]?.agent ?? 'claude')
    : startAgent;
  // A task continues in the permission mode it last ran in, wherever that was, until it is changed here.
  const prefs = selectedId
    ? taskPreferences(allPrefs[selectedAgent], nativeModels[selectedId], chosenPrefs[selectedId], sessionModes[selectedId])
    : allPrefs[selectedAgent];
  const info = infos[selectedAgent];

  useEffect(() => {
    const unlisten = onQueueChanged(updateQueue);
    const errors = onQueueError(({ taskId, error }) => {
      if (taskId === null) setQueueLoadError(t('queueFailed', { error }));
      else setNotices((current) => ({ ...current, [taskId]: { text: t('queueFailed', { error }), isError: true } }));
    });
    queueListening.current = Promise.all([unlisten, errors]);
    return () => { void unlisten.then((stop) => stop()); void errors.then((stop) => stop()); };
  }, [updateQueue]);

  useEffect(() => {
    setQueuesLoaded(false);
    let current = true;
    setQueueLoadError(null);
    void queueListening.current.then(() => listQueues()).then((loaded) => {
      if (!current) return;
      loaded.forEach(updateQueue);
      setQueuesLoaded(true);
    }).catch((error) => { if (current) setQueueLoadError(t('queueFailed', { error: String(error) })); });
    return () => { current = false; };
  }, [updateQueue]);

  const cancelQueueEdit = useCallback(() => {
    const edit = queueEditRef.current;
    if (!edit) return;
    void setQueueLock(edit.taskId, edit.owner, edit.entry.id, false).then(() => {
      if (queueEditRef.current !== edit) return;
      queueEditRef.current = null;
      setQueueEdit(null);
    }).catch((error) => setNotices((current) => ({
      ...current, [edit.taskId]: { text: t('queueFailed', { error: String(error) }), isError: true },
    })));
  }, []);
  useEffect(() => {
    if (queueEdit && (queueEdit.taskId !== selectedId || !queues[queueEdit.taskId]?.entries.some(({ id }) => id === queueEdit.entry.id))) {
      cancelQueueEdit();
    }
  }, [selectedId, queues, queueEdit, cancelQueueEdit]);
  useEffect(() => () => {
    const edit = queueEditRef.current;
    if (edit) void setQueueLock(edit.taskId, edit.owner, edit.entry.id, false).catch(console.error);
  }, []);

  const beginQueueEdit = async (entry: QueuedMessage) => {
    if (!selectedId || queueEditRef.current) return;
    const edit = { taskId: selectedId, entry, owner: `edit-${crypto.randomUUID()}` };
    queueEditRef.current = edit;
    try {
      await setQueueLock(edit.taskId, edit.owner, entry.id, true);
      if (selectedIdRef.current === edit.taskId && queueEditRef.current === edit) setQueueEdit(edit);
      else {
        await setQueueLock(edit.taskId, edit.owner, entry.id, false);
        if (queueEditRef.current === edit) queueEditRef.current = null;
      }
    } catch (error) {
      queueEditRef.current = null;
      setNotices((current) => ({ ...current, [edit.taskId]: { text: t('queueFailed', { error: String(error) }), isError: true } }));
    }
  };

  const saveQueueEdit = async (prompt: string, attachments: Attachment[]) => {
    const edit = queueEditRef.current;
    if (!edit) return;
    const existingIds = new Set(edit.entry.attachments.map(({ id }) => id));
    const keepIds = attachments.filter(({ id }) => existingIds.has(id)).map(({ id }) => id);
    const addedIds = attachments.filter(({ id }) => !existingIds.has(id)).map(({ id }) => id);
    const snapshot = await editQueuedTurn(edit.taskId, edit.entry.id, prompt, keepIds, addedIds);
    updateQueue(snapshot);
    if (queueEditRef.current !== edit) return;
    const entry = snapshot.entries.find(({ id }) => id === edit.entry.id);
    if (entry) {
      const saved = { ...edit, entry };
      queueEditRef.current = saved;
      setQueueEdit(saved);
    }
    cancelQueueEdit();
  };

  useEffect(() => {
    setHistory([]);
    setLoadedId(null);
    if (selectedId && !unwrittenTasks.current.has(selectedId)) void loadHistory(selectedAgent, selectedId);
  }, [selectedId, selectedAgent, loadHistory]);

  const settleRequest = useCallback((taskId: string, requestId: string) => {
    setPending((current) => ({
      ...current,
      [taskId]: (current[taskId] ?? []).filter((request) => request.requestId !== requestId),
    }));
  }, []);

  const clearTurn = useCallback((taskId: string) => {
    setPending(({ [taskId]: _removed, ...rest }) => rest);
    setProgress(({ [taskId]: _removed, ...rest }) => rest);
  }, []);

  /** Only when the window is not in front: otherwise the user is already looking at it. */
  const notifyIfAway = useCallback((heading: string, taskId: string) => {
    if (!settingsRef.current.notifyWhenDone || document.hasFocus()) return;
    const task = tasksRef.current?.find((item) => item.id === taskId);
    const title = (task && taskTitle(taskMetaRef.current, task)) || draftTitlesRef.current[taskId] || t('untitled');
    notifyUser(heading, title).catch(console.error);
  }, []);

  const createTurnHandler = useCallback(
    ({ agent, taskId: knownId, newCwd, prompt, userItem, selectOnStart, initialPrefs }: TurnSource) => {
      let taskId = knownId;
      const isNew = knownId === null;
      let ended = false;
      let isListed = !isNew;
      const generation = crypto.randomUUID();
      let streamed: Item[] = [userItem];
      const onEvent = (event: TurnEvent) => {
        // The process can still print lines after its result, when the turn is already over.
        if (ended) return;
        if (event.type === 'started') {
          const id = event.taskId;
          taskId = id;
          turnGenerations.current.set(id, generation);
          setStoppedTasks((current) => {
            if (!current.has(id)) return current;
            const next = new Set(current);
            next.delete(id);
            return next;
          });
          const startedAt = Date.now();
          setProgress((current) => ({
            ...current,
            [id]: { startedAt, outputTokens: 0, activity: 0, rate: emptyRateHistory() },
          }));
          // A turn sent from a phone reaches this window at its first event.
          setLive((current) => ({ ...current, [id]: [userItem] }));
          turnAppenders.current.set(id, (item) => {
            streamed = [...streamed, item];
            setLive((current) => ({ ...current, [id]: streamed }));
          });
          setNotices(({ [id]: _removed, ...rest }) => rest);
          if (isNew) {
            if (initialPrefs) {
              setNativeModels((current) => ({ ...current, [id]: initialPrefs.model ? { model: initialPrefs.model, effort: initialPrefs.effort } : null }));
              setSessionModes((current) => ({ ...current, [id]: initialPrefs.permissionMode }));
            }
            unwrittenTasks.current.add(id);
            setNewTaskCwds((current) => ({ ...current, [id]: newCwd as string }));
            setNewTaskAgents((current) => ({ ...current, [id]: agent }));
            const firstLine = prompt.split('\n').find((line) => line.trim())?.trim();
            const title = firstLine ?? t('attachmentsOnly');
            setDraftTitles((current) => ({ ...current, [id]: title }));
            setTaskPreviews((current) => ({ ...current, [id]: { id, agent, cwd: newCwd as string, title, updatedAtMs: startedAt } }));
            if (selectOnStart) setSelection({ kind: 'task', id });
          }
          return;
        }
        const id = taskId;
        if (!id) return;
        if (event.type === 'steerRefused') {
          // The CLI would not take it into this turn: it leaves the turn's view and joins the queue.
          const at = streamed.map((item) => item.type === 'user' && item.text === event.prompt).lastIndexOf(true);
          if (at > 0) {
            streamed = streamed.filter((_, index) => index !== at);
            setLive((current) => ({ ...current, [id]: streamed }));
          }
          steerFallback.current(agent, id, event.prompt);
          return;
        }
        if (event.type === 'permissionRequest' || event.type === 'question') {
          setPending((current) => ({ ...current, [id]: [...(current[id] ?? []), event] }));
          notifyIfAway(t('notifyWaiting'), id);
          return;
        }
        if (event.type === 'requestSettled') {
          settleRequest(id, event.requestId);
          return;
        }
        if (event.type === 'contextUsage') {
          setContexts((current) => ({ ...current, [id]: { usedTokens: event.usedTokens, model: event.model } }));
          // Native metadata can now replace the already-visible prompt preview.
          if (!isListed) {
            isListed = true;
            void refreshTasks(agent === 'codex');
          }
          return;
        }
        if (event.type === 'contextWindow') {
          setContextWindows((current) => {
            const next = { ...current, [event.model]: event.tokens };
            saveContextWindows(next);
            return next;
          });
          return;
        }
        if (event.type === 'rateLimits') {
          usageReadAt.current[agent] = Date.now();
          setInfos((current) => {
            const next = { ...current[agent], usage: event.windows };
            saveInfoFor(agent, next);
            return { ...current, [agent]: next };
          });
          return;
        }
        if (event.type === 'generationSpeed') {
          setProgress((current) => {
            const turn = current[id];
            return turn ? { ...current, [id]: { ...turn, rate: recordSpeed(turn.rate, event.speed, Date.now()) } } : current;
          });
          return;
        }
        if (event.type !== 'finished') {
          setProgress((current) => {
            const turn = current[id];
            if (!turn) return current;
            return {
              ...current,
              [id]: {
                ...turn,
                activity: turn.activity + 1,
                outputTokens: event.type === 'outputTokens' ? event.total : turn.outputTokens,
              },
            };
          });
        }
        if (event.type === 'outputTokens') return;
        if (event.type === 'finished') {
          ended = true;
          turnAppenders.current.delete(id);
          if (Date.now() - usageReadAt.current[agent] >= USAGE_STALE_MS) void refreshInfo(agent);
          unwrittenTasks.current.delete(id);
          clearTurn(id);
          if (event.isError || event.cancelled) setTaskPreviews((current) => clearTaskPreviews(current, [id]));
          if (event.cancelled) setStoppedTasks((current) => new Set(current).add(id));
          streamed = applyTurnEvent(streamed, event);
          const error = streamed.at(-1);
          if (error?.type === 'error') {
            const source = [...streamed].reverse().find((item) => item.type === 'user');
            if (source?.type === 'user') {
              const before = selectedIdRef.current === id ? historyBeforeLiveTurn(historyRef.current, streamed) : null;
              const occurrence = before ? [...before, ...streamed].filter((item) => item.type === 'user' && item.text === source.text).length - 1 : undefined;
              setTurnFailures((current) => ({ ...current, [id]: [...(current[id] ?? []), { prompt: source.text, sentAt: source.at, endedAt: Date.now(), occurrence, error: { ...error, type: 'error' } }] }));
            }
          }
          if (!event.cancelled) notifyIfAway(event.isError ? t('notifyFailed') : t('notifyDone'), id);
          if (shouldMarkUnread(Boolean(event.cancelled), id, selectedIdRef.current, document.hasFocus())) changeUnread((current) => markUnread(current, id));
          // Preserve the completed stream until the native file replaces it. A following queued
          // turn can start while that read is in flight, and owns its own live content.
          if (selectedIdRef.current === id) setHistory((current) => [...historyBeforeLiveTurn(current, streamed), ...streamed]);
          setLive(({ [id]: _removed, ...rest }) => rest);
          void (async () => {
            if (selectedIdRef.current === id) await loadHistory(agent, id, () => turnGenerations.current.get(id) === generation);
            await refreshTasks(agent === 'codex');
          })();
          return;
        }
        streamed = applyTurnEvent(streamed, event);
        setLive((current) => ({ ...current, [id]: streamed }));
      };
      return { onEvent, taskId: () => taskId };
    },
    [setSelection, notifyIfAway, loadHistory, refreshTasks, settleRequest, clearTurn, changeUnread, refreshInfo],
  );

  // Turns started from a phone show here too, each with its own handler until it finishes.
  const remoteTurns = useRef(new Map<string, ReturnType<typeof createTurnHandler>>());
  const latestCreateTurnHandler = useRef(createTurnHandler);
  latestCreateTurnHandler.current = createTurnHandler;
  useEffect(() => {
    const turns = new Map<string, ReturnType<typeof createTurnHandler>>();
    const unlisten = onQueuedTurn(({ taskId, agent, entryId, entry, event }) => {
      let turn = turns.get(entryId);
      if (!turn && entry) {
        turn = latestCreateTurnHandler.current({ agent, taskId, newCwd: null, prompt: entry.prompt,
          userItem: userItemFor(entry.prompt, entry.attachments, `live-user-${entryId}`), selectOnStart: false });
        setNativeModels((current) => entry.options.model ? { ...current, [taskId]: { model: entry.options.model, effort: entry.options.effort } } : current);
        turns.set(entryId, turn);
      }
      if (turn) turn.onEvent(event);
      else if (event.type === 'finished' && event.isError) {
        setNotices((current) => ({ ...current, [taskId]: { text: t('turnFailed', { error: event.message ?? '' }), isError: true } }));
      }
      if (event.type === 'finished') turns.delete(entryId);
    });
    return () => { void unlisten.then((stop) => stop()); };
  }, []);
  useEffect(() => {
    const unlisten = onRemoteTurn(({ runId, agent, isNew, cwd, prompt, event }) => {
      let turn = remoteTurns.current.get(runId);
      if (!turn) {
        // A resumed task has no id until its first event, which is what tells this window its id.
        const taskId = !isNew && event.type === 'started' ? event.taskId : null;
        const userItem: Item = { type: 'user', id: `live-user-${runId}`, text: prompt };
        turn = latestCreateTurnHandler.current({ agent, taskId, newCwd: cwd, prompt, userItem, selectOnStart: false });
        remoteTurns.current.set(runId, turn);
      }
      turn.onEvent(event);
      if (event.type === 'finished') remoteTurns.current.delete(runId);
    });
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, []);

  useEffect(() => {
    const sync = () => {
      setSettings(loadSettings());
      setTaskMeta(loadTaskMeta());
      setExtraProjects(loadExtraProjects());
      setProjectOrder(loadProjectOrder());
      setPinnedProjects(preferencesSnapshot().state.pinnedProjects);
      setUnreadTasks(preferencesSnapshot().state.unreadTasks);
      setSidebarOptions({ groupByCli: preferencesSnapshot().config.sidebar_group_by_cli, sort: preferencesSnapshot().config.sidebar_sort });
      setHiddenAgents(preferencesSnapshot().config.hidden_task_agents ?? []);
      setSidebarCollapsed(loadSidebarCollapsed());
      setSidebarWidth(loadSidebarWidth());
      setAllPrefs({ claude: loadPrefsFor('claude'), codex: loadPrefsFor('codex'), pi: loadPrefsFor('pi') });
      setNewTaskAgent(loadNewTaskAgent());
    };
    const stop = subscribePreferences(sync);
    sync();
    return stop;
  }, []);

  const startNewTurn = useCallback(
    (prompt: string, attachments: Attachment[], newCwd: string) => {
      const userItem = userItemFor(prompt, attachments, `live-user-${crypto.randomUUID()}`);
      const agent = selectedAgent;
      setNewTaskError(null);
      const options = {
        ...turnOptions(prefs, info.models),
        // Pi has no permission modes, and any saved choice belongs to another agent's menu.
        ...(agent === 'pi' ? { permissionMode: null } : {}),
        worktree: agent === 'claude' && useWorktree,
      };
      const model = selectedModel(prefs, info.models);
      const initialPrefs = { ...prefs, model: prefs.model ?? (model?.resolvedModel || null), effort: prefs.effort ?? model?.defaultEffort ?? null };
      const turn = createTurnHandler({ agent, taskId: null, newCwd, prompt, userItem, selectOnStart: true, initialPrefs });
      void sendTurn(agent, { cwd: newCwd }, prompt, attachments, options, turn.onEvent).catch((error) => {
        const id = turn.taskId();
        if (id) {
          turn.onEvent({ type: 'finished', isError: true, cancelled: false, message: String(error) });
        } else {
          // Codex can fail before it has a thread, and then there is no task to show this on.
          setNewTaskError(t('turnFailed', { error: String(error) }));
        }
      });
    },
    [selectedAgent, prefs, info.models, useWorktree, createTurnHandler, clearTurn],
  );

  const changeHiddenAgents = useCallback((next: Agent[]) => {
    hiddenAgentsRef.current = next;
    setHiddenAgents(next);
    saveConfig({ hidden_task_agents: next });
  }, []);
  // Also follows an edit to config.toml: a CLI turned back on is scanned again.
  useEffect(() => { void refreshTasks(true); }, [hiddenAgents, refreshTasks]);
  const changeSidebarOptions = useCallback((options: SidebarOptions) => {
    setSidebarOptions(options);
    saveConfig({ sidebar_group_by_cli: options.groupByCli, sidebar_sort: options.sort });
  }, []);
  const unarchiveTask = useCallback((id: string) => {
    setTaskMeta((current) => {
      const next = unarchive(current, id);
      if (next !== current) saveTaskMeta(next);
      return next;
    });
  }, []);

  const send = useCallback(
    async (prompt: string, attachments: Attachment[], alternate = false) => {
      if (selection.kind === 'settings') return;
      if (selection.kind === 'task') {
        // While a turn runs, the send key queues the message and the other shortcut adds it to the
        // running turn, as in the reference and Codex App.
        const appendToTurn = turnAppenders.current.get(selection.id);
        if (appendToTurn && alternate) {
          try {
            await steerTurn(selectedAgent, selection.id, prompt, attachments);
            const added = userItemFor(prompt, attachments, `live-user-${crypto.randomUUID()}`);
            appendToTurn(added.type === 'user' ? { ...added, steered: true } : added);
            return;
          } catch (error) {
            // The turn ended in the meantime: the message waits in the queue like any other.
            if (String(error) !== NO_ACTIVE_TURN) throw error;
          }
        }
        const options = {
          ...turnOptions(prefs, info.models),
          ...(selectedAgent === 'pi' ? { permissionMode: null } : {}),
          ignoreExternalWriter: overriddenWriters.has(selection.id),
        };
        setOverriddenWriters((current) => {
          const next = new Set(current);
          next.delete(selection.id);
          return next;
        });
        updateQueue(await enqueueTurn(selectedAgent, selection.id, prompt, attachments, options));
      } else if (selection.cwd === CONVERSATION_CWD) {
        setNewTaskError(null);
        const cwd = await createConversationDir(settings.conversationDir);
        startNewTurn(prompt, attachments, cwd);
      } else if (selection.cwd) {
        startNewTurn(prompt, attachments, selection.cwd);
      }
    },
    [selection, settings.conversationDir, startNewTurn, prefs, info.models, selectedAgent, overriddenWriters, updateQueue],
  );
  /** A queued message moved into the running turn, or, with none running, sent first and resumed. */
  const steerQueued = async (taskId: string, entry: QueuedMessage) => {
    const appendToTurn = turnAppenders.current.get(taskId);
    if (appendToTurn) {
      try {
        const accepted = await steerQueuedTurn(taskId, entry.id);
        updateQueue(accepted.queue);
        const added = userItemFor(accepted.entry.prompt, accepted.entry.attachments, `live-user-${crypto.randomUUID()}`);
        appendToTurn(added.type === 'user' ? { ...added, steered: true } : added);
        return;
      } catch (error) {
        if (String(error) !== NO_ACTIVE_TURN) throw error;
      }
    }
    updateQueue(await reorderQueuedTurn(taskId, entry.id, 0));
    updateQueue(await resumeQueue(taskId));
  };
  steerFallback.current = (agent, taskId, prompt) => {
    enqueueTurn(agent, taskId, prompt, [], turnOptions(taskPreferences(allPrefs[agent], nativeModels[taskId], chosenPrefs[taskId], sessionModes[taskId]), infos[agent].models))
      .then((queue) => {
        updateQueue(queue);
        setNotices((current) => ({ ...current, [taskId]: { text: t('steerQueued'), isError: false } }));
      })
      .catch((error) => setNotices((current) => ({ ...current, [taskId]: { text: t('queueFailed', { error: String(error) }), isError: true } })));
  };

  const answer = useCallback(
    (taskId: string, requestId: string, decision: Decision) => {
      const key = `${taskId}:${requestId}`;
      if (answering.current.has(key)) return;
      answering.current.add(key);
      setAnsweringRequests(new Set(answering.current));
      setNotices(({ [taskId]: _removed, ...rest }) => rest);
      // Keep the card and its answers until delivery succeeds. A remote settlement can remove it.
      void answerRequest(taskId, requestId, decision).then(() => settleRequest(taskId, requestId)).catch((error) => {
        const failure = requestAnswerFailure(error);
        if (failure.settled) settleRequest(taskId, requestId);
        else setNotices((current) => ({
          ...current,
          [taskId]: { text: t('requestFailed', { error: failure.message }), isError: true },
        }));
      }).finally(() => {
        answering.current.delete(key);
        setAnsweringRequests(new Set(answering.current));
      });
    },
    [settleRequest],
  );

  const changePrefsFor = useCallback((agent: Agent, next: TurnPrefs) => {
    setAllPrefs((current) => ({ ...current, [agent]: next }));
    savePrefsFor(agent, next);
  }, []);
  const changePrefs = (next: TurnPrefs) => {
    if (selectedId) setChosenPrefs((current) => ({ ...current, [selectedId]: next }));
    else changePrefsFor(selectedAgent, next);
  };
  const otherAgents = (['claude', 'codex', 'pi'] as const).filter((agent) => agent !== startAgent && !hiddenAgents.includes(agent));

  const running = useMemo(() => new Set(Object.keys(live)), [live]);
  const external = useMemo(() => new Map(writers.map((writer) => [writer.taskId, writer.isBusy])), [writers]);
  const waiting = useMemo(
    () => new Set(Object.keys(pending).filter((id) => pending[id].length > 0)),
    [pending],
  );
  const selectedTask = tasks?.find((task) => task.id === selectedId);
  // A selected task is read only while the user can actually see the window.
  useEffect(() => {
    const read = () => {
      if (selectedId && document.hasFocus()) changeUnread((current) => current.includes(selectedId) ? current.filter((id) => id !== selectedId) : current);
    };
    read();
    window.addEventListener('focus', read);
    return () => window.removeEventListener('focus', read);
  }, [selectedId, changeUnread]);
  const unread = useMemo(() => new Set(unreadTasks), [unreadTasks]);
  const badgeCount = useMemo(() => {
    const visible = (tasks ?? []).filter((task) => !hiddenAgents.includes(task.agent)).map(({ id }) => id);
    return attentionTaskCount(unreadTasks, waiting, [...visible, ...Object.keys(live)], taskMeta.archived);
  }, [tasks, hiddenAgents, unreadTasks, waiting, live, taskMeta.archived]);
  useEffect(() => { void updateAppBadge(badgeCount).catch(console.error); }, [badgeCount]);
  const menuTask = menuAnchor ? tasks?.find((task) => task.id === menuAnchor.id) : undefined;
  const items = useMemo(() => {
    if (!selectedId) return [];
    const all = withTurnFailures([...historyBeforeLiveTurn(history, live[selectedId]), ...(live[selectedId] ?? [])], turnFailures[selectedId] ?? []);
    // Claude records a stop in its file. The others do not, so this window remembers it.
    if (stoppedTasks.has(selectedId) && all.at(-1)?.type !== 'notice') {
      all.push({ type: 'notice', id: `stopped-${selectedId}`, text: t('interrupted') });
    }
    return all;
  }, [history, live, selectedId, stoppedTasks, turnFailures]);
  const composerInputHistory = useRef<readonly string[]>([]);
  const inputHistoryItems = loadedId === selectedId ? items : selectedId ? live[selectedId] ?? [] : [];
  composerInputHistory.current = deriveInputHistory(inputHistoryItems, composerInputHistory.current);
  const selectedQueue = selectedId ? queues[selectedId] : undefined;
  const editingEntry = queueEdit?.taskId === selectedId ? queueEdit.entry : undefined;
  const composerPrefs: TurnPrefs = editingEntry ? {
    model: editingEntry.options.model,
    effort: editingEntry.options.effort,
    permissionMode: (editingEntry.options.permissionMode ?? 'ask') as TurnPrefs['permissionMode'],
  } : prefs;
  const queuedErrorInTimeline = selectedQueue?.error && items.some((item) => item.type === 'error' && item.text === selectedQueue.error);
  const notice = selectedId ? notices[selectedId] ?? (selectedQueue?.error && !queuedErrorInTimeline ? { text: selectedQueue.error, isError: true } : undefined) : undefined;
  const isRunning = selectedId ? running.has(selectedId) : false;
  const selectedPending = selectedId ? pending[selectedId]?.[0] : undefined;
  const taskCwd = selectedTask?.cwd ?? (selectedId ? newTaskCwds[selectedId] : null) ?? null;
  const selectedProgress = selectedId ? progress[selectedId] : undefined;
  const liveItems = selectedId ? live[selectedId] : undefined;
  const selectedContext = selectedId ? contexts[selectedId] : undefined;
  const contextWindow = selectedContext?.model ? contextWindows[selectedContext.model] : undefined;
  const context =
    selectedContext && contextWindow
      ? { usedTokens: selectedContext.usedTokens, windowTokens: contextWindow }
      : null;

  // Tasks arrive newest first, so the first project is the most recently used one.
  const isConversationCwd = useCallback(
    (cwd: string) => conversationRoots.some((root) => isUnder(cwd, root)),
    [conversationRoots],
  );
  const projects = useMemo(() => {
    const recent = (tasks ?? []).filter((task) => !isConversationCwd(task.cwd)).map((task) => groupRoot(task.cwd, extraProjects));
    return [...new Set([...recent, ...extraProjects])].filter((cwd) => extraProjects.includes(cwd));
  }, [tasks, extraProjects, isConversationCwd]);
  const newTaskCwd = selection.kind === 'new' ? (selection.cwd ?? projects[0] ?? CONVERSATION_CWD) : null;
  /** A new task from a task page stays where that task is, which may be a conversation. */
  const homeOfSelected = selectedTask
    ? isConversationCwd(selectedTask.cwd)
      ? CONVERSATION_CWD
      : groupRoot(selectedTask.cwd, extraProjects)
    : null;

  // An archived task leaves the sidebar, so the page it was on gives way to a new task there.
  const isSelectedArchived = selectedId !== null && taskMeta.archived.includes(selectedId);
  useEffect(() => {
    if (isSelectedArchived) setSelection({ kind: 'new', cwd: homeOfSelected ?? newTaskCwd ?? null });
  }, [isSelectedArchived]);

  const archivedGroups = useMemo((): ArchivedGroup[] => {
    const groups = new Map<string, ArchivedGroup>();
    const byId = new Map((tasks ?? []).map((task) => [task.id, task]));
    for (const id of taskMeta.archived) {
      const task = byId.get(id);
      if (!task) continue;
      const name = isConversationCwd(task.cwd) ? t('conversations') : projectName(groupRoot(task.cwd, extraProjects));
      const group = groups.get(name) ?? { name, tasks: [] };
      group.tasks.push({ id, title: taskTitle(taskMeta, task), agent: task.agent, updatedAtMs: task.updatedAtMs });
      groups.set(name, group);
    }
    for (const group of groups.values()) group.tasks.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
    return [...groups.values()];
  }, [tasks, taskMeta, isConversationCwd, extraProjects]);

  useEffect(() => {
    if (selection.kind === 'new' && !selection.cwd && newTaskCwd) {
      setSelection({ kind: 'new', cwd: newTaskCwd });
    }
  }, [selection, setSelection, newTaskCwd]);

  useEffect(() => {
    getVersion().then(setVersion).catch(console.error);
  }, []);

  useEffect(() => {
    setUseWorktree(false);
    setBranch(null);
    if (!newTaskCwd || newTaskCwd === CONVERSATION_CWD) return;
    let isCurrent = true;
    const read = () => {
      gitBranch(newTaskCwd)
        .then((result) => {
          if (isCurrent) setBranch(result);
        })
        .catch(console.error);
    };
    read();
    // The branch can change in a terminal while Tandem is in the background.
    window.addEventListener('focus', read);
    return () => {
      isCurrent = false;
      window.removeEventListener('focus', read);
    };
  }, [newTaskCwd]);

  useEffect(() => {
    // Keeps going with the window hidden, so the menu bar stays right, but less often.
    let ticks = 0;
    const read = () => {
      ticks += 1;
      if (document.hidden && ticks % HIDDEN_POLL_EVERY !== 0) return;
      externalWriters().then(setWriters).catch(console.error);
    };
    read();
    const timer = window.setInterval(read, WRITER_POLL_MS);
    window.addEventListener('focus', read);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', read);
    };
  }, []);

  // When another process stops working on the open task, show what it wrote.
  const selectedWriter = selectedId ? writers.find((writer) => writer.taskId === selectedId) : undefined;
  const isTaskRunning = isRunning || Boolean(selectedWriter?.isBusy);
  const isHeldByWriter = Boolean(
    selectedId && selectedWriter && !(selectedWriter.canOverride && overriddenWriters.has(selectedId)),
  );
  // Only Claude can truncate its own task to replace a prompt; Codex and Pi would fork a new task.
  const editableId = selectedAgent === 'claude' && selectedTask && !isRunning && !selectedPending && !selectedWriter
    && !selectedQueue?.entries.length ? lastEditablePrompt(items) : null;
  const editLast = useCallback((itemId: string, prompt: string) => new Promise<void>((resolve, reject) => {
    if (!selectedId) { reject(new Error(t('untitled'))); return; }
    const id = selectedId;
    const options = { ...turnOptions(prefs, info.models), editLast: itemId };
    const userItem = userItemFor(prompt, [], `live-user-${crypto.randomUUID()}`);
    const turn = createTurnHandler({ agent: 'claude', taskId: id, newCwd: null, prompt, userItem, selectOnStart: false });
    let started = false;
    void sendTurn('claude', { taskId: id }, prompt, [], options, (event) => {
      if (event.type === 'started' && !started) {
        started = true;
        // The replaced turn leaves the view now; the native file decides what stays once the turn ends.
        setHistory((current) => {
          const index = current.findIndex((item) => item.id === itemId);
          return index < 0 ? current : current.slice(0, index);
        });
        resolve();
      }
      turn.onEvent(event);
    }).catch((error) => {
      if (!started) { reject(error); return; }
      turn.onEvent({ type: 'finished', isError: true, cancelled: false, message: String(error) });
    });
  }), [selectedId, prefs, info.models, createTurnHandler, clearTurn]);
  const wasBusyElsewhere = useRef<{ id: string | null; isBusy: boolean; isOpen: boolean }>({ id: null, isBusy: false, isOpen: false });
  useEffect(() => {
    const isBusy = selectedWriter?.isBusy ?? false;
    const previous = wasBusyElsewhere.current;
    wasBusyElsewhere.current = { id: selectedId, isBusy, isOpen: Boolean(selectedWriter) };
    if (selectedId && previous.id === selectedId && (previous.isBusy && !isBusy || previous.isOpen && !selectedWriter)) {
      void loadHistory(selectedAgent, selectedId);
      void refreshTasks();
    }
  }, [selectedId, selectedAgent, selectedWriter, loadHistory, refreshTasks]);

  // A task open elsewhere keeps changing, so this view follows its file.
  const followState = useRef<{ id: string | null; stamp: string | null; nextAt: number; isLoading: boolean }>({
    id: null,
    stamp: null,
    nextAt: 0,
    isLoading: false,
  });
  const isOpenElsewhere = Boolean(selectedWriter);
  useEffect(() => {
    if (!selectedId || !isOpenElsewhere) return;
    const follow = followState.current;
    follow.id = selectedId;
    follow.stamp = null;
    const check = async () => {
      if (document.hidden || follow.isLoading || Date.now() < follow.nextAt) return;
      const stamp = await taskStamp(selectedAgent, selectedId).catch(() => null);
      if (!stamp || stamp === follow.stamp || follow.id !== selectedId) return;
      const isFirstLook = follow.stamp === null;
      follow.stamp = stamp;
      // The page already shows what was on disk when the task opened.
      if (isFirstLook) return;
      follow.isLoading = true;
      const startedAt = Date.now();
      await loadHistory(selectedAgent, selectedId);
      follow.isLoading = false;
      follow.nextAt = Date.now() + (Date.now() - startedAt) * RELOAD_COST_FACTOR;
    };
    void check();
    const timer = window.setInterval(() => void check(), WRITER_POLL_MS);
    return () => window.clearInterval(timer);
  }, [selectedId, selectedAgent, isOpenElsewhere, loadHistory]);

  // The menu bar lists what is running here and elsewhere, and the plan left for each agent.
  const [usageClock, setUsageClock] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setUsageClock(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const summaryForTray = useMemo((): TraySummary => {
    const busyElsewhere = writers.filter((writer) => writer.isBusy).map((writer) => writer.taskId);
    const trayTasks = [...new Set([...Object.keys(live), ...busyElsewhere])].flatMap((id): TrayTask[] => {
      const task = tasks?.find((item) => item.id === id);
      const title = (task && taskTitle(taskMeta, task)) || draftTitles[id];
      if (!task && !live[id]) return [];
      const status = !live[id] ? 'elsewhere' : pending[id]?.length ? 'waiting' : 'running';
      const project = task ? projectName(task.cwd) : '';
      return [{ id, title: title || t('untitled'), agent: task?.agent ?? newTaskAgents[id] ?? 'claude', status, project, queuedCount: queues[id]?.entries.length ?? 0 }];
    });
    const sources = (['claude', 'codex', 'pi'] as const).flatMap((agent): TraySource[] => {
      const usageWindows = infos[agent].usage;
      const windows = (['fiveHour', 'sevenDay'] as const).flatMap((key): TrayWindow[] => {
        const window = usageWindows?.[key];
        const usage = window && describeUsage(window, usageClock);
        if (!usage) return [];
        return [{ name: key === 'sevenDay' ? 'week' : 'short', remaining: usage.remaining, resetIn: usage.resetIn, isLow: usage.low }];
      });
      return windows.length > 0 ? [{ agent, windows }] : [];
    });
    return { tasks: trayTasks, sources };
  }, [writers, live, pending, tasks, taskMeta, draftTitles, newTaskAgents, infos, usageClock, queues]);
  useEffect(() => {
    updateTray(summaryForTray).catch(console.error);
  }, [summaryForTray]);

  // A window that has reset starts from a new figure, which only the CLI knows.
  useEffect(() => {
    for (const agent of ['claude', 'codex', 'pi'] as const) {
      if (usageExpired(infos[agent].usage, usageClock) && usageClock - usageReadAt.current[agent] >= USAGE_STALE_MS) refreshInfo(agent);
    }
  }, [infos, usageClock, refreshInfo]);
  const infosRef = useRef(infos);
  infosRef.current = infos;
  useEffect(() => {
    const unlisten = onTrayPanelOpened(() => {
      const now = Date.now();
      setUsageClock(now);
      for (const agent of ['claude', 'codex', 'pi'] as const) {
        if (infosRef.current[agent].usage && now - usageReadAt.current[agent] >= USAGE_STALE_MS) refreshInfo(agent);
      }
    });
    return () => { void unlisten.then((stop) => stop()); };
  }, [refreshInfo]);

  useEffect(() => {
    let refreshing = false;
    const unlisten = onTrayRefresh(() => {
      if (refreshing) return;
      refreshing = true;
      void (async () => {
        const [taskErrors, writerError, infoErrors] = await Promise.all([
          refreshTasks(true),
          externalWriters().then((next) => {
            setWriters(next);
            return null;
          }).catch((error) => String(error)),
          Promise.all((['claude', 'codex', 'pi'] as const).map(refreshInfo)),
        ]);
        setUsageClock(Date.now());
        const errors = [...taskErrors, writerError, ...infoErrors].filter((error): error is string => error !== null);
        await completeTrayRefresh(errors.length ? errors.join('\n') : null);
      })().catch(console.error).finally(() => { refreshing = false; });
    });
    return () => { void unlisten.then((stop) => stop()); };
  }, [refreshTasks, refreshInfo]);

  useEffect(() => {
    const unlisten = onTrayOpenTask((id) => navigate({ kind: 'task', id }));
    const unlistenSettings = onTrayOpenSettings(() => navigate({ kind: 'settings' }));
    return () => {
      void unlisten.then((stop) => stop());
      void unlistenSettings.then((stop) => stop());
    };
  }, [navigate]);

  const changeSettings = useCallback((next: AppSettings) => {
    setSettings(next);
    saveSettings(next);
  }, []);

  const changeTaskMeta = useCallback((next: TaskMeta) => {
    setTaskMeta(next);
    saveTaskMeta(next);
  }, []);

  const generateTitle = useCallback(async (agent: Agent, id: string) => {
    if (titleJobs.current.has(id)) return;
    titleJobs.current.add(id);
    setGeneratingTitles(new Set(titleJobs.current));
    const previousTitle = taskMetaRef.current.titles[id];
    setTitleErrors(({ [id]: _removed, ...rest }) => rest);
    try {
      const native = nativeModels[id] === undefined && !chosenPrefs[id]
        ? (await readTask(agent, id)).modelSelection
        : nativeModels[id];
      const taskPrefs = taskPreferences(allPrefs[agent], native, chosenPrefs[id], sessionModes[id]);
      const title = await generateTaskTitle(agent, id, titleOptions(taskPrefs, infos[agent].models));
      if (taskMetaRef.current.titles[id] !== previousTitle) return;
      await renameNativeTask(agent, id, title);
      const updated = (tasks: TaskSummary[]) => tasks.map((task) => task.id === id ? { ...task, title } : task);
      if (agent === 'claude') setClaudeTasks((current) => current && updated(current));
      if (agent === 'codex') setCodexTasks(updated);
      if (agent === 'pi') setPiTasks(updated);
      setTaskMeta((current) => {
        const next = acceptNativeTitle(current, id, previousTitle);
        saveTaskMeta(next);
        return next;
      });
      void refreshTasks(agent === 'codex');
    } catch (error) {
      setTitleErrors((current) => ({ ...current, [id]: t('taskTitleFailed', { error: String(error) }) }));
    } finally {
      titleJobs.current.delete(id);
      setGeneratingTitles(new Set(titleJobs.current));
    }
  }, [allPrefs, nativeModels, chosenPrefs, sessionModes, infos, refreshTasks]);

  const changeExtraProjects = useCallback((next: string[]) => {
    setExtraProjects(next);
    saveExtraProjects(next);
  }, []);

  const addProject = useCallback(() => {
    pickProject()
      .then((cwd) => {
        if (!cwd) return;
        setExtraProjects((current) => {
          if (current.includes(cwd)) return current;
          const next = [...current, cwd];
          saveExtraProjects(next);
          return next;
        });
        setSelection({ kind: 'new', cwd });
      })
      .catch(console.error);
  }, [setSelection]);

  const openSettings = useCallback(() => navigate({ kind: 'settings' }), [navigate]);
  const closeMenu = useCallback(() => setMenuAnchor(null), []);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((current) => {
      saveSidebarCollapsed(!current);
      return !current;
    });
  }, []);

  // Reads the page state each time, so it never needs to be bound again.
  const shortcuts = useRef<Record<string, () => void>>({});
  shortcuts.current = {
    ',': openSettings,
    n: () => navigate({ kind: 'new', cwd: homeOfSelected ?? newTaskCwd ?? projects[0] ?? null }),
    b: toggleSidebar,
    '[': () => setNav(goBack),
    ']': () => setNav(goForward),
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const run = event.metaKey && !event.shiftKey && !event.altKey ? shortcuts.current[event.key] : undefined;
      if (!run) return;
      event.preventDefault();
      run();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const remoteScope = selectedId ?? 'new';
  const hasRemoteNotice = remotePresence.clients.length > 0 || remotePresence.error !== null;
  const remoteCollapsed = remotePresence.error === null && remotePresence.collapsed.includes(remoteScope);
  const remoteStatus = {
    center: hasRemoteNotice && !remoteCollapsed ? (
      <RemoteAccessNotice clients={remotePresence.clients} error={remotePresence.error}
        onRetry={remotePresence.retry}
        onManage={() => navigate({ kind: 'settings', tab: 'remote' })}
        onCollapse={() => remotePresence.collapse(remoteScope)}
        onRevoke={setRemoteRevokeTarget} />
    ) : undefined,
    indicator: hasRemoteNotice && remoteCollapsed ? (
      <RemoteAccessIndicator clients={remotePresence.clients} onExpand={() => remotePresence.expand(remoteScope)} />
    ) : undefined,
  };
  // The confirmation stays open when a turn completes and its status row changes.
  const remoteDialog = remoteRevokeTarget ? (
    <RemoteRevokeDialog client={remoteRevokeTarget} onClose={() => setRemoteRevokeTarget(null)}
      onRevoke={async (clientId) => { await remoteRevoke(clientId); await remotePresence.refresh(); }} />
  ) : null;

  if (selection.kind === 'settings') {
    const previous = nav.entries.slice(0, nav.index).reverse().find((entry) => entry.kind !== 'settings');
    const settingsProject = previous?.kind === 'task' ? tasks?.find((task) => task.id === previous.id)?.cwd ?? newTaskCwds[previous.id] ?? null : previous?.kind === 'new' ? previous.cwd : null;
    return (
      <>
        <SettingsView
          currentProject={settingsProject}
          initialTab={selection.tab}
          settings={settings}
          onChange={changeSettings}
          extraProjects={extraProjects}
          onExtraProjectsChange={changeExtraProjects}
          defaultConversationDir={defaultConversationRoot}
          sidebarOptions={sidebarOptions}
          onSidebarOptionsChange={changeSidebarOptions}
          archivedGroups={archivedGroups}
          hiddenAgents={hiddenAgents}
          onHiddenAgentsChange={changeHiddenAgents}
          onUnarchive={unarchiveTask}
          version={version}
          onBack={() => setNav(goBack)}
        />
        {remoteDialog}
      </>
    );
  }

  return <>
    <div className="relative flex h-full">
      <TitleBarActions
        canGoBack={canGoBack(nav)}
        canGoForward={canGoForward(nav)}
        onToggleSidebar={toggleSidebar}
        onBack={() => setNav(goBack)}
        onForward={() => setNav(goForward)}
      />
      {sidebarCollapsed ? null : (
        <Sidebar
          tasks={sidebarTasks}
          pendingTaskIds={pendingTaskIds}
          loaded={tasks !== null}
          selectedId={selectedId}
          running={running}
          unread={unread}
          waiting={waiting}
          external={external}
          meta={taskMeta}
          extraProjects={extraProjects}
          conversationRoots={conversationRoots}
          pinnedProjects={pinnedProjects}
          options={sidebarOptions}
          menuAnchor={menuAnchor}
          generatingTitles={generatingTitles}
          onGenerateTitle={(task) => void generateTitle(task.agent, task.id)}
          onPinnedProjectsChange={(paths) => { setPinnedProjects(paths); saveViewState({ pinnedProjects: paths }); }}
          projectOrder={projectOrder}
          onProjectOrderChange={(order) => {
            setProjectOrder(order);
            saveProjectOrder(order);
          }}
          width={sidebarWidth}
          renamingId={renamingId}
          version={version}
          onWidthChange={(width, isFinal) => {
            setSidebarWidth(width);
            if (isFinal) saveSidebarWidth(width);
          }}
          onSelect={(id) => navigate({ kind: 'task', id })}
          onNewTask={(cwd) =>
            navigate({
              kind: 'new',
              cwd: cwd ?? homeOfSelected ?? newTaskCwd ?? projects[0] ?? null,
            })
          }
          onMetaChange={changeTaskMeta}
          onRenameDone={() => setRenamingId(null)}
          onOpenMenu={setMenuAnchor}
          onOpenSettings={openSettings}
        />
      )}
      <main className="content-area flex min-w-0 flex-1 flex-col bg-[hsl(var(--content-area))]">
        <header
          data-tauri-drag-region
          className={`flex h-[46px] shrink-0 select-none items-center pr-4 ${
            sidebarCollapsed ? 'pl-[176px]' : 'pl-4'
          } ${selectedId ? 'border-b border-[hsl(var(--titlebar-border))]' : ''}`}
        >
          <div data-tauri-drag-region className="flex min-w-0 flex-1 items-center gap-2">
            {selectedId ? <span data-tauri-drag-region role="img"
              aria-label={isTaskRunning ? `${AGENT_NAMES[selectedAgent]} · ${t('running')}` : AGENT_NAMES[selectedAgent]}
              data-tooltip={AGENT_NAMES[selectedAgent]}
              className={`flex size-4 shrink-0 items-center justify-center ${isTaskRunning ? 'task-running text-[var(--status-bar-accent)]' : 'text-[var(--text-secondary)]'}`}>
              <AgentMark agent={selectedAgent} size={14} />
            </span> : null}
            <span data-tauri-drag-region className="min-w-0 truncate text-sm font-medium">
              {selectedTask ? taskTitle(taskMeta, selectedTask) : selectedId ? (draftTitles[selectedId] ?? '') : ''}
            </span>
          </div>
          {selectedTask ? <TaskHeaderActions task={selectedTask} menuAnchor={menuAnchor}
            onMenu={(bounds) => setMenuAnchor((current) => current?.source === 'header' && current.id === selectedTask.id ? null : { source: 'header', id: selectedTask.id, x: bounds.right - 200, y: bounds.bottom + 4 })}
            onError={(error) => setNotices((current) => ({ ...current, [selectedTask.id]: { text: String(error), isError: true } }))} /> : null}
        </header>
        {selectedId ? (
          <ConversationLayout key={selectedId} messages={(bottomPadding) => (
            <Suspense fallback={null}>
              <MessageStream
                taskId={selectedId}
                agent={selectedAgent}
                items={items}
                // A turn still going in a terminal is not over yet; its length is only known once it ends.
                isRunning={isTaskRunning}
                editableId={editableId}
                onEditLast={editLast}
                sendWithCmdEnter={settings.sendWithCmdEnter}
                cwd={taskCwd}
                isLoading={loadedId !== selectedId && !unwrittenTasks.current.has(selectedId)}
                bottomPadding={bottomPadding}
              />
            </Suspense>
          )}>
            {titleErrors[selectedId] ? <NoticeLine notice={{ text: titleErrors[selectedId], isError: true }} /> : null}
            {queueLoadError ? <NoticeLine notice={{ text: queueLoadError, isError: true }} /> : null}
            {notice ? <NoticeLine notice={notice} /> : null}
            {isHeldByWriter && selectedWriter ? (
              <WriterNotice
                writer={selectedWriter}
                onSendAnyway={() => setOverriddenWriters((current) => new Set(current).add(selectedWriter.taskId))}
              />
            ) : null}
            {isRunning && selectedProgress ? (
              <RunningStatus
                {...remoteStatus}
                status={turnStatus(liveItems ?? [], selectedPending !== undefined)}
                startedAt={selectedProgress.startedAt}
                outputTokens={selectedProgress.outputTokens}
                rate={selectedProgress.rate}
                activity={selectedProgress.activity}
              />
            ) : null}
            {/* While another program holds the task, its notice already says why nothing is sent: one row, not two. */}
            {!isRunning && !isHeldByWriter && selectedQueue?.paused && selectedQueue.entries.length > 0 ? (
              <QueuePauseStatus {...remoteStatus} queue={selectedQueue} onChange={updateQueue}
                onError={(error) => setNotices((current) => ({ ...current, [selectedId]: { text: t('queueFailed', { error: String(error) }), isError: true } }))} />
            ) : null}
            {hasRemoteNotice && !(isRunning && selectedProgress) && !(selectedQueue?.paused && selectedQueue.entries.length > 0) ? (
              <ComposerStatusRow {...remoteStatus} />
            ) : null}
            {selectedPending?.type === 'permissionRequest' ? (
              <PermissionPrompt
                submitting={answeringRequests.has(`${selectedId}:${selectedPending.requestId}`)}
                key={selectedPending.requestId}
                request={selectedPending}
                onAnswer={(decision) => answer(selectedId, selectedPending.requestId, decision)}
              />
            ) : null}
            {selectedPending?.type === 'question' ? (
              <QuestionPrompt
                submitting={answeringRequests.has(`${selectedId}:${selectedPending.requestId}`)}
                key={selectedPending.requestId}
                request={selectedPending}
                onAnswer={(decision) => answer(selectedId, selectedPending.requestId, decision)}
              />
            ) : null}
            {/* Stays mounted under a prompt, so a half-written message survives it. */}
            <div>
              <Composer
                key={selectedId}
                draftKey={selectedId}
                inputHistory={composerInputHistory.current}
                running={isRunning}
                // A paused queue does not hold back a new message: with nothing running it is sent at once.
                queueing={isRunning || Boolean(selectedQueue?.entries.length && !selectedQueue.paused)}
                disabled={isHeldByWriter || !queuesLoaded}
                placeholder={isRunning
                  ? t('placeholderQueue', settings.sendWithCmdEnter ? { send: '⌘↵', key: '⇧⌘↵' } : { send: '↵', key: '⌘↵' })
                  : t('placeholderContinue')}
                sendWithCmdEnter={settings.sendWithCmdEnter}
                editing={editingEntry}
                onSaveEdit={saveQueueEdit}
                onCancelEdit={cancelQueueEdit}
                toolbarLeft={
                  <PermissionSelect agent={selectedAgent} prefs={composerPrefs} models={info.models} disabled={Boolean(editingEntry)} onChange={changePrefs} />
                }
                toolbarRight={
                  <ModelSelect agent={selectedAgent} prefs={composerPrefs} models={info.models} usage={info.usage} status={infoStates[selectedAgent]} onRefresh={() => refreshInfo(selectedAgent)} disabled={Boolean(editingEntry)} onChange={changePrefs} />
                }
                queuePanel={selectedQueue && selectedQueue.entries.length > 0 ? (
                  <Suspense fallback={null}>
                    <PendingQueuePanel key={selectedId} queue={selectedQueue} editingId={editingEntry?.id}
                      onEdit={(entry) => void beginQueueEdit(entry)} onChange={updateQueue}
                      running={turnAppenders.current.has(selectedId)}
                      onSteer={(entry) => void steerQueued(selectedId, entry).catch((error) => setNotices((current) => ({ ...current, [selectedId]: { text: t('queueFailed', { error: String(error) }), isError: true } })))}
                      onError={(error) => setNotices((current) => ({ ...current, [selectedId]: { text: t('queueFailed', { error: String(error) }), isError: true } }))} />
                  </Suspense>
                ) : null}
                onSend={send}
                onStop={() => void cancelTurn(selectedId).catch((error) => setNotices((current) => ({ ...current, [selectedId]: { text: String(error), isError: true } })))}
              />
            </div>
            <ComposerFooter
              cwd={taskCwd}
              label={taskCwd && isConversationCwd(taskCwd) ? t('conversations') : undefined}
              usage={info.usage}
              context={context}
              onCompact={
                selectedAgent === 'claude' && !isRunning && !selectedWriter?.isBusy
                  ? () => void send(COMPACT_COMMAND, [])
                  : undefined
              }
            />
          </ConversationLayout>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto pt-[max(96px,28vh)]">
            <div className="composer-column">
              <div className="mb-[15px] flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
                <BrandLockup />
                <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
                  <ProjectSelect
                    value={newTaskCwd}
                    options={projects}
                    onChange={(cwd) => setSelection({ kind: 'new', cwd })}
                    onAddProject={addProject}
                  />
                  {branch ? (
                    <BranchPill
                      branch={branch}
                      canUseWorktree={startAgent === 'claude'}
                      worktree={useWorktree}
                      onWorktreeChange={setUseWorktree}
                    />
                  ) : null}
                </div>
              </div>
              {hasRemoteNotice ? <ComposerStatusRow {...remoteStatus} /> : null}
              <Composer
                key="new"
                draftKey="new"
                variant="new"
                running={false}
                disabled={!newTaskCwd || !queuesLoaded}
                placeholder={t('placeholder')}
                fill={draftFill}
                sendWithCmdEnter={settings.sendWithCmdEnter}
                toolbarLeft={<PermissionSelect agent={selectedAgent} prefs={prefs} models={info.models} onChange={changePrefs} />}
                toolbarRight={
                  <ModelSelect
                    agent={selectedAgent}
                    prefs={prefs}
                    models={info.models}
                    usage={info.usage}
                    status={infoStates[selectedAgent]}
                    onRefresh={() => refreshInfo(selectedAgent)}
                    onChange={changePrefs}
                    others={otherAgents.map((otherAgent) => ({
                      agent: otherAgent,
                      prefs: allPrefs[otherAgent],
                      models: infos[otherAgent].models,
                      usage: infos[otherAgent].usage,
                      status: infoStates[otherAgent],
                      onRefresh: () => refreshInfo(otherAgent),
                      onChoose: (next) => {
                        changePrefsFor(otherAgent, next);
                        setNewTaskAgent(otherAgent);
                        saveNewTaskAgent(otherAgent);
                        setUseWorktree(false);
                      },
                    }))}
                  />
                }
                onSend={send}
                onStop={() => undefined}
              />
              <ComposerFooter cwd={null} usage={info.usage} context={null} />
              {newTaskError ? <NoticeLine notice={{ text: newTaskError, isError: true }} /> : null}
              {queueLoadError ? <NoticeLine notice={{ text: queueLoadError, isError: true }} /> : null}
              <HomeSuggestions onSelect={(text) => setDraftFill({ text })} />
            </div>
          </div>
        )}
      </main>
      {menuAnchor && menuTask ? (
        <TaskMenu
          anchor={menuAnchor}
          task={menuTask}
          meta={taskMeta}
          onMetaChange={changeTaskMeta}
          generatingTitle={generatingTitles.has(menuAnchor.id)}
          onGenerateTitle={(agent, id) => {
            navigate({ kind: 'task', id });
            void generateTitle(agent, id);
          }}
          onRename={(id) => {
            setSidebarCollapsed(false);
            setRenamingId(id);
          }}
          onClose={closeMenu}
        />
      ) : null}
    </div>
    {remoteDialog}
  </>;
}

function userItemFor(prompt: string, attachments: Attachment[], id: string): Item {
  return prompt === COMPACT_COMMAND ? { type: 'compaction', id } : {
    type: 'user', id, text: prompt, at: Date.now(),
    images: attachments.flatMap((attachment) => attachment.preview ?? []),
    files: attachments.filter((attachment) => attachment.kind === 'file').map(({ name, path }) => ({ name, path })),
  };
}

interface TurnSource {
  agent: Agent;
  taskId: string | null;
  newCwd: string | null;
  prompt: string;
  userItem: Item;
  selectOnStart: boolean;
  initialPrefs?: TurnPrefs;
}

function WriterNotice({ writer, onSendAnyway }: { writer: ExternalWriter; onSendAnyway: () => void }) {
  const key = !writer.canOverride
    ? writer.isBusy ? 'writerCodexBusy' : 'writerCodexOpen'
    : writer.fromTerminal
      ? writer.isBusy
        ? 'writerBusyTerminal'
        : 'writerOpenTerminal'
      : writer.isBusy
        ? 'writerBusyProgram'
        : 'writerOpenProgram';
  return (
    <div role="status" className="mb-1.5 flex min-h-8 items-center justify-between gap-3 px-2 text-13 text-[var(--warning-fg)]">
      <span className="min-w-0">{t(key)}</span>
      {writer.canOverride ? (
        <button
          type="button"
          onClick={onSendAnyway}
          className="h-7 shrink-0 rounded-full border border-[var(--border-default)] px-3 text-12 text-[var(--text-primary)] hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
        >
          {t('writerSendAnyway')}
        </button>
      ) : null}
    </div>
  );
}

function NoticeLine({ notice }: { notice: Notice }) {
  return (
    <p
      role="status"
      className={`selectable mb-1.5 flex min-h-8 items-center px-2 text-13 ${
        notice.isError ? 'text-[var(--text-danger)]' : 'text-[var(--text-secondary)]'
      }`}
    >
      {notice.text}
    </p>
  );
}
