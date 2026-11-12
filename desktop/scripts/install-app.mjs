// Builds the signed release into its own target directory and installs it to /Applications.
// The project's own target directory and a running Tandem are never touched: replacing the
// bundle under a running app makes macOS abort it at its next notification call.
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

function running() {
  return spawnSync('pgrep', ['-f', `${installed}/Contents/MacOS/tandem`], { stdio: 'ignore' }).status === 0;
}

if (!process.argv.includes('--no-build')) {
  run('pnpm', ['tauri', 'build', '--bundles', 'app'], { cwd: desktop, env: { ...process.env, CARGO_TARGET_DIR: target } });
}
if (!existsSync(built)) {
  console.error(`没有找到构建结果：${built}`);
  process.exit(1);
}
run('codesign', ['--verify', '--deep', '--strict', built]);
if (running()) {
  console.log(`Tandem 正在运行，没有替换。新版本在 ${built}`);
  console.log('退出 Tandem 后运行 pnpm install:app --no-build 完成安装。');
  process.exit(0);
}
run('rm', ['-rf', installed]);
run('ditto', [built, installed]);
console.log(`已安装到 ${installed}`);
