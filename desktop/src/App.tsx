import { getVersion } from '@tauri-apps/api/app';
import { MoreHorizontal } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BrandLockup } from './components/BrandLockup';
import { Composer } from './components/Composer';
import { BranchPill, ComposerFooter, ModelSelect, PermissionSelect, ProjectSelect } from './components/ComposerControls';
import { HomeSuggestions } from './components/HomeSuggestions';
import { PermissionPrompt } from './components/PermissionPrompt';
import { QuestionPrompt } from './components/QuestionPrompt';
import { RunningStatus } from './components/RunningStatus';
import { SettingsView } from './components/SettingsView';
import { Sidebar, SIDEBAR_DEFAULT_WIDTH } from './components/Sidebar';
import { TaskMenu, type TaskMenuAnchor } from './components/TaskMenu';
import { TitleBarActions } from './components/TitleBarActions';
import {
  answerRequest,
  appReady,
  cancelTurn,
  createConversationDir,
  defaultConversationDir,
  discoverProjects,
  externalWriters,
  gitBranch,
  listCodexTasks,
  listPiTasks,
  notifyUser,
  onTrayOpenSettings,
  onTrayOpenTask,
  listTasks,
  pickProject,
  readCodexInfo,
  readPiInfo,
  readCliInfo,
  readTask,
  onRemoteTurn,
  remoteUpdateContext,
  sendTurn,
  setKeepRunning,
  taskStamp,
  updateTray,
  type Agent,
  type Attachment,
  type CliInfo,
  type Decision,
  type ExternalWriter,
  type PendingRequest,
  type TaskContext,
  type TaskSummary,
  type TraySource,
  type TrayWindow,
  type TraySummary,
  type TrayTask,
  type TurnEvent,
} from './lib/api';
import { describeUsage, turnOptions, type TurnPrefs } from './lib/composerStatus';
import { currentLanguage, t } from './lib/i18n';
import { emptyRateHistory, recordActivity, type RateHistory } from './lib/tokenRate';
import { applyTurnEvent, buildItems, CONVERSATION_CWD, groupRoot, isUnder, projectName, turnStatus, type Item } from './lib/items';
import { canGoBack, canGoForward, currentEntry, goBack, goForward, pushEntry, replaceEntry, startHistory } from './lib/navHistory';
import {
  areProjectsSeeded,
  loadContextWindows,
  loadExtraProjects,
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
  saveSidebarCollapsed,
  saveSidebarWidth,
  saveTaskMeta,
} from './lib/preferences';

import { applySettings, loadSettings, saveSettings, watchSystemTheme, type AppSettings } from './lib/settings';
import { taskTitle, type TaskMeta } from './lib/taskMeta';

/** Listing Codex tasks starts a helper process, so a run of window focus changes shares one. */
const CODEX_LIST_MIN_INTERVAL_MS = 30_000;

/** Only reads a few small files, so this is cheap enough to do while the window is in use. */
const WRITER_POLL_MS = 5000;
const COMPACT_COMMAND = '/compact';
const HIDDEN_POLL_EVERY = 6;
/** A task that takes a while to read reloads less often, so following it stays cheap. */
const RELOAD_COST_FACTOR = 10;
/** On first launch, projects used this recently are added, so the list does not start empty. */
const SEED_RECENT_MS = 30 * 24 * 60 * 60 * 1000;

const MessageStream = lazy(() => import('./components/MessageStream'));

type Selection = { kind: 'task'; id: string } | { kind: 'new'; cwd: string | null } | { kind: 'settings' };
type Notice = { text: string; isError: boolean };
type TurnProgress = { startedAt: number; outputTokens: number; activity: number; rate: RateHistory };

function finishedNotice(event: Extract<TurnEvent, { type: 'finished' }>): Notice | null {
  // A stopped turn is marked in the conversation, where it happened.
  if (event.cancelled) return null;
  if (event.isError) return { text: t('turnFailed', { error: event.message ?? '' }), isError: true };
  return null;
}

