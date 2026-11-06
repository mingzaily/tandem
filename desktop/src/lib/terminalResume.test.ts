import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Agent } from './api';
import { terminalResumeCommand } from './terminalResume';

describe('terminal resume commands', () => {
  let root: string;
  let bin: string;
  let cwd: string;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'tandem-resume-')));
    bin = join(root, 'bin');
    cwd = join(root, "project's $HOME `printf expanded`; 中文", '.claude/worktrees/task');
    mkdirSync(bin);
    mkdirSync(cwd, { recursive: true });
    for (const agent of ['claude', 'codex', 'pi']) {
      const file = join(bin, agent);
      writeFileSync(file, '#!/bin/sh\nprintf "%s\\0" "$PWD" "$@"\n');
      chmodSync(file, 0o700);
    }
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it.each<Agent>(['claude', 'codex', 'pi'])('resumes %s from its task directory in sh and zsh', (agent) => {
    const id = '11111111-2222-4333-8444-555555555555';
    const command = terminalResumeCommand({ agent, id, cwd });
    for (const shell of ['/bin/sh', '/bin/zsh']) {
      const result = spawnSync(shell, ['-f', '-c', command], { cwd: root, env: { ...process.env, PATH: bin }, encoding: 'utf8' });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout.split('\0')).toEqual([cwd, agent === 'claude' ? '--resume' : agent === 'pi' ? '--session' : 'resume', id, '']);
    }
  });

  it('runs the CLI only after entering the task directory', () => {
    const command = terminalResumeCommand({ agent: 'codex', id: '11111111-2222-4333-8444-555555555555', cwd: join(root, 'removed') });
    const result = spawnSync('/bin/sh', ['-c', command], { cwd: root, env: { ...process.env, PATH: bin }, encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
  });
});
