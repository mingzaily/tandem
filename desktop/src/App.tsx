import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Composer } from './components/Composer';
import { Sidebar } from './components/Sidebar';
import {
  appReady,
  cancelTurn,
  listTasks,
  readTask,
  sendTurn,
  type TaskSummary,
  type TurnEvent,
} from './lib/api';
import { t } from './lib/i18n';
import { applyTurnEvent, buildItems, type Item } from './lib/items';

const MessageStream = lazy(() => import('./components/MessageStream'));

type Selection = { kind: 'task'; id: string } | { kind: 'new'; cwd: string | null };
type Notice = { text: string; isError: boolean };

function finishedNotice(event: Extract<TurnEvent, { type: 'finished' }>): Notice | null {
  if (event.cancelled) return { text: t('cancelled'), isError: false };
  if (event.isError) return { text: t('turnFailed', { error: event.message ?? '' }), isError: true };
  if (event.deniedTools.length > 0) {
    const tools = [...new Set(event.deniedTools)].join(', ');
    return { text: t('denied', { tools }), isError: true };
  }
  return null;
}

export function App() {
  const [tasks, setTasks] = useState<TaskSummary[] | null>(null);
  const [selection, setSelection] = useState<Selection>({ kind: 'new', cwd: null });
  const [history, setHistory] = useState<Item[]>([]);
  const [live, setLive] = useState<Record<string, Item[]>>({});
  const [notices, setNotices] = useState<Record<string, Notice>>({});
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
      const messages = await readTask(id);
      if (selectedIdRef.current === id) setHistory(buildItems(messages));
    } catch (error) {
      setNotices((current) => ({
        ...current,
        [id]: { text: t('loadFailed', { error: String(error) }), isError: true },
      }));
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

  useEffect(() => {
    setHistory([]);
    if (selectedId) void loadHistory(selectedId);
  }, [selectedId, loadHistory]);

  const send = useCallback(
    (prompt: string) => {
      if (selection.kind === 'new' && !selection.cwd) return;
      let taskId = selection.kind === 'task' ? selection.id : null;
      const userItem: Item = { type: 'user', id: `live-user-${Date.now()}`, text: prompt };
      if (taskId) {
        const id = taskId;
        setLive((current) => ({ ...current, [id]: [userItem] }));
        setNotices(({ [id]: _removed, ...rest }) => rest);
      }
      const target = taskId ? { taskId } : { cwd: (selection as { cwd: string }).cwd };
      const isNew = taskId === null;
      void sendTurn(target, prompt, (event) => {
        if (event.type === 'started') {
          const id = event.taskId;
          taskId = id;
          if (isNew) {
            setLive((current) => ({ ...current, [id]: [userItem] }));
            setSelection({ kind: 'task', id });
          }
          return;
        }
        const id = taskId;
        if (!id) return;
        if (event.type === 'finished') {
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
        }
      });
    },
    [selection, loadHistory, refreshTasks],
  );

  const running = useMemo(() => new Set(Object.keys(live)), [live]);
  const selectedTask = tasks?.find((task) => task.id === selectedId);
  const items = useMemo(
    () => (selectedId ? [...history, ...(live[selectedId] ?? [])] : []),
    [history, live, selectedId],
  );
  const notice = selectedId ? notices[selectedId] : undefined;
  const isRunning = selectedId ? running.has(selectedId) : false;
  // Tasks arrive newest first, so the first project is the most recently used one.
  const projects = useMemo(() => [...new Set((tasks ?? []).map((task) => task.cwd))], [tasks]);
  const newTaskCwd = selection.kind === 'new' ? (selection.cwd ?? projects[0] ?? null) : null;

  useEffect(() => {
    if (selection.kind === 'new' && !selection.cwd && newTaskCwd) {
      setSelection({ kind: 'new', cwd: newTaskCwd });
    }
  }, [selection, newTaskCwd]);

  return (
    <div className="flex h-full">
      <Sidebar
        tasks={tasks ?? []}
        loaded={tasks !== null}
        selectedId={selectedId}
        isNewTask={selection.kind === 'new'}
        running={running}
        onSelect={(id) => setSelection({ kind: 'task', id })}
        onNewTask={(cwd) =>
          setSelection({
            kind: 'new',
            cwd: cwd ?? selectedTask?.cwd ?? newTaskCwd ?? projects[0] ?? null,
          })
        }
      />
      <main className="flex min-w-0 flex-1 flex-col">
        <header
          data-tauri-drag-region
          className={`flex h-[46px] shrink-0 select-none items-center px-4 ${
            selectedId ? 'border-b border-[hsl(var(--titlebar-border))]' : ''
          }`}
        >
          <span data-tauri-drag-region className="truncate text-13 font-medium">
            {selectedTask?.title ?? ''}
          </span>
        </header>
        {selectedId ? (
          <>
            <div className="min-h-0 flex-1">
              <Suspense fallback={null}>
                <MessageStream key={selectedId} items={items} isRunning={isRunning} />
              </Suspense>
            </div>
            <div className="mx-auto w-full max-w-[880px] px-[50px] pb-4 pt-2">
              {notice ? <NoticeLine notice={notice} /> : null}
              <Composer
                key={selectedId}
                running={isRunning}
                onSend={send}
                onStop={() => void cancelTurn(selectedId)}
              />
            </div>
          </>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-8 pt-[max(96px,28vh)]">
            <div className="mx-auto w-full max-w-[720px]">
              <Composer
                key="new"
                running={false}
                disabled={!newTaskCwd}
                projects={{
                  value: newTaskCwd,
                  options: projects,
                  onChange: (cwd) => setSelection({ kind: 'new', cwd }),
                }}
                onSend={send}
                onStop={() => undefined}
              />
              {tasks !== null && projects.length === 0 ? (
                <p className="mt-3 text-13 text-[var(--text-secondary)]">{t('noProject')}</p>
              ) : null}
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
