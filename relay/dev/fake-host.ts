import { WebSocket } from 'ws';
import { pathToFileURL } from 'node:url';
import {
  aes,
  b64,
  cat,
  checkMac,
  Cipher,
  generate,
  pairKeys,
  pub,
  random,
  sessionKeys,
  sign,
  text,
  unb64,
  utf8,
  verify,
} from '../../pwa/src/lib/crypto.ts';
import { tokenHash } from '../src/server.ts';

type Frame = Record<string, any>;
export async function fakeHost(
  url: string,
  hostToken: string,
  approve: (name: string, code: string) => Promise<boolean> = async (name, code) => {
    console.info(`开发设备 ${name}，核对码 ${code}，自动允许`);
    return true;
  },
) {
  const signing = await generate('ECDSA');
  const room = b64(random(16));
  const pairToken = b64(random(32)),
    secret = random(32),
    sh = await pub(signing);
  const clients = new Map<string, { sc: Uint8Array; token: string }>();
  const sessions = new Map<
    string,
    {
      phase: string;
      pair?: Awaited<ReturnType<typeof pairKeys>>;
      sc?: Uint8Array;
      name?: string;
      session?: Awaited<ReturnType<typeof sessionKeys>>;
      cipher?: Cipher;
      clientId?: string;
    }
  >();
  const ws = new WebSocket(url);
  let resolveReady: () => void;
  let rejectReady: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const readyTimeout = setTimeout(() => {
    rejectReady(new Error('开发桌面端连接超时'));
    ws.close();
  }, 10_000);
  ws.once('close', () => rejectReady(new Error('开发桌面端连接已关闭')));
  const send = (f: object) => ws.send(JSON.stringify(f));
  const data = (to: string, f: object) => send({ t: 'data', to, d: b64(utf8(JSON.stringify(f))) });
  let output = Promise.resolve();
  const encrypted = (to: string, value: object) => {
    output = output.then(async () => {
      const c = sessions.get(to)?.cipher;
      if (c) for (const f of await c.encode(value)) data(to, f);
    });
    return output;
  };
  const tasks: Frame[] = [
    {
      id: 'demo',
      title: '手机上的第一个任务',
      cwd: '/demo',
      agent: 'claude',
      updatedAtMs: Date.now(),
    },
  ];
  const history = new Map<string, Frame[]>([
    [
      'demo',
      [
        {
          id: 'welcome',
          kind: 'assistant',
          text: '已连接开发桌面端。发送消息后可以体验流式输出、确认和提问。',
          isError: false,
          truncated: false,
        },
      ],
    ],
  ]);
  const runs = new Map<string, Frame>();
  let seq = 0;
  async function event(run: Frame, e: Frame) {
    run.events.push(e);
    seq += 1;
    for (const [conn, s] of sessions)
      if (s.phase === 'ready')
        await encrypted(conn, {
          ev: 'turn.event',
          p: { runId: run.runId, taskId: run.taskId, seq, event: e },
        });
  }
  async function operation(conn: string, req: Frame) {
    const { id, op, p } = req;
    let result: Frame = {};
    const error = (code: string, message: string) => encrypted(conn, { id, ok: false, e: { code, message } });
    const task = tasks.find((t) => t.id === (p.taskId ?? p.id));
    switch (op) {
      case 'host.info':
        result = {
          name: '开发桌面端',
          version: '1',
          agents: ['claude', 'codex', 'pi'],
          projects: [{ cwd: '/demo', name: '演示项目' }],
        };
        break;
      case 'tasks.list':
        result = { tasks, external: [] };
        break;
      case 'task.read': {
        if (!task) return error('NOT_FOUND', '任务不存在');
        const messages = history.get(p.id)!;
        const before = p.before ?? messages.length;
        result = {
          messages: messages.slice(Math.max(0, before - Math.min(p.limit ?? 200, 500)), before),
          total: messages.length,
          context: { usedTokens: 120 },
        };
        break;
      }
      case 'agent.info':
        result = {
          models: [
            {
              value: 'demo',
              displayName: '演示模型',
              description: '',
              resolvedModel: 'demo',
              supportsEffort: true,
              supportedEffortLevels: ['low', 'medium', 'high'],
              supportsAutoMode: true,
              defaultEffort: 'medium',
            },
          ],
          usage: null,
        };
        break;
      case 'live.snapshot':
        result = { seq, runs: [...runs.values()] };
        break;
      case 'turn.send': {
        if (![null, 'acceptEdits', 'auto', 'bypassPermissions'].includes(p.permissionMode))
          return error('NOT_ALLOWED', '权限必须使用允许范围');
        if (p.taskId === null && p.cwd !== '/demo') return error('NOT_ALLOWED', '请选择已添加的项目');
        if (p.taskId !== null && !task) return error('NOT_FOUND', '任务不存在');
        if ([...runs.values()].some((r) => r.taskId === p.taskId))
          return error('BUSY_ELSEWHERE', '任务正在生成');
        const taskId = p.taskId ?? b64(random(16));
        if (!task) {
          tasks.push({
            id: taskId,
            title: p.prompt.slice(0, 30),
            cwd: p.cwd,
            agent: p.agent,
            updatedAtMs: Date.now(),
          });
          history.set(taskId, []);
        }
        history.get(taskId)!.push({
          id: b64(random(8)),
          kind: 'user',
          text: p.prompt,
          isError: false,
          truncated: false,
        });
        const run = {
          runId: b64(random(16)),
          taskId,
          agent: p.agent,
          events: [] as Frame[],
        };
        runs.set(run.runId, run);
        result = { runId: run.runId };
        await encrypted(conn, { id, ok: true, r: result });
        await event(run, { type: 'started', taskId });
        for (const text of ['收到：', p.prompt, '\n准备执行演示操作。'])
          await event(run, { type: 'textDelta', text });
        await event(run, {
          type: 'permissionRequest',
          requestId: 'permission-' + run.runId,
          toolName: 'Bash',
          input: 'echo Tandem',
          description: '运行演示命令',
          rules: ['echo'],
        });
        for (const [c, s] of sessions)
          if (s.phase === 'ready') await encrypted(c, { ev: 'tasks.changed', p: {} });
        return;
      }
      case 'request.answer': {
        const run = [...runs.values()].find((r) => r.taskId === p.taskId);
        if (!run) return error('NOT_FOUND', '运行不存在');
        const pending = run.events
          .filter((e: Frame) => ['permissionRequest', 'question'].includes(e.type))
          .at(-1);
        if (
          !pending ||
          pending.requestId !== p.requestId ||
          run.events.some((e: Frame) => e.type === 'requestSettled' && e.requestId === p.requestId)
        )
          return error('BAD_REQUEST', '请求已处理');
        await event(run, { type: 'requestSettled', requestId: p.requestId });
        if (pending.type === 'permissionRequest' && p.decision.kind !== 'deny')
          await event(run, {
            type: 'question',
            requestId: 'question-' + run.runId,
            questions: [
              {
                question: '下一步做什么？',
                options: [{ label: '完成' }, { label: '继续' }],
                multiSelect: false,
              },
            ],
          });
        else await finish(run, false);
        break;
      }
      case 'turn.cancel': {
        const run = [...runs.values()].find((r) => r.taskId === p.taskId);
        if (run) await finish(run, true);
        break;
      }
      default:
        return error('BAD_REQUEST', '操作名称错误');
    }
    await encrypted(conn, { id, ok: true, r: result });
  }
  async function finish(run: Frame, cancelled: boolean) {
    history.get(run.taskId)!.push({
      id: b64(random(8)),
      kind: 'assistant',
      text: run.events
        .filter((e: Frame) => e.type === 'textDelta')
        .map((e: Frame) => e.text)
        .join(''),
      isError: false,
      truncated: false,
    });
    await event(run, {
      type: 'finished',
      isError: false,
      cancelled,
      message: null,
    });
    runs.delete(run.runId);
  }
  ws.on('open', () => send({ t: 'host-hello', v: 1, room, token: hostToken }));
  let queue = Promise.resolve();
  ws.on('message', (raw) => {
    queue = queue
      .then(async () => {
        const f = JSON.parse(raw.toString());
        if (f.t === 'hello-ack') {
          send({
            t: 'allow',
            tokenHash: tokenHash(pairToken),
            oneTime: true,
            expiresAt: Date.now() + 300_000,
          });
          resolveReady();
          return;
        }
        if (f.t === 'peer' && !f.online) {
          sessions.delete(f.conn);
          return;
        }
        if (f.t !== 'data') return;
        const m = JSON.parse(text(unb64(f.d)));
        const conn: string = f.from;
        if (m.k === 'pair1') {
          const ephemeral = await generate('ECDH');
          const eh = await pub(ephemeral),
            ec = unb64(m.e),
            sc = unb64(m.s);
          const pair = await pairKeys(ec, sc, eh, sh, ephemeral.privateKey, ec, secret);
          sessions.set(conn, { phase: 'pair', pair, sc, name: m.name });
          data(conn, { k: 'pair2', e: b64(eh), mac: pair.macH });
          return;
        }
        const s = sessions.get(conn);
        if (m.k === 'hello1') {
          const client = clients.get(m.clientId);
          if (!client || m.v !== 1) {
            data(conn, { k: 'denied' });
            return;
          }
          const ephemeral = await generate('ECDH');
          const eh = await pub(ephemeral),
            ec = unb64(m.e);
          const session = await sessionKeys(
            unb64(m.clientId),
            ec,
            eh,
            client.sc,
            sh,
            ephemeral.privateKey,
            ec,
          );
          sessions.set(conn, { phase: 'hello', session, clientId: m.clientId });
          data(conn, {
            k: 'hello2',
            e: b64(eh),
            sig: await sign(signing.privateKey, cat(utf8('host'), session.th)),
          });
          return;
        }
        if (!s) {
          data(conn, { k: 'denied' });
          return;
        }
        if (m.k === 'pair3' && s.phase === 'pair') {
          const pair = s.pair!;
          await checkMac(pair.okm.slice(32, 64), m.mac, cat(utf8('client'), pair.th));
          await verify(s.sc!, m.sig, pair.th);
          if (!(await approve(s.name!, pair.code))) {
            data(conn, { k: 'pair-denied' });
            sessions.delete(conn);
            return;
          }
          const clientId = b64(random(16)),
            token = b64(random(32));
          clients.set(clientId, { sc: s.sc!, token });
          send({
            t: 'allow',
            tokenHash: tokenHash(token),
            oneTime: false,
            expiresAt: null,
          });
          data(conn, {
            k: 'pair4',
            c: b64(
              await aes(
                pair.okm.slice(64),
                new Uint8Array(12),
                'tandem-pair4',
                utf8(JSON.stringify({ clientId, token })),
                true,
              ),
            ),
          });
          s.phase = 'paired';
          return;
        }
        if (m.k === 'hello3' && s.phase === 'hello') {
          const client = clients.get(s.clientId!)!;
          await verify(client.sc, m.sig, cat(utf8('client'), s.session!.th));
          s.cipher = new Cipher(s.session!.okm.slice(32), s.session!.okm.slice(0, 32));
          s.phase = 'ready';
          return;
        }
        if (m.k === 'm' && s.phase === 'ready') {
          const value = await s.cipher!.decode(m);
          if (value) await operation(conn, value as Frame);
          return;
        }
        throw new Error('消息顺序错误');
      })
      .catch(() => {
        if (fConn(raw)) {
          data(fConn(raw), { k: 'pair-denied' });
          sessions.delete(fConn(raw));
        }
      });
  });
  function fConn(raw: { toString(): string }) {
    return JSON.parse(raw.toString()).from as string;
  }
  ws.on('error', (e) => {
    rejectReady(e);
    console.error(e.message);
  });
  try {
    await ready;
  } finally {
    clearTimeout(readyTimeout);
  }
  return {
    pairCode:
      'tandem-pair:' +
      b64(
        utf8(
          JSON.stringify({
            v: 1,
            relay: url,
            room,
            host: b64(sh),
            token: pairToken,
            secret: b64(secret),
          }),
        ),
      ),
    room,
    pairToken,
    revoke() {
      for (const client of clients.values()) send({ t: 'revoke', tokenHash: tokenHash(client.token) });
      clients.clear();
      sessions.clear();
    },
    async close() {
      if (ws.readyState === WebSocket.CLOSED) return;
      await new Promise<void>((r) => {
        ws.once('close', () => r());
        ws.close();
      });
    },
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const host = await fakeHost(
    process.env.TANDEM_RELAY_URL ?? 'ws://127.0.0.1:8787/ws',
    process.env.TANDEM_RELAY_HOST_TOKEN ?? 'development-only',
  );
  console.info('开发工具：核对码自动允许。配对码仅用于本机演示。\n' + host.pairCode);
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => {
      void host.close();
    });
}
