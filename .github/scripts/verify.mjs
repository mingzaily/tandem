import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { root, run } from './run.mjs';

const flags = new Set(process.argv.slice(2));
for (const flag of flags) {
  if (!['--image', '--install-browser', '--help'].includes(flag)) throw new Error(`未知参数：${flag}`);
}
if (flags.has('--help')) {
  console.info('用法：node .github/scripts/verify.mjs [--image] [--install-browser]\n验证脚本、relay、PWA、站点和两种部署路径的浏览器流程；--image 追加本机容器验收，--install-browser 安装 Chrome 及其系统依赖。全程不推送或部署。');
  process.exit(0);
}
const stop = new AbortController();
process.once('SIGINT', () => stop.abort());
process.once('SIGTERM', () => stop.abort());
const execute = (command, args, options = {}) => run(command, args, { signal: stop.signal, ...options });
if (flags.has('--image')) await execute('docker', ['info', '--format', '{{.OSType}}/{{.Architecture}}']);

const tests = (await readdir(new URL('./', import.meta.url)))
  .filter((name) => name.endsWith('.test.mjs')).map((name) => `.github/scripts/${name}`);
await execute(process.execPath, ['--test', ...tests]);
for (const project of ['relay', 'pwa', 'site']) {
  await execute('pnpm', ['--dir', project, 'install', '--frozen-lockfile', '--prefer-offline']);
}
if (flags.has('--install-browser')) {
  await execute('pnpm', ['--dir', 'pwa', 'exec', 'playwright', 'install', '--with-deps', 'chrome']);
}

const target = resolve(process.env.CARGO_TARGET_DIR ?? resolve(root, 'relay/target'));
const env = { CARGO_TARGET_DIR: target, TANDEM_RELAY_TEST_BINARY: resolve(target, 'debug/tandem-relay') };
const check = (command, args, extraEnv = {}) => execute(command, args, { env: { ...env, ...extraEnv } });
const pnpm = (project, ...args) => check('pnpm', ['--dir', project, ...args]);
await check('cargo', ['test', '--locked', '--manifest-path', 'relay/Cargo.toml']);
await check('cargo', ['clippy', '--locked', '--manifest-path', 'relay/Cargo.toml', '--all-targets', '--', '-D', 'warnings']);
for (const project of ['relay', 'pwa']) {
  await pnpm(project, 'typecheck');
  await pnpm(project, 'test');
}
const browserEnv = (base, name) => ({
  PWA_BASE: base,
  ...(process.env.TANDEM_CI_ARTIFACTS ? { SHOTS: resolve(process.env.TANDEM_CI_ARTIFACTS, `${name}/pwa-`) } : {}),
});
await pnpm('pwa', 'build');
await check('pnpm', ['--dir', 'pwa', 'exec', 'tsx', 'test/browser.e2e.ts'], browserEnv('/', 'root'));
await pnpm('site', 'build:pages');
await pnpm('site', 'test');
await check('pnpm', ['--dir', 'pwa', 'exec', 'tsx', 'test/browser.e2e.ts'], browserEnv('/tandem/app/', 'pages'));
await check('pnpm', ['--dir', 'pwa', 'test:hosting'], process.env.TANDEM_CI_ARTIFACTS
  ? { SHOTS: resolve(process.env.TANDEM_CI_ARTIFACTS, 'hosting') } : {});

if (flags.has('--image')) {
  const name = `tandem-ci-${randomUUID()}`;
  const image = `tandem-relay:${name}`;
  try {
    await execute('docker', ['buildx', 'create', '--name', name, '--driver', 'docker-container']);
    await execute('docker', ['buildx', 'build', '--builder', name, '--load', '--file', 'relay/Dockerfile', '--tag', image, '.']);
    await execute(process.execPath, ['.github/scripts/container-smoke.mjs', image]);
  } finally {
    try {
      const owned = await run('docker', ['image', 'ls', '--quiet', image], { capture: true });
      if (owned) await run('docker', ['image', 'rm', image]);
    } finally {
      const builders = await run('docker', ['buildx', 'ls', '--format', '{{.Name}}'], { capture: true });
      if (builders.split('\n').includes(name)) await run('docker', ['buildx', 'rm', name]);
    }
  }
}
console.info('本地／CI 共享验证全部通过。');
