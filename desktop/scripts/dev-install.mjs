// Development install: builds the current source as a local release build in its own target
// directory and installs it to /Applications. Official releases come from CI and the updater.
// The project's own target directory is never touched, and a running Tandem keeps its bundle:
// it would otherwise keep running old code from a bundle that now holds another build.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = dirname(dirname(fileURLToPath(import.meta.url)));
const target = process.env.TANDEM_INSTALL_TARGET_DIR ?? join(homedir(), 'Library/Caches/tandem-install-target');
const built = join(target, 'release/bundle/macos/Tandem.app');
const installed = '/Applications/Tandem.app';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

/** `pgrep -f` misses this process on macOS, so the full command lines are read from `ps`. */
function running() {
  const { stdout } = spawnSync('ps', ['-axo', 'command='], { encoding: 'utf8' });
  return stdout.split('\n').some((line) => line.startsWith(`${installed}/Contents/MacOS/tandem`));
}

if (!process.argv.includes('--no-build')) {
  run('pnpm', ['tauri', 'build', '--bundles', 'app'], { cwd: desktop, env: { ...process.env, CARGO_TARGET_DIR: target } });
}
if (!existsSync(built)) {
  console.error(`没有找到开发构建：${built}`);
  process.exit(1);
}
run('codesign', ['--verify', '--deep', '--strict', built]);
if (running()) {
  console.log(`Tandem 正在运行，没有替换。开发构建在 ${built}`);
  console.log('退出 Tandem 后运行 pnpm dev:install --no-build 完成安装。');
  process.exit(0);
}
run('rm', ['-rf', installed]);
run('ditto', [built, installed]);
console.log(`开发构建已安装到 ${installed}`);
