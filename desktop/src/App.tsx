import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BrandLockup } from './components/BrandLockup';
import { Composer } from './components/Composer';
import { ComposerFooter, ModelSelect, PermissionSelect, ProjectSelect } from './components/ComposerControls';
import { HomeSuggestions } from './components/HomeSuggestions';
import { PermissionPrompt } from './components/PermissionPrompt';
import { QuestionPrompt } from './components/QuestionPrompt';
import { RunningStatus } from './components/RunningStatus';
import { Sidebar } from './components/Sidebar';
import { TitleBarActions } from './components/TitleBarActions';
import {
  answerRequest,
  appReady,
  cancelTurn,
  listTasks,
  readCliInfo,
  readTask,
  sendTurn,
  type Attachment,
  type CliInfo,
  type Decision,
  type PendingRequest,
  type TaskContext,
  type TaskSummary,
  type TurnEvent,
} from './lib/api';
import { turnOptions, type TurnPrefs } from './lib/composerStatus';
import { t } from './lib/i18n';
import { applyTurnEvent, buildItems, turnStatus, type Item } from './lib/items';
import { canGoBack, canGoForward, currentEntry, goBack, goForward, pushEntry, replaceEntry, startHistory } from './lib/navHistory';
import {
  loadCliInfo,
  loadContextWindows,
  loadSidebarCollapsed,
  loadTurnPrefs,
  saveCliInfo,
  saveContextWindows,
  saveSidebarCollapsed,
  saveTurnPrefs,
} from './lib/preferences';

const MessageStream = lazy(() => import('./components/MessageStream'));

type Selection = { kind: 'task'; id: string } | { kind: 'new'; cwd: string | null };
type Notice = { text: string; isError: boolean };
type TurnProgress = { startedAt: number; outputTokens: number; activity: number };

function finishedNotice(event: Extract<TurnEvent, { type: 'finished' }>): Notice | null {
  if (event.cancelled) return { text: t('cancelled'), isError: false };
  if (event.isError) return { text: t('turnFailed', { error: event.message ?? '' }), isError: true };
  return null;
}

