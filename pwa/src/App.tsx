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
    [agents, setAgents] = useState<Agent[]>([]);
  const [selected, setSelected] = useState<TaskSummary | null>(null),
    [creating, setCreating] = useState(false),
    [cwd, setCwd] = useState(''),
    [agent, setAgent] = useState<Agent>('claude');
  const [models, setModels] = useState<ModelOption[]>([]),
    [model, setModel] = useState(''),
    [effort, setEffort] = useState(''),
    [permission, setPermission] = useState('default');
  const [messages, setMessages] = useState<Message[]>([]),
    [before, setBefore] = useState(0),
    [runs, setRuns] = useState<Run[]>([]),
    [prompt, setPrompt] = useState(''),
    [sending, setSending] = useState(false);
  const current = useRef(selected);
  current.current = selected;
  const generation = useRef(0);
  const snapshotting = useRef(false);
  const heldEvents = useRef<any[]>([]);
  const snapshotSeq = useRef(0);
  const taskByRun = useRef(new Map<string, string>());
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
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
    // 快照之前产生的事件已经在快照里，之后的等快照到了再接上，一条都不能丢。
    if (snapshotting.current && f.ev === 'turn.event') {
      heldEvents.current.push(f);
      return;
    }
    if (f.ev === 'turn.event' && f.p.seq <= snapshotSeq.current) return;
    if (f.ev === 'tasks.changed') {
      void refreshTasks().catch(fail);
      return;
    }
    if (f.ev !== 'turn.event') return;
    const p = f.p;
    setRuns((old) => {
      const found = old.find((r) => r.runId === p.runId);
      return found
        ? old.map((r) =>
            r.runId === p.runId ? { ...r, taskId: p.taskId, events: [...r.events, p.event] } : r,
          )
        : [
            ...old,
            { runId: p.runId, taskId: p.taskId, agent: current.current?.agent ?? agent, events: [p.event] },
          ];
    });
    if (p.event.type === 'finished') {
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
          const host = await api.host();
          setProjects(host.projects);
          setAgents(host.agents);
          setCwd(host.projects[0]?.cwd ?? '');
          await refreshTasks();
          await syncRuns();
          if (current.current) await read(current.current);
          await refreshTasks();
        })().catch(fail);
      }
      if (s === 'revoked') void identityStore(null).catch(fail);
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
    const viewport = () =>
      document.documentElement.style.setProperty(
        '--viewport-height',
        `${window.visualViewport?.height ?? window.innerHeight}px`,
      );
    viewport();
    window.visualViewport?.addEventListener('resize', viewport);
    return () => {
      client.close();
      window.visualViewport?.removeEventListener('resize', viewport);
    };
  }, []);
  useEffect(() => {
    if (status !== 'ready') return;
    let cancelled = false;
    setModels([]);
    void api
      .info(agent)
      .then((r) => {
        if (!cancelled) {
          setModels(r.models);
          setModel(r.models[0]?.value ?? '');
          setEffort('');
          setPermission('default');
        }
      })
      .catch(fail);
    return () => {
      cancelled = true;
    };
  }, [agent, status]);
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
  const events = activeRuns.flatMap((r) => r.events);
  const pending = events.filter(
    (e): e is PendingRequest =>
      (e.type === 'permissionRequest' || e.type === 'question') &&
      !events.some((s) => s.type === 'requestSettled' && s.requestId === e.requestId),
  );
  const liveMessages: Message[] = [];
  for (const r of activeRuns)
    for (const [i, e] of r.events.entries()) {
      const kind =
        e.type === 'textDelta'
          ? 'assistant'
          : e.type === 'thinkingDelta'
            ? 'thinking'
            : e.type === 'toolUse'
              ? 'tool_use'
              : e.type === 'toolResult'
                ? 'tool_result'
                : null;
      if (!kind) continue;
      const value = 'text' in e ? e.text : e.type === 'toolUse' ? e.input : '';
      const last = liveMessages.at(-1);
      if ((kind === 'assistant' || kind === 'thinking') && last?.kind === kind) last.text += value;
      else
        liveMessages.push({
          id: r.runId + i,
          kind,
          text: value,
          toolName: e.type === 'toolUse' ? e.name : undefined,
          isError: false,
          truncated: false,
        });
    }

  const running = activeRuns.some((r) => !r.events.some((e) => e.type === 'finished'));
  const chosenModel = models.find((m) => m.value === model);
  const locked = status !== 'ready' || sending || Boolean(selected && busy.includes(selected.id));
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
        // 不选就不传，由 CLI 自己的配置决定。
        model: model && model !== 'default' ? model : null,
        effort: effort || null,
        permissionMode: permission === 'default' || agent === 'pi' ? null : permission,
      });
      setPrompt('');
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
  return (
    <main>
      <header>
        <button
          onClick={() => {
            setSelected(null);
            current.current = null;
            setCreating(false);
          }}
        >
          {t('tasks')}
        </button>
        <strong>Tandem</strong>
        <button
          onClick={() => {
            setSelected(null);
            current.current = null;
            setCreating(true);
            setMessages([]);
          }}
        >
          {t('create')}
        </button>
      </header>
      <div className="status" role="status">
        {t(status)}
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!paired || status === 'revoked' ? (
        <section className="pair">
          <h1>{t('pair')}</h1>
          <p>{t('pairHint')}</p>
          <label>
            {t('deviceName')}
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <textarea
            aria-label={t('paste')}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder="tandem-pair:…"
          />
          <div className="actions">
            <button
              disabled={!raw || status === 'pairing'}
              className="primary"
              onClick={() => void pair(raw)}
            >
              {t('pair')}
            </button>
            <button disabled={status === 'pairing'} onClick={() => setScanning(true)}>
              {t('scan')}
            </button>
          </div>
          {code && (
            <div className="card">
              <output className="code">{code}</output>
              <p>{t('codeHint')}</p>
            </div>
          )}
          {scanning && (
            <Suspense fallback={null}>
              <Scanner onCode={pair} onCancel={() => setScanning(false)} />
            </Suspense>
          )}
        </section>
      ) : !selected && !creating ? (
        <section className="task-panel">
          <div className="actions">
            <button
              onClick={() =>
                void identityStore()
                  .then((i) => {
                    if (i) client.connect(i);
                  })
                  .catch(fail)
              }
            >
              {t('refresh')}
            </button>
            <button
              onClick={() => {
                client.close();
                void identityStore(null)
                  .then(() => {
                    setPaired(false);
                    setTasks([]);
                    setMessages([]);
                    setRuns([]);
                  })
                  .catch(fail);
              }}
            >
              {t('forget')}
            </button>
          </div>
          <TaskList
            tasks={tasks}
            projects={projects}
            busy={busy}
            onSelect={(task) => {
              current.current = task;
              setSelected(task);
              setAgent(task.agent);
              setMessages([]);
              void read(task).catch(fail);
            }}
          />
        </section>
      ) : (
        <>
          <div className="task-title">{selected?.title ?? t('create')}</div>
          {before > 0 && selected && (
            <button disabled={locked} onClick={() => void read(selected, true).catch(fail)}>
              {t('older')}
            </button>
          )}
          <Stream messages={[...messages, ...liveMessages]} />
          <footer>
            {pending.map((request) => (
              <Prompt
                key={request.requestId}
                request={request}
                disabled={locked}
                onAnswer={(d) => api.answer(selected!.id, request.requestId, d).catch(fail)}
              />
            ))}
            <fieldset disabled={locked}>
              <div className="settings">
                {creating && (
                  <>
                    <label>
                      {t('project')}
                      <select value={cwd} onChange={(e) => setCwd(e.target.value)}>
                        {projects.map((p) => (
                          <option key={p.cwd} value={p.cwd}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {t('agent')}
                      <select value={agent} onChange={(e) => setAgent(e.target.value as Agent)}>
                        {agents.map((a) => (
                          <option key={a}>{a}</option>
                        ))}
                      </select>
                    </label>
                  </>
                )}
                <label>
                  {t('model')}
                  <select
                    value={model}
                    onChange={(e) => {
                      setModel(e.target.value);
                      const m = models.find((m) => m.value === e.target.value);
                      setEffort(m?.defaultEffort ?? '');
                      if (!m?.supportsAutoMode) setPermission('default');
                    }}
                  >
                    {models.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.displayName}
                      </option>
                    ))}
                  </select>
                </label>
                {chosenModel?.supportsEffort && (
                  <label>
                    {t('effort')}
                    <select value={effort} onChange={(e) => setEffort(e.target.value)}>
                      <option value="">{chosenModel.defaultEffort ?? t('effortDefault')}</option>
                      {chosenModel.supportedEffortLevels.map((e) => (
                        <option key={e}>{e}</option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  {t('permission')}
                  <select value={permission} onChange={(e) => setPermission(e.target.value)}>
                    <option value="default">{t('default')}</option>
                    <option value="acceptEdits">{t('acceptEdits')}</option>
                    {chosenModel?.supportsAutoMode && <option value="auto">{t('auto')}</option>}
                    <option value="bypassPermissions">{t('fullAccess')}</option>
                  </select>
                </label>
              </div>
              <textarea
                aria-label={t('send')}
                placeholder={t('prompt')}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <div className="actions">
                {running ? (
                  <button onClick={() => void api.stop(selected!.id).catch(fail)}>{t('stop')}</button>
                ) : (
                  <button
                    className="primary"
                    disabled={!prompt.trim() || !models.length || (creating && !cwd)}
                    onClick={() => void send()}
                  >
                    {t('send')}
                  </button>
                )}
              </div>
            </fieldset>
          </footer>
        </>
      )}
    </main>
  );
}
