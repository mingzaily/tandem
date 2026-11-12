import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  prepareRelease, publishRelease, sourceVersions, stampVersion,
} from './desktop-release.mjs';
import { compareVersions, githubClient, nextVersion, releaseVersion } from './release-version.mjs';

const sha = 'a'.repeat(40);
const otherSha = 'b'.repeat(40);
const tag = (name, commit = otherSha) => ({ name, commit: { sha: commit } });
const now = new Date('2026-11-11T01:00:00Z');
const exec = promisify(execFile);

async function temporary(t) {
  const directory = await mkdtemp(join(tmpdir(), 'tandem-desktop-release-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

for (const value of ['v0.1.2026111101', 'v1.12.2028022999']) {
  test(`接受日期版本 ${value}`, () => assert.equal(releaseVersion(value).version, value.slice(1)));
}
for (const value of ['relay-v0.1.2026111101', 'v0.1.0', 'v0.1.2026022901', 'v0.1.2026113101', 'v0.1.2026111100',
  'v0.1.20261111100', 'v00.1.2026111101', 'v0.1.2026111101-beta', 'v0.1.2026111101\n']) {
  test(`拒绝非法日期版本 ${JSON.stringify(value)}`, () => assert.equal(releaseVersion(value), undefined));
}

test('北京时间跨日、每日序号与重跑版本', () => {
  assert.equal(nextVersion('0.1.0', [], sha, new Date('2026-11-10T16:00:00Z')), '0.1.2026111101');
  assert.equal(nextVersion('0.1.0', [tag('v0.1.2026111101')], sha, now), '0.1.2026111102');
  assert.equal(nextVersion('0.1.0', [tag('v0.1.2026111003')], sha, now), '0.1.2026111101');
  assert.equal(nextVersion('0.1.0', [tag('v0.1.2026111003', sha)], sha, now), '0.1.2026111003');
  assert.equal(nextVersion('0.2.0', [tag('v0.1.2026111199')], sha, now), '0.2.2026111101');
  assert.throws(() => nextVersion('0.1.0', [tag('v0.1.2026111199')], sha, now), /序号已达 99/);
  assert.throws(() => nextVersion('0.1.0', [tag('v0.1.2026111201')], sha, now), /运行器时间/);
  assert.throws(() => nextVersion('0.1.1', [], sha, now), /major.minor.0/);
});

test('版本按数字段比较，功能代际高于日期补丁', () => {
  assert.equal(compareVersions('0.1.2026111102', '0.1.2026111101'), 1);
  assert.equal(compareVersions('0.1.2026111102', '0.1.2026111201'), -1);
  assert.equal(compareVersions('0.2.0', '0.1.2026111101'), 1);
  assert.equal(compareVersions('0.10.0', '0.9.2026111101'), 1);
  assert.equal(compareVersions('0.1.2026111101', '0.1.2026111101'), 0);
});

async function sourceFixture(t) {
  const directory = await temporary(t);
  await mkdir(join(directory, 'desktop/src-tauri'), { recursive: true });
  await writeFile(join(directory, 'desktop/package.json'), '{"name":"tandem","version":"0.1.0"}\n');
  await writeFile(join(directory, 'desktop/src-tauri/tauri.conf.json'), '{"version":"0.1.0","identifier":"test.tandem"}\n');
  await writeFile(join(directory, 'desktop/src-tauri/Cargo.toml'), '[package]\nname = "tandem"\nversion = "0.1.0"\n\n[dependencies]\nserde = "1"\n');
  await writeFile(join(directory, 'desktop/src-tauri/Cargo.lock'), 'version = 4\n\n[[package]]\nname = "other"\nversion = "1.2.3"\n\n[[package]]\nname = "tandem"\nversion = "0.1.0"\n');
  return directory;
}

test('CI 同步四处版本并保留依赖及锁文件格式', async (t) => {
  const directory = await sourceFixture(t);
  await stampVersion('0.1.2026111101', directory);
  assert.equal((await sourceVersions(directory)).version, '0.1.2026111101');
  assert.match(await readFile(join(directory, 'desktop/src-tauri/Cargo.toml'), 'utf8'), /serde = "1"/);
  assert.match(await readFile(join(directory, 'desktop/src-tauri/Cargo.lock'), 'utf8'), /name = "other"\nversion = "1.2.3"/);
  await assert.rejects(stampVersion('0.1.2026111100', directory), /格式错误/);
});

test('版本不一致时在写入前中止', async (t) => {
  const directory = await sourceFixture(t);
  const config = join(directory, 'desktop/src-tauri/tauri.conf.json');
  await writeFile(config, '{"version":"0.2.0"}');
  await assert.rejects(stampVersion('0.1.2026111101', directory), /版本需要一致/);
  assert.equal(JSON.parse(await readFile(join(directory, 'desktop/package.json'), 'utf8')).version, '0.1.0');
});

test('真实 CLI 校验与写入，发布命令拒绝其他分支', async (t) => {
  const directory = await sourceFixture(t);
  await mkdir(join(directory, '.github/scripts'), { recursive: true });
  for (const name of ['desktop-release.mjs', 'release-version.mjs', 'run.mjs']) {
    await cp(new URL(name, import.meta.url), join(directory, '.github/scripts', name));
  }
  const command = ['.github/scripts/desktop-release.mjs'];
  await exec(process.execPath, [...command, 'check'], { cwd: directory });
  await exec(process.execPath, [...command, 'stamp', '0.1.2026111101'], { cwd: directory });
  assert.equal((await sourceVersions(directory)).version, '0.1.2026111101');
  await symlink(directory, join(directory, 'linked-workspace'), 'dir');
  const linked = await exec(process.execPath, ['linked-workspace/.github/scripts/desktop-release.mjs', 'check'], { cwd: directory });
  assert.match(linked.stdout, /桌面源码版本一致：0\.1\.2026111101/);
  await assert.rejects(exec(process.execPath, [...command, 'prepare'], {
    cwd: directory, env: { ...process.env, GITHUB_REF: 'refs/heads/feature' },
  }), (error) => error.stderr.includes('只接受 main 分支'));
});

function githubFixture({ tags = [], releases = [], comparison = 'ahead' } = {}) {
  const state = { tags: structuredClone(tags), releases: structuredClone(releases), calls: [], uploads: [], failUpload: 0,
    uploadOrigin: 'https://uploads.example.test' };
  let nextId = 100;
  const fetchImpl = async (input, options) => {
    const url = new URL(input);
    const path = url.pathname.replace('/repos/example/tandem', '');
    const method = options.method;
    const body = options.body;
    state.calls.push([method, path]);
    assert.equal(options.headers.Authorization, 'Bearer fixture-token');
    const reply = (value, status = 200) => new Response(status === 204 ? null : JSON.stringify(value), { status });
    if (method === 'GET' && ['/tags', '/releases'].includes(path)) {
      const values = path === '/tags' ? state.tags : state.releases;
      const offset = (Number(url.searchParams.get('page')) - 1) * 100;
      return reply(values.slice(offset, offset + 100));
    }
    if (path.startsWith('/compare/')) return reply({ status: comparison });
    if (method === 'POST' && path === '/git/refs') {
      const data = JSON.parse(body);
      state.tags.push(tag(data.ref.slice('refs/tags/'.length), data.sha));
      return reply({}, 201);
    }
    if (method === 'GET' && path.startsWith('/releases/tags/')) {
      const release = state.releases.find((item) => item.tag_name === path.slice('/releases/tags/'.length));
      return release ? reply(release) : reply({}, 404);
    }
    if (method === 'POST' && path === '/releases') {
      const release = { ...JSON.parse(body), id: nextId++, assets: [], html_url: 'https://example.test/release',
        upload_url: `${state.uploadOrigin}/repos/example/tandem/releases/100/assets{?name,label}` };
      state.releases.push(release);
      return reply(release, 201);
    }
    if (method === 'DELETE') {
      const id = Number(path.split('/').at(-1));
      for (const release of state.releases) release.assets = release.assets.filter((item) => item.id !== id);
      return reply({}, 204);
    }
    if (method === 'POST' && path.endsWith('/assets')) {
      const release = state.releases.find((item) => item.id === 100);
      assert.equal(release.draft, true, '上传期间保持草稿');
      const name = url.searchParams.get('name');
      state.uploads.push({ name, data: Buffer.from(body) });
      if (state.failUpload === state.uploads.length) return reply({}, 503);
      release.assets.push({ id: nextId++, name });
      return reply({}, 201);
    }
    if (method === 'PATCH') {
      const release = state.releases.find((item) => item.id === Number(path.split('/').at(-1)));
      Object.assign(release, JSON.parse(body));
      return reply(release);
    }
    throw new Error(`未预期的 API 调用：${method} ${path}`);
  };
  const client = githubClient({ repository: 'example/tandem', token: ['fixture', 'token'].join('-'), fetchImpl });
  return { state, client, fetchImpl };
}

test('分配版本绑定提交，失败重跑复用 tag', async () => {
  const { client, state } = githubFixture();
  const first = await prepareRelease(client, { base: '0.1.0', sha, now });
  const retry = await prepareRelease(client, { base: '0.1.0', sha, now });
  assert.deepEqual(first, { version: '0.1.2026111101', tag: 'v0.1.2026111101', skip: false });
  assert.deepEqual(first, retry);
  assert.equal(state.calls.filter(([method]) => method === 'POST').length, 1);
});

test('读取超过一页的 tags，序号包含早先失败的预留版本', async () => {
  const tags = Array.from({ length: 100 }, (_, i) => tag(`relay-v0.1.${i}`));
  tags.push(tag('v0.1.2026111108'));
  const { client } = githubFixture({ tags });
  assert.equal((await prepareRelease(client, { base: '0.1.0', sha, now })).version, '0.1.2026111109');
});

for (const [name, tags, newest, comparison] of [
  ['同提交已发布', [tag('v0.1.2026111101', sha)], 'v0.1.2026111101', 'ahead'],
  ['旧版本重跑', [tag('v0.1.2026111101', sha)], 'v0.1.2026111102', 'ahead'],
  ['旧提交首次重跑', [], 'v0.1.2026111001', 'behind'],
  ['历史分叉', [], 'v0.1.2026111001', 'diverged'],
  ['产品代际回退', [], 'v0.2.2026111001', 'ahead'],
]) {
  test(`跳过${name}，保留现有发布`, async () => {
    const { client, state } = githubFixture({ tags, releases: [{ tag_name: newest }], comparison });
    assert.equal((await prepareRelease(client, { base: '0.1.0', sha, now })).skip, true);
    assert.equal(state.calls.some(([method]) => method === 'POST'), false);
  });
}

async function packageFixture(t, version = '0.1.2026111101') {
  const directory = await temporary(t);
  await writeFile(join(directory, `Tandem_${version}_universal.dmg`), 'fixture-dmg');
  await writeFile(join(directory, 'Tandem.app.tar.gz'), 'fixture-update');
  await writeFile(join(directory, 'Tandem.app.tar.gz.sig'), 'fixture-signature');
  return directory;
}

test('发布完整安装包和校验值，已发布版本重跑保持原产物', async (t) => {
  const directory = await packageFixture(t);
  const { client, state } = githubFixture();
  const options = { version: '0.1.2026111101', sha, directory };
  await publishRelease(client, options);
  assert.equal(state.releases[0].draft, false);
  assert.equal(state.releases[0].make_latest, 'true');
  const checksum = state.uploads.find((asset) => asset.name === 'SHA256SUMS').data.toString();
  assert.ok(checksum.startsWith(`${createHash('sha256').update('fixture-dmg').digest('hex')}  Tandem_0.1.2026111101_universal.dmg\n`));
  assert.equal(checksum.trim().split('\n').length, 4);
  const manifest = JSON.parse(state.uploads.find((asset) => asset.name === 'latest.json').data);
  assert.equal(manifest.version, '0.1.2026111101');
  assert.deepEqual(manifest.platforms['darwin-aarch64'], manifest.platforms['darwin-x86_64']);
  assert.equal(manifest.platforms['darwin-aarch64'].signature, 'fixture-signature');
  assert.equal(manifest.platforms['darwin-aarch64'].url, 'https://github.com/example/tandem/releases/download/v0.1.2026111101/Tandem.app.tar.gz');
  const count = state.calls.length;
  await publishRelease(client, options);
  assert.deepEqual(state.calls.slice(count), [['GET', '/releases/tags/v0.1.2026111101']]);
});

test('上传中断保持草稿，重跑替换草稿产物后发布', async (t) => {
  const directory = await packageFixture(t);
  const { client, state } = githubFixture();
  const options = { version: '0.1.2026111101', sha, directory };
  state.failUpload = 2;
  await assert.rejects(publishRelease(client, options), /HTTP 503/);
  assert.equal(state.releases[0].draft, true);
  assert.equal(state.releases[0].assets.length, 1);
  state.failUpload = 0;
  await publishRelease(client, options);
  assert.equal(state.releases[0].draft, false);
  assert.equal(state.releases[0].assets.length, 5);
});

test('旧任务发布不会夺取 Latest', async (t) => {
  const directory = await packageFixture(t);
  const { client, state } = githubFixture({ releases: [{ tag_name: 'v0.1.2026111102' }] });
  await publishRelease(client, { version: '0.1.2026111101', sha, directory });
  assert.equal(state.releases[1].make_latest, 'false');
});

test('缺失、错误或多个安装包均阻止发布', async (t) => {
  const directory = await temporary(t);
  const { client, state } = githubFixture();
  const options = { version: '0.1.2026111101', sha, directory };
  await assert.rejects(publishRelease(client, options), /只允许/);
  await writeFile(join(directory, 'wrong.dmg'), 'fixture');
  await assert.rejects(publishRelease(client, options), /只允许/);
  await writeFile(join(directory, 'Tandem_0.1.2026111101_universal.dmg'), 'fixture');
  await assert.rejects(publishRelease(client, options), /只允许/);
  assert.equal(state.calls.length, 0);
});

test('缺少签名更新包时阻止创建 Release', async (t) => {
  const directory = await packageFixture(t);
  const { client, state } = githubFixture();
  await rm(join(directory, 'Tandem.app.tar.gz.sig'));
  await assert.rejects(publishRelease(client, { version: '0.1.2026111101', sha, directory }), { code: 'ENOENT' });
  assert.equal(state.calls.length, 0);
});

for (const status of [401, 403, 429, 500]) {
  test(`GitHub HTTP ${status} 中止发布且错误省略凭证`, async () => {
    const client = githubClient({ repository: 'example/tandem', token: 'private-token',
      fetchImpl: async () => new Response('private-token', { status }) });
    await assert.rejects(prepareRelease(client, { base: '0.1.0', sha, now }),
      (error) => error.message.includes(`HTTP ${status}`) && !error.message.includes('private-token'));
  });
}

test('真实 HTTP 贯通版本预留、二进制上传、校验值及发布', { timeout: 15000 }, async (t) => {
  const fixture = githubFixture();
  const server = createServer(async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const result = await fixture.fetchImpl(`${fixture.state.uploadOrigin}${request.url}`, {
        method: request.method, headers: { Authorization: request.headers.authorization }, body: Buffer.concat(chunks),
      });
      response.writeHead(result.status, { 'Content-Type': 'application/json' });
      response.end(await result.text());
    } catch (error) {
      response.writeHead(500);
      response.end(error.message);
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); });
  fixture.state.uploadOrigin = `http://127.0.0.1:${server.address().port}`;
  const client = githubClient({ repository: 'example/tandem', token: ['fixture', 'token'].join('-'), apiUrl: fixture.state.uploadOrigin });
  const plan = await prepareRelease(client, { base: '0.1.0', sha, now });
  const directory = await packageFixture(t, plan.version);
  await publishRelease(client, { version: plan.version, sha, directory });
  assert.equal(fixture.state.releases[0].draft, false);
  assert.equal(fixture.state.uploads[0].data.toString(), 'fixture-dmg');
});
