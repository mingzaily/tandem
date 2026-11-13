import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const exec = promisify(execFile);
const scripts = new URL('./', import.meta.url);
async function fixture(t, names, commands) {
  const dir = await mkdtemp(join(tmpdir(), 'tandem-automation-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const destination = join(dir, '.github/scripts');
  await mkdir(destination, { recursive: true });
  for (const name of names) await cp(new URL(name, scripts), join(destination, name));
  const bin = join(dir, 'bin');
  await mkdir(bin);
  for (const [name, source] of Object.entries(commands)) {
    await writeFile(join(bin, name), `#!${process.execPath}\n${source}`, { mode: 0o755 });
  }
  return { dir, cwd: dir, env: { ...process.env, PATH: bin + delimiter + process.env.PATH, FIXTURE: dir } };
}

for (const failure of ['', 'site', 'pwa']) {
  test(`组合发布产物：${failure ? failure + ' 失败时中止' : '保留独立官网与手机产物'}`, async (t) => {
    const setup = await fixture(t, ['build-pages.mjs'], {
      pnpm: `const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync('calls', JSON.stringify(args)+'\\n');
if (process.env.FAILURE === args[1]) process.exit(23);
const out = args[1] === 'site' ? 'site/.vitepress/dist' : 'pwa/dist';
fs.mkdirSync(out, {recursive:true}); fs.writeFileSync(out+'/index.html', args[1]);`,
    });
    const invocation = exec(process.execPath, ['.github/scripts/build-pages.mjs'], { ...setup, env: { ...setup.env, FAILURE: failure } });
    if (failure) await assert.rejects(invocation, { code: 23 });
    else {
      await invocation;
      assert.equal(await readFile(join(setup.dir, 'site/.vitepress/dist/index.html'), 'utf8'), 'site');
      assert.equal(await readFile(join(setup.dir, 'site/.vitepress/dist/app/index.html'), 'utf8'), 'pwa');
    }
    const calls = (await readFile(join(setup.dir, 'calls'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(calls.length, failure === 'site' ? 1 : 2);
    if (calls[1]) assert.ok(calls[1].includes('--base=/tandem/app/'));
  });
}

const docker = `const fs = require('node:fs');
const args=process.argv.slice(2), base=process.env.FIXTURE;
fs.appendFileSync(base+'/calls', JSON.stringify(args)+'\\n');
if (process.env.FAILURE===args[0]) process.exit(23);
const hold = () => { fs.writeFileSync(base+'/waiting',''); setInterval(()=>{},1000); };
if (args[0]==='volume' && args[1]==='create') {
 fs.writeFileSync(base+'/volume',''); console.log('fixture-volume');
 if (process.env.FAILURE==='interrupt-volume') hold();
}
if (args[0]==='create') {
 fs.writeFileSync(base+'/container',''); console.log('fixture-container');
 if (process.env.FAILURE==='interrupt-create') hold();
}
if (args[0]==='container' && args[1]==='ls' && fs.existsSync(base+'/container')) console.log('fixture-container');
if (args[0]==='volume' && args[1]==='ls' && fs.existsSync(base+'/volume')) console.log('fixture-volume');
if (args[0]==='rm') fs.unlinkSync(base+'/container');
if (args[0]==='volume' && args[1]==='rm') fs.unlinkSync(base+'/volume');
if (args[0]==='inspect') {
 if (args[2].includes('.State}}')) console.log(JSON.stringify({Status:'running', Health:{Status:'healthy'}}));
 else console.log(args[2].includes('.Config.User') ? '65532:65532' : '0');
}
if (args[0]==='port') console.log('127.0.0.1:8787');
if (args[0]==='cp') fs.writeFileSync(args[2], '[['+JSON.stringify('hash')+',{}]]', {mode:0o600});`;
const pnpm = `const fs=require('node:fs');
if (process.env.FAILURE==='pwa') process.exit(23);
if (process.env.FAILURE==='interrupt') {
 fs.writeFileSync(process.env.FIXTURE+'/waiting',''); setInterval(()=>{},1000);
}`;

for (const failure of ['', 'create', 'start', 'pwa', 'interrupt', 'interrupt-create', 'interrupt-volume']) {
  test(`容器生命周期：${failure || '成功'} 后清理已创建资源`, { timeout: 10000 }, async (t) => {
    const setup = await fixture(t, ['container-smoke.mjs', 'run.mjs'], { docker, pnpm });
    const options = { ...setup, env: { ...setup.env, FAILURE: failure } };
    if (failure.startsWith('interrupt')) {
      const child = spawn(process.execPath, ['.github/scripts/container-smoke.mjs', 'fixture-image'], { ...options, stdio: 'ignore' });
      const exited = once(child, 'exit');
      t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
      for (let n = 0; n < 100; n++) {
        try { await readFile(join(setup.dir, 'waiting')); break; }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        await sleep(25);
      }
      await readFile(join(setup.dir, 'waiting'));
      child.kill('SIGTERM');
      const [code] = await exited;
      assert.notEqual(code, 0);
    } else {
      const invocation = exec(process.execPath, ['.github/scripts/container-smoke.mjs', 'fixture-image'], options);
      if (failure) await assert.rejects(invocation);
      else await invocation;
    }
    const calls = (await readFile(join(setup.dir, 'calls'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(calls.some((args) => args[0] === 'rm'), !['create', 'interrupt-volume'].includes(failure));
    assert.ok(calls.some((args) => args[0] === 'volume' && args[1] === 'rm'));
  });
}

for (const [name, candidate, current, status, publish, pushes] of [
  ['首次发布', 'relay-v1.0.0', undefined, 404, true, true],
  ['新版本', 'relay-v1.2.0', 'relay-v1.1.0', 200, true, true],
  ['旧版本重跑', 'relay-v1.0.0', 'relay-v1.1.0', 200, true, false],
  ['同版本重跑', 'relay-v1.1.0', 'relay-v1.1.0', 200, true, false],
  ['预发布', 'relay-v2.0.0-rc.1', undefined, 200, true, false],
  ['GHCR 失败', 'relay-v2.0.0', undefined, 500, true, false],
  ['缺少发布参数', 'relay-v2.0.0', 'relay-v1.0.0', 200, false, false],
]) {
  test(`晋升 CLI：${name}`, async (t) => {
    const setup = await fixture(t, ['relay-release.mjs', 'release-notes.mjs', 'release-version.mjs', 'run.mjs'], {
      docker: `require('node:fs').writeFileSync(process.env.FIXTURE+'/published', JSON.stringify(process.argv.slice(2)));`,
    });
    const mock = join(setup.dir, 'registry.mjs');
    await writeFile(mock, `const replies = [
      [200, {token:'fixture'}], [${status}, {config:{digest:'config'}}],
      [200, {config:{Labels:{'org.opencontainers.image.version':${JSON.stringify(current ?? '')}}}}],
    ];
    globalThis.fetch = async () => {
      const [status, body] = replies.shift();
      return new Response(JSON.stringify(body), {status});
    };`);
    const invocation = exec(process.execPath, [
      '--import', pathToFileURL(mock).href, '.github/scripts/relay-release.mjs', ...(publish ? ['--publish'] : []),
    ], { ...setup, env: {
      ...setup.env, RELAY_TAG: candidate, RELAY_IMAGE: 'ghcr.io/example/relay', RELAY_DIGEST: 'sha256:fixture',
      REGISTRY_USER: 'fixture', REGISTRY_PASSWORD: 'fixture',
    } });
    if (status === 500 || !publish) await assert.rejects(invocation);
    else await invocation;
    if (pushes) {
      assert.deepEqual(JSON.parse(await readFile(join(setup.dir, 'published'), 'utf8')),
        ['buildx', 'imagetools', 'create', '--tag', 'ghcr.io/example/relay:latest', 'ghcr.io/example/relay@sha256:fixture']);
    } else {
      await assert.rejects(readFile(join(setup.dir, 'published')), { code: 'ENOENT' });
    }
  });
}
