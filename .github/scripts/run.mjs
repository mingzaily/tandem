import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../../', import.meta.url));

export function run(command, args, { cwd = root, env = {}, capture = false, signal } = {}) {
  console.info(`> ${command} ${args.join(' ')}`);
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', capture ? 'pipe' : 'inherit', 'inherit'],
    signal,
  });
  let output = '';
  let failure;
  child.stdout?.setEncoding('utf8').on('data', (chunk) => { output += chunk; });
  return new Promise((resolve, reject) => {
    // An aborted child can perform its own cleanup before closing.
    child.once('error', (error) => { failure = error; });
    child.once('close', (code, stoppedBy) => {
      if (failure) reject(failure);
      else if (code === 0) resolve(output.trim());
      else reject(new Error(`${command} 失败：${stoppedBy ?? `退出码 ${code}`}`));
    });
  });
}