export function App() {
  const [claudeTasks, setClaudeTasks] = useState<TaskSummary[] | null>(null);
  const [codexTasks, setCodexTasks] = useState<TaskSummary[]>([]);
  const [piTasks, setPiTasks] = useState<TaskSummary[]>([]);
  const lastCodexList = useRef(0);
  const tasks = useMemo(
    () =>
      claudeTasks && [...claudeTasks, ...codexTasks, ...piTasks].sort((first, second) => second.updatedAtMs - first.updatedAtMs),
    [claudeTasks, codexTasks, piTasks],
  );
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
  const [sidebarWidth, setSidebarWidth] = useState(() => loadSidebarWidth(SIDEBAR_DEFAULT_WIDTH));
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<TaskMenuAnchor | null>(null);
  const [version, setVersion] = useState('');
  const [branch, setBranch] = useState<string | null>(null);
  const [useWorktree, setUseWorktree] = useState(false);
  const [writers, setWriters] = useState<ExternalWriter[]>([]);
  const [overriddenWriters, setOverriddenWriters] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<Item[]>([]);
  const [live, setLive] = useState<Record<string, Item[]>>({});
  const [stoppedTasks, setStoppedTasks] = useState<Set<string>>(new Set());
  const [notices, setNotices] = useState<Record<string, Notice>>({});
  const [pending, setPending] = useState<Record<string, PendingRequest[]>>({});
  const [progress, setProgress] = useState<Record<string, TurnProgress>>({});
  const [contexts, setContexts] = useState<Record<string, TaskContext>>({});
  const [contextWindows, setContextWindows] = useState(loadContextWindows);
  const [infos, setInfos] = useState<Record<Agent, CliInfo>>(() => ({
    claude: loadInfoFor('claude'),
    codex: loadInfoFor('codex'),
    pi: loadInfoFor('pi'),
  }));
  const [allPrefs, setAllPrefs] = useState<Record<Agent, TurnPrefs>>(() => ({
    claude: loadPrefsFor('claude'),
    codex: loadPrefsFor('codex'),
    pi: loadPrefsFor('pi'),
  }));
  const [newTaskAgent, setNewTaskAgent] = useState<Agent>(loadNewTaskAgent);
  const [newTaskAgents, setNewTaskAgents] = useState<Record<string, Agent>>({});
  const [newTaskError, setNewTaskError] = useState<string | null>(null);
  // A new task joins the list only after its first response. Until then its prompt names it.
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
  const refreshCodexTasks = useCallback(async (force: boolean) => {
    if (!scanRoots.current) return;
    if (!force && Date.now() - lastCodexList.current < CODEX_LIST_MIN_INTERVAL_MS) return;
    lastCodexList.current = Date.now();
    const { projects, conversations } = scanRoots.current;
    try {
      setCodexTasks(await listCodexTasks(projects, conversations));
    } catch (error) {
      console.error(error);
    }
  }, []);

  const refreshTasks = useCallback(
    async (forceCodex = false) => {
      // Waits for the first-launch project list, or it would show nothing and then everything.
      if (!scanRoots.current) return;
      const { projects, conversations } = scanRoots.current;
      try {
        setClaudeTasks(await listTasks([...projects, ...conversations]));
      } catch (error) {
        setClaudeTasks([]);
        console.error(error);
      }
      listPiTasks(projects, conversations).then(setPiTasks).catch(console.error);
      // Separately, so a slow helper process never holds back the Claude list.
      void refreshCodexTasks(forceCodex);
    },
    [refreshCodexTasks],
  );

  const loadHistory = useCallback(async (agent: Agent, id: string) => {
    try {
      const { messages, context } = await readTask(agent, id);
      if (selectedIdRef.current === id) setHistory(buildItems(messages));
      if (context) setContexts((current) => ({ ...current, [id]: context }));
    } catch (error) {
      setNotices((current) => ({
        ...current,
        [id]: { text: t('loadFailed', { error: String(error) }), isError: true },
      }));
    } finally {
      if (selectedIdRef.current === id) setLoadedId(id);
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

  // Runs a short-lived CLI process, so it waits until tasks have loaded. This happens once per
  // launch: a running turn keeps the usage fresh after that.
  const tasksLoaded = tasks !== null;
  useEffect(() => {
    if (!tasksLoaded) return;
    let isCurrent = true;
    readCliInfo()
      .then((info) => {
        if (!isCurrent) return;
        setInfos((current) => ({ ...current, claude: info }));
        saveInfoFor('claude', info);
      })
      .catch(console.error);
    for (const [agent, read] of [['codex', readCodexInfo], ['pi', readPiInfo]] as const) {
      read()
        .then((info) => {
          if (!isCurrent) return;
          setInfos((current) => ({ ...current, [agent]: info }));
          saveInfoFor(agent, info);
        })
        .catch(console.error);
    }
    return () => {
      isCurrent = false;
    };
  }, [tasksLoaded]);

  const selectedTaskAgent = tasks?.find((task) => task.id === selectedId)?.agent;
  const selectedAgent: Agent = selectedId
    ? (selectedTaskAgent ?? newTaskAgents[selectedId] ?? 'claude')
    : newTaskAgent;
  const prefs = allPrefs[selectedAgent];
  const info = infos[selectedAgent];

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
    ({ agent, taskId: knownId, newCwd, prompt, userItem, selectOnStart }: TurnSource) => {
      let taskId = knownId;
      const isNew = knownId === null;
      let ended = false;
      let isListed = !isNew;
      const onEvent = (event: TurnEvent) => {
        // The process can still print lines after its result, when the turn is already over.
        if (ended) return;
        if (event.type === 'started') {
          const id = event.taskId;
          taskId = id;
          setStoppedTasks((current) => {
            if (!current.has(id)) return current;
            const next = new Set(current);
            next.delete(id);
            return next;
          });
          setProgress((current) => ({
            ...current,
            [id]: { startedAt: Date.now(), outputTokens: 0, activity: 0, rate: emptyRateHistory(Date.now()) },
          }));
          // A turn sent from a phone reaches this window at its first event.
          setLive((current) => (current[id] ? current : { ...current, [id]: [userItem] }));
          if (isNew) {
            unwrittenTasks.current.add(id);
            setNewTaskCwds((current) => ({ ...current, [id]: newCwd as string }));
            setNewTaskAgents((current) => ({ ...current, [id]: agent }));
            const firstLine = prompt.split('\n').find((line) => line.trim())?.trim();
            setDraftTitles((current) => ({ ...current, [id]: firstLine ?? t('attachmentsOnly') }));
            if (selectOnStart) setSelection({ kind: 'task', id });
          }
          return;
        }
        const id = taskId;
        if (!id) return;
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
          // The first response means the task file exists, so the task can join the list.
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
          setInfos((current) => {
            const next = { ...current[agent], usage: event.windows };
            saveInfoFor(agent, next);
            return { ...current, [agent]: next };
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
                rate: recordActivity(turn.rate, Date.now(), event.type === 'outputTokens' ? event.total : turn.outputTokens),
              },
            };
          });
        }
        if (event.type === 'outputTokens') return;
        if (event.type === 'finished') {
          ended = true;
          unwrittenTasks.current.delete(id);
          clearTurn(id);
          if (event.cancelled) setStoppedTasks((current) => new Set(current).add(id));
          const notice = finishedNotice(event);
          if (notice) setNotices((current) => ({ ...current, [id]: notice }));
          if (!event.cancelled) notifyIfAway(event.isError ? t('notifyFailed') : t('notifyDone'), id);
          void (async () => {
            if (selectedIdRef.current === id) await loadHistory(agent, id);
            setLive(({ [id]: _removed, ...rest }) => rest);
            await refreshTasks(agent === 'codex');
          })();
          return;
        }
        setLive((current) => ({
          ...current,
          [id]: applyTurnEvent(current[id] ?? [], event),
        }));
      };
      return { onEvent, taskId: () => taskId };
    },
    [setSelection, notifyIfAway, loadHistory, refreshTasks, settleRequest, clearTurn],
  );

  // Turns started from a phone show here too, each with its own handler until it finishes.
  const remoteTurns = useRef(new Map<string, ReturnType<typeof createTurnHandler>>());
  const latestCreateTurnHandler = useRef(createTurnHandler);
  latestCreateTurnHandler.current = createTurnHandler;
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
    remoteUpdateContext({
      projects: extraProjects,
      conversationRoots,
      conversationDir: settings.conversationDir,
      archived: taskMeta.archived,
      titles: taskMeta.titles,
      language: currentLanguage(),
    }).catch(console.error);
  }, [extraProjects, conversationRoots, settings.conversationDir, taskMeta]);

  const startTurn = useCallback(
    (prompt: string, attachments: Attachment[], newCwd: string | null) => {
      const taskId = selection.kind === 'task' ? selection.id : null;
      const images = attachments.flatMap((attachment) => attachment.preview ?? []);
      const files = attachments
        .filter((attachment) => attachment.kind === 'file')
        .map(({ name, path }) => ({ name, path }));
      const liveId = `live-user-${Date.now()}`;
      const userItem: Item =
        prompt === COMPACT_COMMAND
          ? { type: 'compaction', id: liveId }
          : { type: 'user', id: liveId, text: prompt, images, files };
      if (taskId) {
        const id = taskId;
        setLive((current) => ({ ...current, [id]: [userItem] }));
        setNotices(({ [id]: _removed, ...rest }) => rest);
      }
      const target = taskId ? { taskId } : { cwd: newCwd as string };
      const agent = selectedAgent;
      setNewTaskError(null);
      const options = {
        ...turnOptions(prefs, info.models),
        // Pi has no permission modes, and any saved choice belongs to another agent's menu.
        ...(agent === 'pi' ? { permissionMode: null } : {}),
        worktree: agent === 'claude' && taskId === null && useWorktree,
        ignoreExternalWriter: taskId !== null && overriddenWriters.has(taskId),
      };
      const turn = createTurnHandler({ agent, taskId, newCwd, prompt, userItem, selectOnStart: true });
      void sendTurn(agent, target, prompt, attachments, options, turn.onEvent).catch((error) => {
        const id = turn.taskId();
        if (id) {
          setNotices((current) => ({
            ...current,
            [id]: { text: t('turnFailed', { error: String(error) }), isError: true },
          }));
          setLive(({ [id]: _removed, ...rest }) => rest);
          unwrittenTasks.current.delete(id);
          clearTurn(id);
        } else {
          // Codex can fail before it has a thread, and then there is no task to show this on.
          setNewTaskError(t('turnFailed', { error: String(error) }));
        }
      });
    },
    [selection, setSelection, selectedAgent, prefs, info.models, useWorktree, overriddenWriters, createTurnHandler, clearTurn],
  );

  const send = useCallback(
    (prompt: string, attachments: Attachment[]) => {
      if (selection.kind !== 'new') {
        startTurn(prompt, attachments, null);
      } else if (selection.cwd === CONVERSATION_CWD) {
        setNewTaskError(null);
        createConversationDir(settings.conversationDir)
          .then((cwd) => startTurn(prompt, attachments, cwd))
          .catch((error) => setNewTaskError(t('turnFailed', { error: String(error) })));
      } else if (selection.cwd) {
        startTurn(prompt, attachments, selection.cwd);
      }
    },
    [selection, settings.conversationDir, startTurn],
  );

  const answer = useCallback(
    (taskId: string, requestId: string, decision: Decision) => {
      settleRequest(taskId, requestId);
      answerRequest(taskId, requestId, decision).catch((error) => {
        setNotices((current) => ({
          ...current,
          [taskId]: { text: t('requestFailed', { error: String(error) }), isError: true },
        }));
      });
    },
    [settleRequest],
  );

  const changePrefsFor = useCallback((agent: Agent, next: TurnPrefs) => {
    setAllPrefs((current) => ({ ...current, [agent]: next }));
    savePrefsFor(agent, next);
  }, []);
  const changePrefs = (next: TurnPrefs) => changePrefsFor(selectedAgent, next);
  const otherAgents = (['claude', 'codex', 'pi'] as const).filter((agent) => agent !== newTaskAgent);

  const running = useMemo(() => new Set(Object.keys(live)), [live]);
  const external = useMemo(() => new Map(writers.map((writer) => [writer.taskId, writer.isBusy])), [writers]);
  const waiting = useMemo(
    () => new Set(Object.keys(pending).filter((id) => pending[id].length > 0)),
    [pending],
  );
  const selectedTask = tasks?.find((task) => task.id === selectedId);
  const items = useMemo(() => {
    if (!selectedId) return [];
    const all: Item[] = [...history, ...(live[selectedId] ?? [])];
    // Claude records a stop in its file. The others do not, so this window remembers it.
    if (stoppedTasks.has(selectedId) && all.at(-1)?.type !== 'notice') {
      all.push({ type: 'notice', id: `stopped-${selectedId}`, text: t('interrupted') });
    }
    return all;
  }, [history, live, selectedId, stoppedTasks]);
  const notice = selectedId ? notices[selectedId] : undefined;
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

  useEffect(() => {
    if (selection.kind === 'new' && !selection.cwd && newTaskCwd) {
      setSelection({ kind: 'new', cwd: newTaskCwd });
    }
  }, [selection, setSelection, newTaskCwd]);

  useEffect(() => {
    getVersion().then(setVersion).catch(console.error);
    watchSystemTheme(() => settingsRef.current);
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
  const isHeldByWriter = Boolean(
    selectedId && selectedWriter && !(selectedWriter.canOverride && overriddenWriters.has(selectedId)),
  );
  const wasBusyElsewhere = useRef<{ id: string | null; isBusy: boolean }>({ id: null, isBusy: false });
  useEffect(() => {
    const isBusy = selectedWriter?.isBusy ?? false;
    const previous = wasBusyElsewhere.current;
    wasBusyElsewhere.current = { id: selectedId, isBusy };
    if (selectedId && previous.id === selectedId && previous.isBusy && !isBusy) {
      void loadHistory(selectedAgent, selectedId);
      void refreshTasks();
    }
  }, [selectedId, selectedAgent, selectedWriter?.isBusy, loadHistory, refreshTasks]);

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

  useEffect(() => {
    setKeepRunning(settings.keepInMenuBar).catch(console.error);
  }, [settings.keepInMenuBar]);

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
      return [{ id, title: title || t('untitled'), agent: task?.agent ?? newTaskAgents[id] ?? 'claude', status, project }];
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
  }, [writers, live, pending, tasks, taskMeta, draftTitles, newTaskAgents, infos, usageClock]);
  useEffect(() => {
    updateTray(summaryForTray).catch(console.error);
  }, [summaryForTray]);

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
    applySettings(next);
  }, []);

  const changeTaskMeta = useCallback((next: TaskMeta) => {
    setTaskMeta(next);
    saveTaskMeta(next);
  }, []);

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

  if (selection.kind === 'settings') {
    return (
      <SettingsView
        settings={settings}
        onChange={changeSettings}
        extraProjects={extraProjects}
        onExtraProjectsChange={changeExtraProjects}
        defaultConversationDir={defaultConversationRoot}
        version={version}
        onBack={() => setNav(goBack)}
      />
    );
  }

  return (
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
          tasks={tasks ?? []}
          loaded={tasks !== null}
          selectedId={selectedId}
          running={running}
          waiting={waiting}
          external={external}
          meta={taskMeta}
          extraProjects={extraProjects}
          conversationRoots={conversationRoots}
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
          <span data-tauri-drag-region className="min-w-0 flex-1 truncate text-13 font-medium">
            {selectedTask ? taskTitle(taskMeta, selectedTask) : selectedId ? (draftTitles[selectedId] ?? '') : ''}
          </span>
          {selectedTask ? (
            <button
              type="button"
              aria-label={t('taskMenu')}
              title={t('taskMenu')}
              onClick={(event) => {
                const bounds = event.currentTarget.getBoundingClientRect();
                setMenuAnchor({ id: selectedTask.id, x: bounds.right - 200, y: bounds.bottom + 4 });
              }}
              className="ml-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[hsl(var(--titlebar-icon))] hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
            >
              <MoreHorizontal size={15} aria-hidden />
            </button>
          ) : null}
        </header>
        {selectedId ? (
          <>
            <div className="min-h-0 flex-1">
              <Suspense fallback={null}>
                <MessageStream
                  key={selectedId}
                  items={items}
                  isRunning={isRunning}
                  isLoading={loadedId !== selectedId && !unwrittenTasks.current.has(selectedId)}
                />
              </Suspense>
            </div>
            <div className="composer-column pb-3 pt-2">
              {notice ? <NoticeLine notice={notice} /> : null}
              {isHeldByWriter && selectedWriter ? (
                <WriterNotice
                  writer={selectedWriter}
                  onSendAnyway={() => setOverriddenWriters((current) => new Set(current).add(selectedWriter.taskId))}
                />
              ) : null}
              {isRunning && selectedProgress ? (
                <RunningStatus
                  status={turnStatus(liveItems ?? [], selectedPending !== undefined)}
                  startedAt={selectedProgress.startedAt}
                  outputTokens={selectedProgress.outputTokens}
                  rate={selectedProgress.rate}
                  activity={selectedProgress.activity}
                />
              ) : null}
              {selectedPending?.type === 'permissionRequest' ? (
                <PermissionPrompt
                  key={selectedPending.requestId}
                  request={selectedPending}
                  onAnswer={(decision) => answer(selectedId, selectedPending.requestId, decision)}
                />
              ) : null}
              {selectedPending?.type === 'question' ? (
                <QuestionPrompt
                  key={selectedPending.requestId}
                  request={selectedPending}
                  onAnswer={(decision) => answer(selectedId, selectedPending.requestId, decision)}
                />
              ) : null}
              {/* Stays mounted under a prompt, so a half-written message survives it. */}
              <div className={selectedPending ? 'hidden' : undefined}>
                <Composer
                  key={selectedId}
                  running={isRunning}
                  disabled={isHeldByWriter}
                  placeholder={t('placeholderContinue')}
                  sendWithCmdEnter={settings.sendWithCmdEnter}
                  toolbarLeft={
                    <PermissionSelect agent={selectedAgent} prefs={prefs} models={info.models} disabled={isRunning} onChange={changePrefs} />
                  }
                  toolbarRight={
                    <ModelSelect agent={selectedAgent} prefs={prefs} models={info.models} usage={info.usage} disabled={isRunning} onChange={changePrefs} />
                  }
                  onSend={send}
                  onStop={() => void cancelTurn(selectedId)}
                />
              </div>
              <ComposerFooter
                cwd={taskCwd}
                label={taskCwd && isConversationCwd(taskCwd) ? t('conversations') : undefined}
                usage={info.usage}
                context={context}
                onCompact={
                  selectedAgent === 'claude' && !isRunning && !selectedWriter?.isBusy
                    ? () => startTurn(COMPACT_COMMAND, [], null)
                    : undefined
                }
              />
            </div>
          </>
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
                      canUseWorktree={newTaskAgent === 'claude'}
                      worktree={useWorktree}
                      onWorktreeChange={setUseWorktree}
                    />
                  ) : null}
                </div>
              </div>
              <Composer
                key="new"
                running={false}
                disabled={!newTaskCwd}
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
                    onChange={changePrefs}
                    others={otherAgents.map((otherAgent) => ({
                      agent: otherAgent,
                      prefs: allPrefs[otherAgent],
                      models: infos[otherAgent].models,
                      usage: infos[otherAgent].usage,
                      onPrefsChange: (next) => changePrefsFor(otherAgent, next),
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
              <HomeSuggestions onSelect={(text) => setDraftFill({ text })} />
            </div>
          </div>
        )}
      </main>
      {menuAnchor ? (
        <TaskMenu
          anchor={menuAnchor}
          agent={tasks?.find((task) => task.id === menuAnchor.id)?.agent ?? 'claude'}
          meta={taskMeta}
          onMetaChange={changeTaskMeta}
          onRename={(id) => {
            setSidebarCollapsed(false);
            setRenamingId(id);
          }}
          onClose={closeMenu}
        />
      ) : null}
    </div>
  );
}

interface TurnSource {
  agent: Agent;
  taskId: string | null;
  newCwd: string | null;
  prompt: string;
  userItem: Item;
  selectOnStart: boolean;
}

function WriterNotice({ writer, onSendAnyway }: { writer: ExternalWriter; onSendAnyway: () => void }) {
  const key = !writer.canOverride
    ? 'writerCodexOpen'
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
