import { spawnSync } from 'node:child_process';
import { cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
for (const args of [
  ['--dir', 'site', 'build'],
  ['--dir', 'pwa', 'build', '--base=/tandem/app/'],
]) {
  const result = spawnSync('pnpm', args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

await cp(new URL('../../pwa/dist/', import.meta.url), new URL('../../site/.vitepress/dist/app/', import.meta.url), { recursive: true });
console.info('Pages 产物已组合：官网 /tandem/，手机端 /tandem/app/。');