export function App() {
  const [tasks, setTasks] = useState<TaskSummary[] | null>(null);
  const [nav, setNav] = useState(() => startHistory<Selection>({ kind: 'new', cwd: null }));
  const selection = currentEntry(nav);
  // Choosing a project, or a new task getting its id, is still the same page.
  const setSelection = useCallback((next: Selection) => setNav((current) => replaceEntry(current, next)), []);
  const navigate = useCallback((next: Selection) => setNav((current) => pushEntry(current, next)), []);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(loadSidebarCollapsed);
  const [draftFill, setDraftFill] = useState<{ text: string }>();
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [history, setHistory] = useState<Item[]>([]);
  const [live, setLive] = useState<Record<string, Item[]>>({});
  const [notices, setNotices] = useState<Record<string, Notice>>({});
  const [pending, setPending] = useState<Record<string, PendingRequest[]>>({});
  const [progress, setProgress] = useState<Record<string, TurnProgress>>({});
  const [contexts, setContexts] = useState<Record<string, TaskContext>>({});
  const [contextWindows, setContextWindows] = useState(loadContextWindows);
  const [cliInfo, setCliInfo] = useState<CliInfo>(loadCliInfo);
  const [prefs, setPrefs] = useState<TurnPrefs>(loadTurnPrefs);
  const [newTaskCwds, setNewTaskCwds] = useState<Record<string, string>>({});
  // The CLI has not written a new task's file yet, so its live items are all there is to show.
  const unwrittenTasks = useRef(new Set<string>());
  const selectedId = selection.kind === 'task' ? selection.id : null;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  const refreshTasks = useCallback(async () => {
    try {
      setTasks(await listTasks());
    } catch (error) {
      setTasks([]);
      console.error(error);
    }
  }, []);

  const loadHistory = useCallback(async (id: string) => {
    try {
      const { messages, context } = await readTask(id);
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

  useEffect(() => {
    void refreshTasks();
    // Tasks can change in a terminal while Tandem is in the background.
    window.addEventListener('focus', refreshTasks);
    return () => window.removeEventListener('focus', refreshTasks);
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
        setCliInfo(info);
        saveCliInfo(info);
      })
      .catch(console.error);
    return () => {
      isCurrent = false;
    };
  }, [tasksLoaded]);

  useEffect(() => {
    setHistory([]);
    setLoadedId(null);
    if (selectedId && !unwrittenTasks.current.has(selectedId)) void loadHistory(selectedId);
  }, [selectedId, loadHistory]);

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

  const send = useCallback(
    (prompt: string, attachments: Attachment[]) => {
      if (selection.kind === 'new' && !selection.cwd) return;
      let taskId = selection.kind === 'task' ? selection.id : null;
      const images = attachments.flatMap((attachment) => attachment.preview ?? []);
      const files = attachments
        .filter((attachment) => attachment.kind === 'file')
        .map(({ name, path }) => ({ name, path }));
      const userItem: Item = { type: 'user', id: `live-user-${Date.now()}`, text: prompt, images, files };
      if (taskId) {
        const id = taskId;
        setLive((current) => ({ ...current, [id]: [userItem] }));
        setNotices(({ [id]: _removed, ...rest }) => rest);
      }
      const target = taskId ? { taskId } : { cwd: (selection as { cwd: string }).cwd };
      const isNew = taskId === null;
      let ended = false;
      let isListed = !isNew;
      void sendTurn(target, prompt, attachments, turnOptions(prefs, cliInfo.models), (event) => {
        // The process can still print lines after its result, when the turn is already over.
        if (ended) return;
        if (event.type === 'started') {
          const id = event.taskId;
          taskId = id;
          setProgress((current) => ({
            ...current,
            [id]: { startedAt: Date.now(), outputTokens: 0, activity: 0 },
          }));
          if (isNew) {
            unwrittenTasks.current.add(id);
            setNewTaskCwds((current) => ({ ...current, [id]: (selection as { cwd: string }).cwd }));
            setLive((current) => ({ ...current, [id]: [userItem] }));
            setSelection({ kind: 'task', id });
          }
          return;
        }
        const id = taskId;
        if (!id) return;
        if (event.type === 'permissionRequest' || event.type === 'question') {
          setPending((current) => ({ ...current, [id]: [...(current[id] ?? []), event] }));
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
            void refreshTasks();
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
          setCliInfo((current) => {
            const next = { ...current, usage: event.windows };
            saveCliInfo(next);
            return next;
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
          unwrittenTasks.current.delete(id);
          clearTurn(id);
          const notice = finishedNotice(event);
          if (notice) setNotices((current) => ({ ...current, [id]: notice }));
          void (async () => {
            if (selectedIdRef.current === id) await loadHistory(id);
            setLive(({ [id]: _removed, ...rest }) => rest);
            await refreshTasks();
          })();
          return;
        }
        setLive((current) => ({
          ...current,
          [id]: applyTurnEvent(current[id] ?? [], event),
        }));
      }).catch((error) => {
        const id = taskId;
        if (id) {
          setNotices((current) => ({
            ...current,
            [id]: { text: t('turnFailed', { error: String(error) }), isError: true },
          }));
          setLive(({ [id]: _removed, ...rest }) => rest);
          unwrittenTasks.current.delete(id);
          clearTurn(id);
        }
      });
    },
    [selection, setSelection, prefs, cliInfo.models, loadHistory, refreshTasks, settleRequest, clearTurn],
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

  const changePrefs = useCallback((next: TurnPrefs) => {
    setPrefs(next);
    saveTurnPrefs(next);
  }, []);

  const running = useMemo(() => new Set(Object.keys(live)), [live]);
  const waiting = useMemo(
    () => new Set(Object.keys(pending).filter((id) => pending[id].length > 0)),
    [pending],
  );
  const selectedTask = tasks?.find((task) => task.id === selectedId);
  const items = useMemo(
    () => (selectedId ? [...history, ...(live[selectedId] ?? [])] : []),
    [history, live, selectedId],
  );
  const notice = selectedId ? notices[selectedId] : undefined;
  const isRunning = selectedId ? running.has(selectedId) : false;
  const selectedPending = selectedId ? pending[selectedId]?.[0] : undefined;
  const selectedProgress = selectedId ? progress[selectedId] : undefined;
  const liveItems = selectedId ? live[selectedId] : undefined;
  const selectedContext = selectedId ? contexts[selectedId] : undefined;
  const contextWindow = selectedContext?.model ? contextWindows[selectedContext.model] : undefined;
  const context =
    selectedContext && contextWindow
      ? { usedTokens: selectedContext.usedTokens, windowTokens: contextWindow }
      : null;

  // Tasks arrive newest first, so the first project is the most recently used one.
  const projects = useMemo(() => [...new Set((tasks ?? []).map((task) => task.cwd))], [tasks]);
  const newTaskCwd = selection.kind === 'new' ? (selection.cwd ?? projects[0] ?? null) : null;

  useEffect(() => {
    if (selection.kind === 'new' && !selection.cwd && newTaskCwd) {
      setSelection({ kind: 'new', cwd: newTaskCwd });
    }
  }, [selection, setSelection, newTaskCwd]);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((current) => {
      saveSidebarCollapsed(!current);
      return !current;
    });
  }, []);

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
          onSelect={(id) => navigate({ kind: 'task', id })}
          onNewTask={(cwd) =>
            navigate({
              kind: 'new',
              cwd: cwd ?? selectedTask?.cwd ?? newTaskCwd ?? projects[0] ?? null,
            })
          }
        />
      )}
      <main className="content-area flex min-w-0 flex-1 flex-col bg-[hsl(var(--content-area))]">
        <header
          data-tauri-drag-region
          className={`flex h-[46px] shrink-0 select-none items-center pr-4 ${
            sidebarCollapsed ? 'pl-[176px]' : 'pl-4'
          } ${selectedId ? 'border-b border-[hsl(var(--titlebar-border))]' : ''}`}
        >
          <span data-tauri-drag-region className="truncate text-13 font-medium">
            {selectedTask?.title ?? ''}
          </span>
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
              {isRunning && selectedProgress ? (
                <RunningStatus
                  status={turnStatus(liveItems ?? [], selectedPending !== undefined)}
                  startedAt={selectedProgress.startedAt}
                  outputTokens={selectedProgress.outputTokens}
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
                  placeholder={t('placeholderContinue')}
                  toolbarLeft={
                    <PermissionSelect prefs={prefs} models={cliInfo.models} disabled={isRunning} onChange={changePrefs} />
                  }
                  toolbarRight={
                    <ModelSelect prefs={prefs} models={cliInfo.models} disabled={isRunning} onChange={changePrefs} />
                  }
                  onSend={send}
                  onStop={() => void cancelTurn(selectedId)}
                />
              </div>
              <ComposerFooter cwd={selectedTask?.cwd ?? (selectedId ? newTaskCwds[selectedId] : null) ?? null} usage={cliInfo.usage} context={context} />
            </div>
          </>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto pt-[max(96px,28vh)]">
            <div className="composer-column">
              <div className="mb-[15px] flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
                <BrandLockup />
                <ProjectSelect
                  value={newTaskCwd}
                  options={projects}
                  onChange={(cwd) => setSelection({ kind: 'new', cwd })}
                />
              </div>
              <Composer
                key="new"
                running={false}
                disabled={!newTaskCwd}
                placeholder={t('placeholder')}
                fill={draftFill}
                toolbarLeft={<PermissionSelect prefs={prefs} models={cliInfo.models} onChange={changePrefs} />}
                toolbarRight={<ModelSelect prefs={prefs} models={cliInfo.models} onChange={changePrefs} />}
                onSend={send}
                onStop={() => undefined}
              />
              <ComposerFooter cwd={null} usage={cliInfo.usage} context={null} />
              {tasks !== null && projects.length === 0 ? (
                <p className="mt-3 text-13 text-[var(--text-secondary)]">{t('noProject')}</p>
              ) : null}
              <HomeSuggestions onSelect={(text) => setDraftFill({ text })} />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function NoticeLine({ notice }: { notice: Notice }) {
  return (
    <p
      role="status"
      className={`selectable mb-2 text-13 ${
        notice.isError ? 'text-[var(--text-danger)]' : 'text-[var(--text-secondary)]'
      }`}
    >
      {notice.text}
    </p>
  );
}
