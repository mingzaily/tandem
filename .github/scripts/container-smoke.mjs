import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { run } from './run.mjs';

const image = process.argv[2];
assert.ok(image, '用法：node .github/scripts/container-smoke.mjs <本机镜像>');
const name = `tandem-smoke-${randomUUID()}`;
const dir = await mkdtemp(join(tmpdir(), 'tandem-container-'));
const stop = new AbortController();
const interrupt = () => stop.abort();
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);
const docker = (args, options = {}) => run('docker', args, { signal: stop.signal, ...options });
let container;

async function healthy() {
  for (let attempt = 0; attempt < 45; attempt++) {
    const state = JSON.parse(await docker(['inspect', '--format', '{{json .State}}', container], { capture: true }));
    assert.equal(state.Status, 'running', '容器保持运行');
    assert.ok(state.Health, '镜像提供内置健康检查');
    if (state.Health.Status === 'healthy') return;
    assert.notEqual(state.Health.Status, 'unhealthy', '镜像健康检查通过');
    await sleep(1000, undefined, { signal: stop.signal });
  }
  throw new Error('容器在 45 秒内未进入 healthy 状态');
}

try {
  await docker(['volume', 'create', name], { capture: true });
  container = await docker([
    'create', '--name', name, '--publish', '127.0.0.1::8787',
    '--env', 'TANDEM_RELAY_HOST_TOKEN=container-fixture',
    '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
    '--mount', `type=volume,source=${name},target=/data`,
    '--health-interval', '1s', '--health-start-period', '1s', image,
  ], { capture: true });
  await docker(['start', container]);
  await healthy();
  assert.equal(await docker(['inspect', '--format', '{{.Config.User}}', container], { capture: true }), '65532:65532');
  await docker(['exec', container, '/tandem-relay', 'healthcheck']);
  const address = await docker(['port', container, '8787/tcp'], { capture: true });
  await run('pnpm', ['--dir', 'pwa', 'test:container'], { env: { PWA_ORIGIN: `http://${address}` }, signal: stop.signal });
  const before = join(dir, 'before.json');
  await docker(['cp', `${container}:/data/tokens.json`, before]);
  assert.equal((await stat(before)).mode & 0o777, 0o600);
  const saved = await readFile(before);
  assert.ok(JSON.parse(saved).length > 0, '配对后的长期准入信息已落盘');
  await docker(['restart', '--timeout', '10', container]);
  await healthy();
  const after = join(dir, 'after.json');
  await docker(['cp', `${container}:/data/tokens.json`, after]);
  assert.deepEqual(await readFile(after), saved, '重启保留数据卷中的准入信息');
  await docker(['stop', '--timeout', '10', container]);
  assert.equal(await docker(['inspect', '--format', '{{.State.ExitCode}}', container], { capture: true }), '0', 'SIGTERM 正常退出');
  console.info('容器启动、非 root、健康检查、PWA 配对、持久化、重启与 SIGTERM 通过。');
} catch (error) {
  if (container) await run('docker', ['logs', container]);
  throw error;
} finally {
  // Creation may finish in Docker after its CLI is interrupted; discover by the reserved name.
  try {
    const owned = await run('docker', ['container', 'ls', '--all', '--quiet', '--filter', `name=^/${name}$`], { capture: true });
    if (owned) await run('docker', ['rm', '--force', '--volumes', owned]);
  } finally {
    try {
      const owned = await run('docker', ['volume', 'ls', '--quiet', '--filter', `name=^${name}$`], { capture: true });
      if (owned) await run('docker', ['volume', 'rm', owned]);
    } finally {
      await rm(dir, { recursive: true, force: true });
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', interrupt);
    }
  }
}
