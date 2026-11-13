import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { localBuildIdentity, localBuildPlist } from './local-build.mjs';

test('local builds capture a real commit and distinguish tracked, untracked and ignored files', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'tandem-build-id-'));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    git('init');
    writeFileSync(join(cwd, '.gitignore'), 'target/\n');
    writeFileSync(join(cwd, 'source.txt'), 'clean');
    git('add', '.gitignore', 'source.txt');
    git('-c', 'user.name=Tandem Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Fixture');
    const commit = git('rev-parse', 'HEAD');
    assert.deepEqual(localBuildIdentity(cwd), { commit, dirty: false });
    mkdirSync(join(cwd, 'target')); writeFileSync(join(cwd, 'target', 'cache'), 'generated');
    assert.equal(localBuildIdentity(cwd).dirty, false);
    writeFileSync(join(cwd, 'source.txt'), 'edited');
    assert.deepEqual(localBuildIdentity(cwd), { commit, dirty: true });
    git('checkout', '--', 'source.txt');
    writeFileSync(join(cwd, 'new-source.txt'), 'untracked');
    assert.equal(localBuildIdentity(cwd).dirty, true);
    const plist = localBuildPlist({ commit, dirty: false });
    assert.ok(plist.includes(`<key>TandemBuildCommit</key><string>${commit}</string>`));
    assert.ok(plist.includes('<key>TandemLocalBuild</key><true/>'));
    assert.ok(plist.includes('<key>TandemBuildDirty</key><false/>'));
    assert.ok(localBuildPlist({ commit, dirty: true }).includes('<key>TandemBuildDirty</key><true/>'));
    assert.throws(() => localBuildPlist({ commit: '<unsafe>', dirty: false }));
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test('an internal release requires committed Git provenance', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'tandem-build-no-git-'));
  try { assert.throws(() => localBuildIdentity(cwd)); }
  finally { rmSync(cwd, { recursive: true, force: true }); }
});
