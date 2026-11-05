// Drives a real Tandem debug build through the PWA's protocol layer: pairing, reading, refused
// requests, a turn with a question, then being revoked. Arguments: <repo root> <pairing text file>.
// The desktop needs TANDEM_DRIVE_PAIR_FILE and TANDEM_DRIVE_PAIR_ALLOW (docs/dev-rules/desktop-development.md).
import { readFileSync, existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
const base = process.argv[2];
const { Client } = await import(base + '/pwa/src/lib/client.ts');
const { parsePairCode } = await import(base + '/pwa/src/lib/pairing.ts');
const pairFile = process.argv[3];
for (let i = 0; i < 60 && !existsSync(pairFile); i++) await sleep(500);
const text = readFileSync(pairFile, 'utf8');
console.log('pair code', text.slice(0, 24) + '…', text.length);
const client = new Client();
const statuses: string[] = []; const events: any[] = [];
client.onStatus = (s: string) => statuses.push(s);
client.onEvent = (e: any) => events.push(e);
client.onError = (e: Error) => console.log('client error', e.message);
client.onCode = (c: string) => console.log('code', c);
const identity = await client.pair(parsePairCode(text), 'interop-phone');
console.log('paired', identity.clientId.length);
client.connect(identity);
for (let i = 0; i < 40 && !statuses.includes('ready'); i++) await sleep(250);
console.log('statuses', statuses.join(','));
const info = await client.request('host.info'); console.log('host', info.name, info.agents, info.projects.length);
const list = await client.request('tasks.list'); console.log('tasks', list.tasks.length, 'external', list.external.length);
const claude = list.tasks.find((t: any) => t.agent === 'claude');
const page = await client.request('task.read', { agent: claude.agent, id: claude.id, limit: 3 });
console.log('read', page.total, page.messages.length, 'image', page.messages.filter((m: any) => m.image).length);
const a = await client.request('agent.info', { agent: 'codex' }); console.log('models', a.models.map((m: any) => [m.value, m.defaultEffort]));
for (const [p, label] of [[{ agent: 'codex', taskId: null, cwd: '/etc', prompt: 'x', model: null, effort: null, permissionMode: null }, 'bad cwd'], [{ agent: 'codex', taskId: null, cwd: null, prompt: 'x', model: null, effort: null, permissionMode: null }, 'no target'], [{ agent: 'codex', taskId: 't', cwd: null, prompt: ' ', model: null, effort: null, permissionMode: null }, 'empty']] as const) {
  await client.request('turn.send', p).then(() => console.log('ALLOWED?!', label), (e: Error) => console.log('refused', label, e.message.slice(0, 60)));
}
await client.request('nope.op').then(() => console.log('ALLOWED?! unknown'), (e: Error) => console.log('refused unknown', e.message.slice(0, 50)));
const cwd = info.projects.find((p: any) => p.cwd.startsWith('tandem:')).cwd;
const sent = await client.request('turn.send', { agent: 'codex', taskId: null, cwd, prompt: '手机发的', model: null, effort: null, permissionMode: 'bypassPermissions' });
console.log('sent', sent.runId);
await sleep(3000);
const snap = await client.request('live.snapshot'); const run = snap.runs.find((r: any) => r.runId === sent.runId);
console.log('snapshot seq', snap.seq, 'events', run?.events.length, run?.taskId?.slice(0, 8));
let question: any; for (let i = 0; i < 60 && !question; i++) { question = events.find((e) => e.ev === 'turn.event' && e.p.event.type === 'question'); await sleep(300); }
console.log('question', !!question, question?.p.event.questions?.[0]?.question);
const seqs = events.filter((e) => e.ev === 'turn.event').map((e) => e.p.seq);
console.log('seq strictly increasing', seqs.every((s, i) => i === 0 || s > seqs[i - 1]), seqs.length);
await client.request('request.answer', { taskId: question.p.taskId, requestId: question.p.event.requestId, decision: { kind: 'answer', answers: { '选哪个颜色？': '红' } } }); console.log('answered');
let done: any; for (let i = 0; i < 40 && !done; i++) { done = events.find((e) => e.ev === 'turn.event' && e.p.event.type === 'finished'); await sleep(250); }
console.log('finished', done?.p.event, 'settled', events.some((e) => e.p?.event?.type === 'requestSettled'));
console.log('waiting for revoke'); statuses.length = 0;
for (let i = 0; i < 60 && !statuses.includes('revoked'); i++) await sleep(500);
console.log('after revoke', statuses.join(','));
client.close(); process.exit(0);
