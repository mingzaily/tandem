import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { api, client } from './lib/api';
import { identityStore } from './lib/storage';
import { parsePairCode } from './lib/pairing';
import type { Status } from './lib/client';
import type { Agent, Message, ModelOption, PendingRequest, Run, TaskSummary } from './lib/types';
import { t } from './lib/i18n';
import Stream from './Stream';
import { TaskList } from './TaskList';
import { Prompt } from './Prompt';
import {
  ArrowLeft,
  ArrowUp,
  Ellipsis,
  Link2,
  LockKeyhole,
  Monitor,
  Plus,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Square,
} from 'lucide-react';
import { ComposerControls } from './ComposerControls';
import { Sheet } from './Sheet';
import { RunningStatus } from './RunningStatus';
import { applyTurnEvent, buildItems, type Item } from './lib/items';
import { agentName } from './TaskList';
import { AgentMark } from './AgentMark';
import { appendTurnEvent } from './lib/events';
const Scanner = lazy(() => import('./Scanner'));
export default function App() {
  const [status, setStatus] = useState<Status>('closed'),
    [error, setError] = useState(''),
    [paired, setPaired] = useState(false);
  const [raw, setRaw] = useState(''),
    [name, setName] = useState('手机'),
    [code, setCode] = useState(''),
    [scanning, setScanning] = useState(false);
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
  const activeAgent = useRef(agent);
  activeAgent.current = agent;
  const [choices, setChoices] = useState<Partial<Record<Agent, ModelOption[]>>>({}),
    [model, setModel] = useState(''),
    [effort, setEffort] = useState(''),
    [permission, setPermission] = useState('default');
  const [messages, setMessages] = useState<Message[]>([]),
    [before, setBefore] = useState(0),
    [runs, setRuns] = useState<Run[]>([]),
    [prompt, setPrompt] = useState(''),
    [sending, setSending] = useState(false);
  const [menu, setMenu] = useState(false);
  const startedAt = useRef(new Map<string, number>());
  const models = choices[agent] ?? [];
  const current = useRef(selected);
  current.current = selected;
  const generation = useRef(0);
  const snapshotting = useRef(false);
  const heldEvents = useRef<any[]>([]);
  const snapshotSeq = useRef(0);
  const taskByRun = useRef(new Map<string, string>());
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
  async function refreshProjects() {
    const host = await api.host();
    setProjects(host.projects);
    setConversationRoots(host.conversationRoots);
    return host;
  }
  async function refreshTasks() {
    const r = await api.tasks();
    setTasks(r.tasks);
    setBusy(r.external.filter((e) => e.isBusy).map((e) => e.taskId));
  }
  async function read(task: TaskSummary, older = false) {
    const g = ++generation.current;
    const r = await api.read(task.agent, task.id, older ? before : undefined);
    if (g !== generation.current || current.current?.id !== task.id) return;
    setMessages((old) => (older ? [...r.messages, ...old] : r.messages));
    setBefore((older ? before : r.total) - r.messages.length);
  }
  function event(f: any) {
    if (f.ev === 'turn.event' && f.p.taskId) taskByRun.current.set(f.p.runId, f.p.taskId);
    // Hold newer events until the snapshot establishes its sequence boundary.
    if (snapshotting.current && f.ev === 'turn.event') {
      heldEvents.current.push(f);
      return;
    }
    if (f.ev === 'turn.event' && f.p.seq <= snapshotSeq.current) return;
    if (f.ev === 'tasks.changed') {
      void Promise.all([refreshTasks(), refreshProjects()]).catch(fail);
      return;
    }
    if (f.ev !== 'turn.event') return;
    const p = f.p;
    if (!startedAt.current.has(p.runId)) startedAt.current.set(p.runId, performance.now() - p.elapsedMs);
    setRuns((old) => {
      const found = old.find((r) => r.runId === p.runId);
      return found
        ? old.map((r) =>
            r.runId === p.runId ? { ...r, taskId: p.taskId, events: appendTurnEvent(r.events, p.event) } : r,
          )
        : [
            ...old,
            {
              runId: p.runId,
              taskId: p.taskId,
              agent: current.current?.agent ?? agent,
              startedAtMs: p.startedAtMs,
              elapsedMs: p.elapsedMs,
              events: [p.event],
            },
          ];
    });
    if (p.event.type === 'finished') {
      startedAt.current.delete(p.runId);
      if (current.current?.id === p.taskId) {
        const task = current.current!;
        void read(task)
          .then(() => setRuns((old) => old.filter((r) => r.runId !== p.runId)))
          .catch(fail);
      } else setRuns((old) => old.filter((r) => r.runId !== p.runId));
    }
  }
  const eventRef = useRef(event);
  eventRef.current = event;
  function applySnapshot(snapshot: { seq: number; runs: Run[] }) {
    startedAt.current = new Map(snapshot.runs.map((run) => [run.runId, performance.now() - run.elapsedMs]));
    setRuns(snapshot.runs);
    snapshotSeq.current = snapshot.seq;
    snapshotting.current = false;
    const held = heldEvents.current;
    heldEvents.current = [];
    for (const f of held) eventRef.current(f);
  }
  async function syncRuns() {
    snapshotting.current = true;
    try {
      return await api.snapshot(applySnapshot);
    } finally {
      snapshotting.current = false;
    }
  }
  useEffect(() => {
    client.onError = fail;
    client.onCode = setCode;
    client.onStatus = (s) => {
      setStatus(s);
      if (s === 'ready') {
        void (async () => {
          const host = await refreshProjects();
          setAgents(host.agents);
          setCwd(host.projects[0]?.cwd ?? '');
          await refreshTasks();
          await syncRuns();
          if (current.current) await read(current.current);
          await refreshTasks();
        })().catch(fail);
      }
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
    viewport();
    window.visualViewport?.addEventListener('resize', viewport);
    window.visualViewport?.addEventListener('scroll', viewport);
    return () => {
      client.close();
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
          if (a === activeAgent.current) {
            setModel(info.models[0]?.value ?? '');
            setEffort('');
            setPermission('default');
          }
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          const message = error instanceof Error ? error.message : String(error);
          setModelFailures((old) => ({ ...old, [a]: message }));
          if (a === activeAgent.current) fail(error);
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
  const activeRuns = runs.filter((r) => r.taskId === selected?.id);
  const unfinished = activeRuns.filter((r) => !r.events.some((e) => e.type === 'finished'));
  const events = unfinished.flatMap((r) => r.events);
  const pending = events.filter(
    (e): e is PendingRequest =>
      (e.type === 'permissionRequest' || e.type === 'question') &&
      !events.some((s) => s.type === 'requestSettled' && s.requestId === e.requestId),
  );
  const liveItems = activeRuns.flatMap((run) =>
    run.events.reduce<Item[]>((items, event) => applyTurnEvent(items, event), []),
  );
  const running = unfinished.length > 0;
  const finishing = activeRuns.length > unfinished.length;
  const locked =
    status !== 'ready' || sending || finishing || Boolean(selected && busy.includes(selected.id));
  async function send() {
    if (!prompt.trim() || locked || running) return;
    setSending(true);
    setError('');
    try {
      const result = await api.send({
        agent,
        taskId: selected?.id ?? null,
        cwd: selected ? null : cwd,
        prompt,
        // An omitted option lets the CLI use its own configuration.
        model: model && model !== 'default' ? model : null,
        effort: effort || null,
        permissionMode: permission === 'default' || agent === 'pi' ? null : permission,
      });
      setPrompt('');
      if (selected)
        setMessages((old) => [
          ...old,
          {
            id: 'prompt-' + result.runId,
            kind: 'user',
            text: prompt,
            timestamp: new Date().toISOString(),
            isError: false,
            truncated: false,
          },
        ]);
      if (!selected) {
        const list = await api.tasks();
        setTasks(list.tasks);
        const snapshot = await syncRuns();
        const run = snapshot.runs.find((r) => r.runId === result.runId);
        const task = list.tasks.find((t) => t.id === (run?.taskId ?? taskByRun.current.get(result.runId)));
        if (task) {
          current.current = task;
          setSelected(task);
          setCreating(false);
          await read(task);
        }
      }
    } catch (e) {
      fail(e);
    } finally {
      setSending(false);
    }
  }
  function resetWorkspace() {
    generation.current++;
    startedAt.current.clear();
    current.current = null;
    setSelected(null);
    setCreating(false);
    setTasks([]);
    setProjects([]);
    setConversationRoots([]);
    setAgents([]);
    setMessages([]);
    setRuns([]);
    setChoices({});
    setModelFailures({});
    setBefore(0);
    setPrompt('');
  }
  function showTasks() {
    generation.current++;
    setSelected(null);
    current.current = null;
    setCreating(false);
  }
  function createTask() {
    showTasks();
    setCreating(true);
    setMessages([]);
    setPermission('default');
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
              <small>{agentName(agent)}</small>
            </div>
          )}
          {hasIdentity && (
            <div className="header-actions">
              <button className="icon-button" aria-label={t('create')} onClick={createTask}>
                <Plus size={21} />
              </button>
              <button className="icon-button" aria-label={t('connectionMenu')} onClick={() => setMenu(true)}>
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
                onChange={(e) => setName(e.target.value)}
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
              <Scanner onCode={pair} onCancel={() => setScanning(false)} />
            </Suspense>
          )}
        </section>
      ) : !selected && !creating ? (
        <section className="task-panel">
          <div className="list-heading">
            <h1>{t('allTasks')}</h1>
            <p>{t('listHint')}</p>
          </div>
          <TaskList
            tasks={tasks}
            projects={projects}
            conversationRoots={conversationRoots}
            busy={busy}
            running={runs
              .filter((r) => r.taskId && !r.events.some((e) => e.type === 'finished'))
              .map((r) => r.taskId!)}
            waiting={runs
              .filter((r) =>
                r.events.some(
                  (e) =>
                    (e.type === 'permissionRequest' || e.type === 'question') &&
                    !r.events.some((s) => s.type === 'requestSettled' && s.requestId === e.requestId),
                ),
              )
              .map((r) => r.taskId!)}
            onSelect={(task) => {
              current.current = task;
              setSelected(task);
              setAgent(task.agent);
              setModel(choices[task.agent]?.[0]?.value ?? '');
              setEffort('');
              setPermission('default');
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
            items={[...buildItems(messages), ...liveItems]}
            isRunning={running}
          />
          <footer className="task-footer">
            {finishing && (
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
                startedAt={startedAt.current.get(activeRuns[0].runId)!}
                waiting={pending.length > 0}
              />
            )}
            {pending.length ? (
              pending.map((request) => (
                <Prompt
                  key={request.requestId}
                  request={request}
                  disabled={locked}
                  onAnswer={(d) => api.answer(selected!.id, request.requestId, d).catch(fail)}
                />
              ))
            ) : (
              <>
                <div className="composer">
                  <textarea
                    aria-label={t('send')}
                    placeholder={t('prompt')}
                    disabled={locked}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        void send();
                      }
                    }}
                  />
                  <div className="composer-bottom">
                    <span className="composer-agent">
                      <AgentMark agent={agent} size={17} />
                    </span>
                    {running ? (
                      <button
                        className="send-button"
                        disabled={locked}
                        aria-label={t('stop')}
                        onClick={() => void api.stop(selected!.id).catch(fail)}
                      >
                        <Square size={15} fill="currentColor" />
                      </button>
                    ) : (
                      <button
                        className="send-button"
                        disabled={locked || !prompt.trim() || !models.length || (creating && !cwd)}
                        aria-label={t('send')}
                        onClick={() => void send()}
                      >
                        <ArrowUp size={19} />
                      </button>
                    )}
                  </div>
                </div>
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
                    setModel(m.value);
                    setEffort('');
                    if (!m.supportsAutoMode && permission === 'auto') setPermission('default');
                  }}
                  onEffort={setEffort}
                  onPermission={setPermission}
                  onProject={setCwd}
                />
              </>
            )}
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
