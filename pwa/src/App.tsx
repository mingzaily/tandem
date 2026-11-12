import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, client } from './lib/api';
import { identityStore } from './lib/storage';
import { parsePairCode } from './lib/pairing';
import type { Status } from './lib/client';
import type { Agent, Message, ModelOption, Run, TaskSummary } from './lib/types';
import { t } from './lib/i18n';
import Stream from './Stream';
import { TaskList } from './TaskList';
import { TaskNotice } from './TaskNotice';
import { TaskInput } from './TaskInput';
import {
  ArrowLeft,
  Ellipsis,
  Link2,
  LockKeyhole,
  Monitor,
  Plus,
  QrCode,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { ComposerControls } from './ComposerControls';
import { Sheet } from './Sheet';
import { RunningStatus } from './RunningStatus';
import { conversationItems } from './lib/conversation';
import { appendRunEvent, LiveSync, pendingRequests, type LiveSnapshot, type RunEvent } from './lib/live';
import { agentName } from './TaskList';
import { TaskCreation } from './lib/creation';
import { AgentMark } from './AgentMark';
import { detectDeviceName, deviceName } from './lib/device';
import {
  DEFAULT_PREFERENCES,
  sentDraft,
  taskPreferences,
  turnOptions,
  type ComposerPreferences,
} from './lib/composer';
const Scanner = lazy(() => import('./Scanner'));
export default function App() {
  const [status, setStatus] = useState<Status>('closed'),
    [error, setError] = useState(''),
    [paired, setPaired] = useState(false);
  const [raw, setRaw] = useState(''),
    [name, setName] = useState(() => deviceName({ userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints })),
    [code, setCode] = useState(''),
    [scanning, setScanning] = useState(false);
  const nameEdited = useRef(false);
  useEffect(() => {
    // The Android model arrives asynchronously; a name the user already typed wins.
    void detectDeviceName().then((detected) => {
      if (!nameEdited.current) setName(detected);
    });
  }, []);
  const [tasks, setTasks] = useState<TaskSummary[]>([]),
    [busy, setBusy] = useState<string[]>([]),
    [projects, setProjects] = useState<{ cwd: string; name: string }[]>([]),
    [conversationRoots, setConversationRoots] = useState<string[]>([]),
    [agents, setAgents] = useState<Agent[]>([]);
  const [selected, setSelected] = useState<TaskSummary | null>(null),
    [creating, setCreating] = useState(false),
    [cwd, setCwd] = useState(''),
    [agent, setAgent] = useState<Agent>('claude');
  const [modelFailures, setModelFailures] = useState<Partial<Record<Agent, string>>>({});
  const [choices, setChoices] = useState<Partial<Record<Agent, ModelOption[]>>>({});
  const [defaults, setDefaults] = useState<Partial<Record<Agent, ComposerPreferences>>>({});
  const [chosenPrefs, setChosenPrefs] = useState<Record<string, ComposerPreferences>>({});
  const [nativePrefs, setNativePrefs] = useState<Record<string, ComposerPreferences>>({});
  const prefs = selected
    ? (chosenPrefs[selected.id] ?? nativePrefs[selected.id] ?? DEFAULT_PREFERENCES)
    : (defaults[agent] ?? DEFAULT_PREFERENCES);
  const { model, effort, permission } = prefs;
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const draftKey = selected?.id ?? 'new';
  const prompt = drafts[draftKey] ?? '';
  function changePreferences(next: ComposerPreferences, targetAgent = agent) {
    if (selected) setChosenPrefs((old) => ({ ...old, [selected.id]: next }));
    else setDefaults((old) => ({ ...old, [targetAgent]: next }));
  }
  const [messages, setMessages] = useState<Message[]>([]),
    [loadedId, setLoadedId] = useState<string | null>(null),
    [before, setBefore] = useState(0),
    [runs, setRuns] = useState<Run[]>([]),
    [sending, setSending] = useState(false);
  const [menu, setMenu] = useState(false);
  const [turnErrors, setTurnErrors] = useState<Record<string, string>>({});
  const [stoppedTasks, setStoppedTasks] = useState(new Set<string>());
  const [syncingTasks, setSyncingTasks] = useState<Record<string, number>>({});
  const [recovering, setRecovering] = useState(false);
  const [recoveryError, setRecoveryError] = useState('');
  const recoveryPromise = useRef<{ version: number; value: Promise<void> } | null>(null);
  const statusRef = useRef(status);
  const pairedRef = useRef(paired);
  statusRef.current = status;
  pairedRef.current = paired;
  const [stoppingTasks, setStoppingTasks] = useState(new Set<string>());
  const stopRequests = useRef(new Set<string>());
  const startedAt = useRef(new Map<string, number>());
  const runRef = useRef<Run[]>([]);
  const changeRuns = (update: (runs: Run[]) => Run[]) => {
    runRef.current = update(runRef.current);
    setRuns(runRef.current);
  };
  const models = choices[agent] ?? [];
  const current = useRef(selected);
  current.current = selected;
  const generation = useRef(0);
  const navigation = useRef(0);
  const liveSync = useRef(new LiveSync());
  const connectionVersion = useRef(0);
  const syncPromise = useRef<{ version: number; value: Promise<LiveSnapshot> } | null>(null);
  const creation = useRef(new TaskCreation());
  const [pendingCreation, setPendingCreation] = useState<{ prefs: ComposerPreferences; text: string } | null>(
    null,
  );
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
  async function refreshProjects() {
    const version = connectionVersion.current;
    const host = await api.host();
    if (version === connectionVersion.current) {
      setProjects(host.projects);
      setConversationRoots(host.conversationRoots);
    }
    return host;
  }
  async function refreshTasks() {
    const version = connectionVersion.current;
    const r = await api.tasks();
    if (version !== connectionVersion.current) return;
    setTasks(r.tasks);
    setSelected((old) => (old ? (r.tasks.find((task) => task.id === old.id) ?? old) : old));
    setBusy(r.external.filter((e) => e.isBusy).map((e) => e.taskId));
  }
  async function read(task: TaskSummary, older = false) {
    const g = ++generation.current;
    const version = connectionVersion.current;
    const finished = new Set(
      runRef.current
        .filter((run) => run.taskId === task.id && run.events.some((event) => event.type === 'finished'))
        .map((run) => run.runId),
    );
    if (!older && finished.size) setSyncingTasks((old) => ({ ...old, [task.id]: g }));
    try {
      const r = await api.read(task.agent, task.id, older ? before : undefined);
      if (
        version !== connectionVersion.current ||
        g !== generation.current ||
        current.current?.id !== task.id
      )
        return;
      setMessages((old) => (older ? [...r.messages, ...old] : r.messages));
      if (!older) {
        const native =
          r.modelSelection ?? (r.context?.model ? { model: r.context.model, effort: null } : null);
        setNativePrefs((old) => ({ ...old, [task.id]: taskPreferences(native, r.permissionMode) }));
        setLoadedId(task.id);
        changeRuns((old) => old.filter((run) => !finished.has(run.runId)));
      }
      setBefore((older ? before : r.total) - r.messages.length);
    } catch (reason) {
      if (
        version === connectionVersion.current &&
        g === generation.current &&
        current.current?.id === task.id
      )
        throw reason;
    } finally {
      setSyncingTasks((old) => {
        if (old[task.id] !== g) return old;
        const next = { ...old };
        delete next[task.id];
        return next;
      });
    }
  }
  function event(f: any) {
    if (f.ev === 'tasks.changed') {
      const version = connectionVersion.current;
      void Promise.all([refreshTasks(), refreshProjects()]).catch((reason) => {
        if (version === connectionVersion.current) fail(reason);
      });
      return;
    }
    if (f.ev === 'turn.event') {
      for (const update of liveSync.current.receive(f.p as RunEvent)) processTurn(update);
    }
  }
  function processTurn(p: RunEvent) {
    creation.current.receive(p);
    if (!startedAt.current.has(p.runId)) startedAt.current.set(p.runId, performance.now() - p.elapsedMs);
    changeRuns((old) => appendRunEvent(old, p));
    if (p.event.type === 'started') {
      const taskId = p.event.taskId;
      setTurnErrors((old) => {
        const next = { ...old };
        delete next[taskId];
        return next;
      });
      setStoppedTasks((old) => {
        const next = new Set(old);
        next.delete(taskId);
        return next;
      });
    }
    if (p.event.type === 'finished') {
      startedAt.current.delete(p.runId);
      const taskId = p.taskId;
      if (taskId) {
        stopRequests.current.delete(taskId);
        setStoppingTasks(new Set(stopRequests.current));
      }
      const failure = p.event.message ?? '';
      if (taskId && p.event.cancelled) setStoppedTasks((old) => new Set(old).add(taskId));
      else if (taskId && p.event.isError) setTurnErrors((old) => ({ ...old, [taskId]: failure }));
      if (!taskId && p.event.isError) fail(p.event.message ?? t('turnFailed'));
      if (current.current?.id === taskId) {
        void read(current.current!).catch(fail);
      } else changeRuns((old) => old.filter((run) => run.runId !== p.runId));
    }
  }
  const eventRef = useRef(event);
  eventRef.current = event;
  async function syncRuns() {
    const version = connectionVersion.current;
    if (syncPromise.current?.version === version) return syncPromise.current.value;
    const epoch = liveSync.current.begin();
    const value = api.snapshot((snapshot) => {
      if (version !== connectionVersion.current) return;
      const held = liveSync.current.restore(epoch, snapshot);
      if (held === null) return;
      creation.current.restore(snapshot.runs);
      startedAt.current = new Map(snapshot.runs.map((run) => [run.runId, performance.now() - run.elapsedMs]));
      changeRuns(() => snapshot.runs);
      for (const update of held) processTurn(update);
    });
    syncPromise.current = { version, value };
    try {
      return await value;
    } finally {
      if (syncPromise.current?.value === value) syncPromise.current = null;
    }
  }
  function recoverWorkspace(): Promise<void> {
    const version = connectionVersion.current;
    if (recoveryPromise.current?.version === version) return recoveryPromise.current.value;
    setRecovering(true);
    setRecoveryError('');
    const value = (async () => {
      const host = await refreshProjects();
      if (version !== connectionVersion.current) return;
      setAgents((old) =>
        old.length === host.agents.length && old.every((agent, index) => agent === host.agents[index])
          ? old
          : host.agents,
      );
      if (!current.current) setAgent((old) => (host.agents.includes(old) ? old : (host.agents[0] ?? old)));
      setCwd((old) =>
        host.projects.some((project) => project.cwd === old) ? old : (host.projects[0]?.cwd ?? ''),
      );
      await refreshTasks();
      if (version !== connectionVersion.current) return;
      await syncRuns();
      if (version !== connectionVersion.current) return;
      if (current.current) await read(current.current);
      if (version === connectionVersion.current) {
        setRecovering(false);
        setError('');
      }
    })()
      .catch((reason) => {
        if (version === connectionVersion.current)
          setRecoveryError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (recoveryPromise.current?.value === value) recoveryPromise.current = null;
      });
    recoveryPromise.current = { version, value };
    return value;
  }
  const recoverRef = useRef(recoverWorkspace);
  recoverRef.current = recoverWorkspace;
  useEffect(() => {
    client.onError = fail;
    client.onCode = setCode;
    client.onStatus = (s) => {
      connectionVersion.current++;
      generation.current++;
      liveSync.current.reset();
      syncPromise.current = null;
      recoveryPromise.current = null;
      stopRequests.current.clear();
      setStoppingTasks(new Set());
      statusRef.current = s;
      setStatus(s);
      if (s === 'ready') void recoverRef.current();
      if (s === 'revoked') {
        setPaired(false);
        setCode('');
        resetWorkspace();
        void identityStore(null).catch(fail);
      }
    };
    client.onEvent = (e) => eventRef.current(e);
    void identityStore()
      .then((i) => {
        if (i) {
          setPaired(true);
          client.connect(i);
        }
      })
      .catch(fail);
    const viewport = () => {
      document.documentElement.style.setProperty(
        '--viewport-height',
        `${window.visualViewport?.height ?? window.innerHeight}px`,
      );
      document.documentElement.style.setProperty(
        '--viewport-top',
        `${window.visualViewport?.offsetTop ?? 0}px`,
      );
    };
    const resume = () => {
      if (document.hidden || !pairedRef.current) return;
      if (statusRef.current === 'ready') {
        void recoverRef.current();
        return;
      }
      if (statusRef.current !== 'offline') return;
      const version = connectionVersion.current;
      void identityStore()
        .then((identity) => {
          if (identity && version === connectionVersion.current) client.connect(identity);
        })
        .catch(fail);
    };
    viewport();
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('pageshow', resume);
    window.addEventListener('online', resume);
    window.visualViewport?.addEventListener('resize', viewport);
    window.visualViewport?.addEventListener('scroll', viewport);
    return () => {
      client.close();
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('pageshow', resume);
      window.removeEventListener('online', resume);
      window.visualViewport?.removeEventListener('resize', viewport);
      window.visualViewport?.removeEventListener('scroll', viewport);
    };
  }, []);
  useEffect(() => {
    if (status !== 'ready' || !agents.length) return;
    let cancelled = false;
    setChoices({});
    setModelFailures({});
    for (const a of agents) {
      void api
        .info(a)
        .then((info) => {
          if (cancelled) return;
          setChoices((old) => ({ ...old, [a]: info.models }));
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          const message = error instanceof Error ? error.message : String(error);
          setModelFailures((old) => ({ ...old, [a]: message }));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [agents, status]);
  const pair = useCallback(
    async (value: string) => {
      setScanning(false);
      setError('');
      setCode('');
      try {
        const identity = await client.pair(parsePairCode(value), name);
        await identityStore(identity);
        setPaired(true);
        setRaw('');
        client.connect(identity);
      } catch (e) {
        fail(e);
        setStatus('closed');
      }
    },
    [name],
  );
  const activeRuns = useMemo(() => runs.filter((r) => r.taskId === selected?.id), [runs, selected?.id]);
  const unfinished = activeRuns.filter((r) => !r.events.some((e) => e.type === 'finished'));
  const events = unfinished.flatMap((r) => r.events);
  const pending = pendingRequests(activeRuns);
  const running = unfinished.length > 0;
  const finishing = Boolean(selected && syncingTasks[selected.id]);
  const streamItems = useMemo(() => {
    const items = conversationItems(messages, activeRuns);
    if (selected && stoppedTasks.has(selected.id) && items.at(-1)?.type !== 'notice') {
      items.push({ type: 'notice', id: `stopped-${selected.id}`, text: t('interrupted') });
    }
    return items;
  }, [messages, activeRuns, selected?.id, stoppedTasks]);
  useEffect(() => {
    if (!pendingCreation) return;
    const result = creation.current.resolve(tasks);
    if (result.task) {
      const task = result.task;
      creation.current.clear();
      setPendingCreation(null);
      current.current = task;
      setSelected(task);
      setAgent(task.agent);
      setChosenPrefs((old) => ({ ...old, [task.id]: pendingCreation.prefs }));
      setCreating(false);
      setLoadedId(task.id);
      if (result.readHistory) void read(task).catch(fail);
    } else if (result.error !== undefined) {
      creation.current.clear();
      setPendingCreation(null);
      setDrafts((old) => ({ ...old, new: old.new ?? pendingCreation.text }));
      setError(result.error || t('turnFailed'));
    }
  }, [pendingCreation, tasks, runs]);
  const locked =
    status !== 'ready' ||
    recovering ||
    sending ||
    Boolean(pendingCreation) ||
    finishing ||
    Boolean(selected && (busy.includes(selected.id) || loadedId !== selected.id));
  async function stop() {
    const taskId = selected?.id;
    if (!taskId || status !== 'ready' || stopRequests.current.has(taskId)) return;
    stopRequests.current.add(taskId);
    setStoppingTasks(new Set(stopRequests.current));
    try {
      await api.stop(taskId);
    } catch (reason) {
      stopRequests.current.delete(taskId);
      setStoppingTasks(new Set(stopRequests.current));
      setTurnErrors((old) => ({
        ...old,
        [taskId]: reason instanceof Error ? reason.message : String(reason),
      }));
    }
  }
  async function send() {
    if (!prompt.trim() || locked || running || !models.length) return;
    const target = selected;
    const key = draftKey;
    const text = prompt;
    const view = navigation.current;
    const version = connectionVersion.current;
    setSending(true);
    setError('');
    if (!target) creation.current.begin({ agent, cwd, prompt: text });
    try {
      const result = await api.send({
        agent,
        taskId: target?.id ?? null,
        cwd: target ? null : cwd,
        prompt: text,
        ...turnOptions(agent, prefs, models),
      });
      if (version !== connectionVersion.current) {
        if (!target) creation.current.clear();
        return;
      }
      setDrafts((old) => sentDraft(old, key, text));
      if (target && current.current?.id === target.id)
        setMessages((old) => [
          ...old,
          {
            id: 'prompt-' + result.runId,
            kind: 'user',
            text,
            timestamp: new Date().toISOString(),
            isError: false,
            truncated: false,
          },
        ]);
      if (!target && navigation.current === view) {
        creation.current.accept(result.runId);
        setPendingCreation({ prefs, text });
        // The lifecycle frame supplies taskId even before the native task is listed.
        void refreshTasks().catch(fail);
      }
    } catch (e) {
      if (!target) {
        creation.current.clear();
        setPendingCreation(null);
      }
      fail(e);
    } finally {
      setSending(false);
    }
  }
  function resetWorkspace() {
    creation.current.clear();
    setPendingCreation(null);
    generation.current++;
    navigation.current++;
    startedAt.current.clear();
    current.current = null;
    setSelected(null);
    setCreating(false);
    setTasks([]);
    setProjects([]);
    setConversationRoots([]);
    setAgents([]);
    setMessages([]);
    setLoadedId(null);
    changeRuns(() => []);
    setChoices({});
    setModelFailures({});
    setBefore(0);
    setDrafts({});
    setDefaults({});
    setChosenPrefs({});
    setNativePrefs({});
    setTurnErrors({});
    setStoppedTasks(new Set());
    setSyncingTasks({});
    setRecoveryError('');
    setRecovering(false);
  }
  function showTasks() {
    creation.current.clear();
    setPendingCreation(null);
    generation.current++;
    navigation.current++;
    setSelected(null);
    current.current = null;
    setCreating(false);
  }
  function createTask() {
    showTasks();
    setCreating(true);
    setMessages([]);
    setBefore(0);
  }
  const hasIdentity = paired && status !== 'revoked';
  return (
    <main>
      {hasIdentity && (
        <header className="app-header">
          {hasIdentity && (selected || creating) ? (
            <button className="icon-button" aria-label={t('back')} onClick={showTasks}>
              <ArrowLeft size={21} />
            </button>
          ) : (
            <div className="brand">
              <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" />
              <strong>Tandem</strong>
            </div>
          )}
          {hasIdentity && (selected || creating) && (
            <div className="header-title">
              <strong>{selected?.title ?? t('create')}</strong>
              <span role="img" aria-label={agentName(agent)} title={agentName(agent)}>
                <AgentMark agent={agent} size={14} />
              </span>
            </div>
          )}
          {hasIdentity && (
            <div className="header-actions">
              <button className="icon-button" aria-label={t('create')} onClick={createTask}>
                <Plus size={21} />
              </button>
              <button
                className="icon-button"
                aria-label={t('connectionMenu')}
                aria-haspopup="dialog"
                aria-expanded={menu}
                onClick={() => setMenu(true)}
              >
                <Ellipsis size={21} />
              </button>
            </div>
          )}
        </header>
      )}
      {hasIdentity && status !== 'ready' && (
        <div className="connection-status" role="status">
          <LockKeyhole size={11} />
          {t(status)}
        </div>
      )}
      {hasIdentity && status === 'ready' && recoveryError && (
        <div className="recovery-notice" role="alert">
          <span>{recoveryError}</span>
          <button onClick={() => void recoverWorkspace()}>{t('retrySync')}</button>
        </div>
      )}
      {status === 'revoked' && (
        <p role="alert" className="error">
          {t('revoked')}
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!hasIdentity ? (
        <section className="pair">
          <div className="pair-hero">
            <div className="pair-lockup">
              <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" />
              <span>Tandem</span>
            </div>
            <p className="eyebrow">{t('pairEyebrow')}</p>
            <h1>{code ? t('verifyTitle') : t('pairTitle')}</h1>
            <p className="pair-description">{code ? t('verifyHint') : t('pairDescription')}</p>
          </div>
          {code ? (
            <div className="verification-card">
              <output className="code" aria-label={t('verifyTitle')}>
                {code.split('').map((digit, i) => (
                  <span key={i}>{digit}</span>
                ))}
              </output>
              <div className="waiting-approval">
                <span className="status-dot" />
                {t('waitingApproval')}
              </div>
              <p>{t('codeHint')}</p>
            </div>
          ) : (
            <div className="pair-form">
              <div className="pair-instruction">
                <Monitor size={17} />
                <span>{t('pairStep')}</span>
              </div>
              <label className="field-label" htmlFor="device-name">
                {t('deviceName')}
              </label>
              <input
                id="device-name"
                autoComplete="off"
                value={name}
                onChange={(e) => {
                  nameEdited.current = true;
                  setName(e.target.value);
                }}
              />
              <label className="field-label" htmlFor="pair-code">
                {t('paste')}
              </label>
              <textarea
                id="pair-code"
                value={raw}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                onChange={(e) => setRaw(e.target.value)}
                placeholder="tandem-pair:…"
              />
              <div className="pair-actions">
                <button
                  disabled={!raw || status === 'pairing'}
                  className="primary"
                  onClick={() => void pair(raw)}
                >
                  <Link2 size={16} />
                  {status === 'pairing' ? t('pairing') : t('pair')}
                </button>
                <button
                  aria-label={t('scan')}
                  disabled={status === 'pairing'}
                  onClick={() => setScanning(true)}
                >
                  <QrCode size={19} />
                </button>
              </div>
            </div>
          )}
          <p className="install-hint">{t('installHint')}</p>
          <div className="pair-security">
            <ShieldCheck size={13} />
            {t('pairPrivate')}
          </div>
          {scanning && (
            <Suspense fallback={null}>
              <Scanner
                onCode={pair}
                onCancel={() => setScanning(false)}
                onPaste={() => {
                  setScanning(false);
                  requestAnimationFrame(() => document.getElementById('pair-code')?.focus());
                }}
              />
            </Suspense>
          )}
        </section>
      ) : !selected && !creating ? (
        <section className="task-panel">
          <div className="list-heading">
            <h1>{t('allTasks')}</h1>
          </div>
          <TaskList
            tasks={tasks}
            projects={projects}
            conversationRoots={conversationRoots}
            busy={busy}
            running={runs
              .filter((r) => r.taskId && !r.events.some((e) => e.type === 'finished'))
              .map((r) => r.taskId!)}
            waiting={runs.filter((run) => pendingRequests([run]).length > 0).map((r) => r.taskId!)}
            onSelect={(task) => {
              navigation.current++;
              current.current = task;
              setSelected(task);
              setAgent(task.agent);
              setLoadedId(null);
              setBefore(0);
              setMessages([]);
              void read(task).catch(fail);
            }}
          />
          <div className="list-footer">
            <Monitor size={12} />
            {t('deviceConnected')}
          </div>
        </section>
      ) : (
        <>
          {before > 0 && selected && (
            <button
              className="older-button"
              disabled={locked}
              onClick={() => void read(selected, true).catch(fail)}
            >
              {t('older')}
            </button>
          )}
          <Stream
            key={selected?.id ?? 'new'}
            taskId={selected?.id ?? 'new'}
            items={streamItems}
            isLoading={Boolean(selected && loadedId !== selected.id)}
            isRunning={running || Boolean(selected && busy.includes(selected.id))}
          />
          <footer className="task-footer">
            {selected && Object.hasOwn(turnErrors, selected.id) && !streamItems.some((item) => item.type === 'error' && item.text === turnErrors[selected.id]) && (
              <TaskNotice
                key={selected.id + turnErrors[selected.id]}
                details={turnErrors[selected.id]}
                onDismiss={() =>
                  setTurnErrors((old) => {
                    const next = { ...old };
                    delete next[selected.id];
                    return next;
                  })
                }
              />
            )}
            {(finishing || pendingCreation) && (
              <div className="busy-notice" role="status">
                {t('syncing')}
              </div>
            )}
            {selected && busy.includes(selected.id) && (
              <div className="busy-notice">
                <Monitor size={13} />
                {t('busy')}
              </div>
            )}
            {running && (
              <RunningStatus
                events={events}
                startedAt={startedAt.current.get(unfinished[0].runId)!}
                waiting={pending.length > 0}
              />
            )}
            <TaskInput
              key={draftKey}
              pending={pending}
              answeringDisabled={locked || Boolean(selected && stoppingTasks.has(selected.id))}
              onAnswer={(request, decision) => api.answer(selected!.id, request.requestId, decision)}
              composer={{
                agent,
                value: prompt,
                creating,
                disabled: locked,
                running,
                stopDisabled: status !== 'ready' || Boolean(selected && stoppingTasks.has(selected.id)),
                canSend:
                  !locked &&
                  !running &&
                  Boolean(prompt.trim()) &&
                  models.length > 0 &&
                  (!creating || Boolean(cwd)),
                onChange: (text) => setDrafts((old) => ({ ...old, [draftKey]: text })),
                onSend: () => void send(),
                onStop: () => void stop(),
              }}
            >
              <ComposerControls
                agent={agent}
                agents={agents}
                creating={creating}
                choices={choices}
                failures={modelFailures}
                model={model}
                effort={effort}
                permission={permission}
                projects={projects}
                cwd={cwd}
                disabled={locked}
                onModel={(a, m) => {
                  setAgent(a);
                  const previous = selected ? prefs : (defaults[a] ?? DEFAULT_PREFERENCES);
                  changePreferences(
                    {
                      ...previous,
                      model: m.value,
                      effort: '',
                      permission:
                        !m.supportsAutoMode && previous.permission === 'auto'
                          ? 'default'
                          : previous.permission,
                    },
                    a,
                  );
                }}
                onEffort={(value) => changePreferences({ ...prefs, effort: value })}
                onPermission={(value) => changePreferences({ ...prefs, permission: value })}
                onProject={setCwd}
              />
            </TaskInput>
          </footer>
        </>
      )}
      {menu && (
        <Sheet title={t('connectionMenu')} onClose={() => setMenu(false)}>
          <p className="sheet-hint">{t('menuHint')}</p>
          <button
            className="sheet-option"
            onClick={() => {
              setMenu(false);
              void identityStore()
                .then((i) => {
                  if (i) client.connect(i);
                })
                .catch(fail);
            }}
          >
            <RefreshCw size={18} />
            <span>{t('refresh')}</span>
          </button>
          <button
            className="sheet-option"
            onClick={() => {
              setMenu(false);
              client.close();
              void identityStore(null)
                .then(() => {
                  setPaired(false);
                  setCode('');
                  resetWorkspace();
                })
                .catch(fail);
            }}
          >
            <Link2 size={18} />
            <span>{t('forget')}</span>
          </button>
        </Sheet>
      )}
    </main>
  );
}
