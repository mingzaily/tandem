import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  composeReleaseBody, downloadNotes,
  chatEndpoint, modelChangelog, prepareRelease, publishRelease, releaseSubjects, sourceVersions, stampVersion,
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

for (const value of ['v0.1.1', 'v1.12.2', 'v0.1.2026111101', 'v1.12.2028022999']) {
  test(`接受发布版本 ${value}`, () => assert.equal(releaseVersion(value).version, value.slice(1)));
}
for (const value of ['relay-v0.1.2026111101', 'v0.1.2026022901', 'v0.1.2026113101', 'v0.1.2026111100',
  'v0.1.20261111100', 'v00.1.2026111101', 'v0.1.2026111101-beta', 'v0.1.2026111101\n']) {
  test(`拒绝非法日期版本 ${JSON.stringify(value)}`, () => assert.equal(releaseVersion(value), undefined));
}

test('递增序号独立于日期 tag，同提交复用原版本', () => {
  assert.equal(nextVersion('0.1.0', [], sha), '0.1.1');
  assert.equal(nextVersion('0.1.0', [tag('v0.1.4'), tag('v0.1.2026111201')], sha), '0.1.5');
  assert.equal(nextVersion('0.1.0', [tag('v0.1.2026111003', sha)], sha), '0.1.2026111003');
  assert.equal(nextVersion('0.2.0', [tag('v0.1.9')], sha), '0.2.1');
  assert.throws(() => nextVersion('0.1.1', [], sha), /major.minor.0/);
});

test('同代际的递增版本新于日期版本', () => {
  assert.equal(compareVersions('0.1.1', '0.1.2026111201'), 1);
  assert.equal(compareVersions('0.1.2026111102', '0.1.2026111101'), 1);
  assert.equal(compareVersions('0.1.2026111102', '0.1.2026111201'), -1);
  assert.equal(compareVersions('0.2.0', '0.1.2026111101'), 1);
  assert.equal(compareVersions('0.10.0', '0.9.2026111101'), 1);
  assert.equal(compareVersions('0.1.4', '0.1.4'), 0);
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
  for (const name of ['desktop-release.mjs', 'release-notes.mjs', 'release-version.mjs', 'run.mjs']) {
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
    annotated: [], uploadOrigin: 'https://uploads.example.test' };
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
    if (method === 'POST' && path === '/git/tags') {
      const data = JSON.parse(body);
      assert.equal(data.message, data.tag);
      assert.equal(data.message.includes('\n'), false);
      assert.equal(data.type, 'commit');
      const annotated = { sha: `annotated-${data.tag}`, commit: data.object };
      state.annotated.push(annotated);
      return reply(annotated, 201);
    }
    if (method === 'POST' && path === '/git/refs') {
      const data = JSON.parse(body);
      const annotated = state.annotated.find((item) => item.sha === data.sha);
      state.tags.push(tag(data.ref.slice('refs/tags/'.length), annotated?.commit ?? data.sha));
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
  assert.deepEqual(first, { version: '0.1.1', tag: 'v0.1.1', skip: false });
  assert.deepEqual(first, retry);
  assert.equal(state.calls.filter(([method]) => method === 'POST').length, 2);
  assert.equal(state.tags[0].commit.sha, sha);
});

test('读取超过一页的 tags，日期 tag 不占用递增序号', async () => {
  const tags = Array.from({ length: 100 }, (_, i) => tag(`relay-v0.1.${i}`));
  tags.push(tag('v0.1.2026111108'));
  const { client } = githubFixture({ tags });
  assert.equal((await prepareRelease(client, { base: '0.1.0', sha, now })).version, '0.1.1');
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

async function packageFixture(t, version = '0.1.1') {
  const directory = await temporary(t);
  for (const arch of ['aarch64', 'x64']) {
    await writeFile(join(directory, `Tandem_${version}_${arch}.dmg`), `fixture-dmg-${arch}`);
    await writeFile(join(directory, `Tandem_${arch}.app.tar.gz`), `fixture-update-${arch}`);
    await writeFile(join(directory, `Tandem_${arch}.app.tar.gz.sig`), `fixture-signature-${arch}`);
  }
  return directory;
}

test('发布安装包、更新包和更新清单，已发布版本重跑保持原产物', async (t) => {
  const directory = await packageFixture(t);
  const { client, state } = githubFixture();
  const options = { version: '0.1.1', sha, directory };
  await publishRelease(client, options);
  assert.equal(state.releases[0].draft, false);
  assert.equal(state.releases[0].make_latest, 'true');
  assert.equal('target_commitish' in state.releases[0], false);
  assert.deepEqual(state.uploads.map((asset) => asset.name).sort(), [
    'Tandem_0.1.1_aarch64.dmg', 'Tandem_0.1.1_x64.dmg', 'Tandem_aarch64.app.tar.gz', 'Tandem_x64.app.tar.gz', 'latest.json',
  ]);
  const manifest = JSON.parse(state.uploads.find((asset) => asset.name === 'latest.json').data);
  assert.equal(manifest.version, '0.1.1');
  assert.equal(manifest.platforms['darwin-aarch64'].signature, 'fixture-signature-aarch64');
  assert.equal(manifest.platforms['darwin-x86_64'].signature, 'fixture-signature-x64');
  assert.equal(manifest.platforms['darwin-aarch64'].url, 'https://github.com/example/tandem/releases/download/v0.1.1/Tandem_aarch64.app.tar.gz');
  assert.equal(manifest.platforms['darwin-x86_64'].url, 'https://github.com/example/tandem/releases/download/v0.1.1/Tandem_x64.app.tar.gz');
  const count = state.calls.length;
  await publishRelease(client, options);
  assert.deepEqual(state.calls.slice(count), [['GET', '/releases/tags/v0.1.1']]);
});

test('上传中断保持草稿，重跑替换草稿产物后发布', async (t) => {
  const directory = await packageFixture(t);
  const { client, state } = githubFixture();
  const options = { version: '0.1.1', sha, directory };
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
  const directory = await packageFixture(t, '0.1.2026111101');
  const { client, state } = githubFixture({ releases: [{ tag_name: 'v0.1.2026111102' }] });
  await publishRelease(client, { version: '0.1.2026111101', sha, directory });
  assert.equal(state.releases[1].make_latest, 'false');
});

test('日期版本之后的递增版本成为 Latest', async (t) => {
  const directory = await packageFixture(t, '0.1.1');
  const { client, state } = githubFixture({ releases: [{ tag_name: 'v0.1.2026111201' }] });
  await publishRelease(client, { version: '0.1.1', sha, directory });
  assert.equal(state.releases[1].make_latest, 'true');
});

test('缺失、错误或多个安装包均阻止发布', async (t) => {
  const directory = await temporary(t);
  const { client, state } = githubFixture();
  const options = { version: '0.1.1', sha, directory };
  await assert.rejects(publishRelease(client, options), /只允许/);
  await writeFile(join(directory, 'wrong.dmg'), 'fixture');
  await assert.rejects(publishRelease(client, options), /只允许/);
  await writeFile(join(directory, 'Tandem_0.1.1_aarch64.dmg'), 'fixture');
  await assert.rejects(publishRelease(client, options), /只允许/);
  assert.equal(state.calls.length, 0);
});

test('缺少签名更新包时阻止创建 Release', async (t) => {
  const directory = await packageFixture(t);
  const { client, state } = githubFixture();
  await rm(join(directory, 'Tandem_aarch64.app.tar.gz.sig'));
  await assert.rejects(publishRelease(client, { version: '0.1.1', sha, directory }), { code: 'ENOENT' });
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

test('发布说明取上一版之后的提交标题，跳过合并提交和 relay tag', async () => {
  const tags = [tag('v0.1.2026111001', otherSha), tag('relay-v0.1.2026111201'), tag('v0.1.2026111101', sha)];
  const commits = {
    [`/compare/v0.1.2026111001...${sha}`]: {
      commits: [
        { commit: { message: 'Merge branch \'main\'\n\nbody' } },
        { commit: { message: 'Show the update action\n\nDetails' } },
      ],
    },
  };
  const client = {
    list: async () => tags,
    request: async (path) => commits[path] ?? { commit: { message: 'missing' } },
  };
  assert.deepEqual(await releaseSubjects(client, { version: '0.1.2026111101', sha, log: () => {} }), ['Show the update action']);
});

test('首个版本使用当前提交标题', async () => {
  const client = {
    list: async () => [],
    request: async (path) => {
      assert.equal(path, `/commits/${sha}`);
      return { commit: { message: 'First desktop release\n\nmore' } };
    },
  };
  assert.deepEqual(await releaseSubjects(client, { version: '0.1.2026111101', sha, log: () => {} }), ['First desktop release']);
});

test('模型说明失败、缺配置或回显密钥时使用提交标题', async () => {
  const subjects = ['Add the update page'];
  const llm = { url: 'https://notes.example.test/v1/chat/completions', key: 'notes-secret', model: 'notes-model' };
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push([url.href, options.headers.Authorization]);
    return new Response(JSON.stringify({ choices: [{ message: { content: 'notes-secret' } }] }), { status: 200 });
  };
  assert.equal(await modelChangelog(subjects, { ...llm, fetchImpl }), undefined);
  assert.equal(await modelChangelog(subjects, { ...llm, url: 'http://notes.example.test/v1' }), undefined);
  assert.equal(calls.length, 1);
  const quiet = () => {};
  const failed = await composeReleaseBody({
    subjects, version: '0.1.1', repository: 'mingzaily/tandem', llm, log: quiet,
    fetchImpl: async () => new Response('', { status: 401 }),
  });
  assert.equal(failed.source, 'commits');
  assert.equal(failed.reason, '接口返回 HTTP 401');
  assert.match(failed.body, /^## 更新内容\n\n- Add the update page/);
  assert.match(failed.body, /自签名证书/);
  assert.match(failed.body, /<summary>English<\/summary>/);
  assert.equal(failed.body.includes('notes-secret'), false);
  const unconfigured = await composeReleaseBody({ subjects, version: '0.1.1', repository: 'mingzaily/tandem', llm: {}, log: quiet });
  assert.equal(unconfigured.source, 'commits');
  assert.equal(unconfigured.reason, '没有配置接口地址、密钥或模型');
});

test('正文中文在前、英文折叠，下载表直链两种架构，不重复版本号和提交', () => {
  const { zh, en } = downloadNotes('0.1.1', 'mingzaily/tandem');
  for (const text of [zh, en]) {
    assert.match(text, /\[Tandem_0\.1\.1_aarch64\.dmg\]\(https:\/\/github\.com\/mingzaily\/tandem\/releases\/download\/v0\.1\.1\/Tandem_0\.1\.1_aarch64\.dmg\)/);
    assert.match(text, /Tandem_0\.1\.1_x64\.dmg\]/);
    assert.equal(/SHA256|源码提交|Commit:/.test(text), false);
  }
  assert.match(zh, /设置 → 关于/);
});

test('基础地址补上 chat/completions，非 HTTPS 和带账号的地址拒绝', () => {
  assert.equal(chatEndpoint('https://api.example.test/v1').href, 'https://api.example.test/v1/chat/completions');
  assert.equal(chatEndpoint('https://api.example.test/v1/').href, 'https://api.example.test/v1/chat/completions');
  assert.equal(chatEndpoint('https://api.example.test/v1/chat/completions').href, 'https://api.example.test/v1/chat/completions');
  assert.equal(chatEndpoint('https://api.example.test').href, 'https://api.example.test/chat/completions');
  assert.equal(chatEndpoint('http://api.example.test/v1'), undefined);
  assert.equal(chatEndpoint('https://user:pass@api.example.test/v1'), undefined);
  assert.equal(chatEndpoint('not a url'), undefined);
});

test('失败原因可以写进日志，但不含地址和密钥', async () => {
  const llm = { url: 'https://notes.example.test/v1', key: 'notes-secret', model: 'notes-model' };
  const reasons = [];
  const onFailure = (reason) => reasons.push(reason);
  const urls = [];
  await modelChangelog(['Add'], { ...llm, onFailure, fetchImpl: async (url) => { urls.push(url.href); return new Response('', { status: 404 }); } });
  await modelChangelog(['Add'], { ...llm, onFailure, fetchImpl: async () => { throw Object.assign(new Error('getaddrinfo ENOTFOUND notes.example.test'), { cause: { code: 'ENOTFOUND' } }); } });
  await modelChangelog(['Add'], { ...llm, onFailure, wait: async () => {}, fetchImpl: async () => { throw new DOMException('timed out', 'TimeoutError'); } });
  await modelChangelog(['Add'], { ...llm, onFailure, fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: 'notes-secret' } }] })) });
  await modelChangelog(['Add'], { ...llm, url: 'http://notes.example.test/v1', onFailure });
  await modelChangelog(['Add'], { url: '', key: '', model: '', onFailure });
  assert.deepEqual(urls, ['https://notes.example.test/v1/chat/completions']);
  assert.deepEqual(reasons, [
    '接口返回 HTTP 404', '请求失败（Error ENOTFOUND）', '请求超过 60 秒',
    '接口没有返回可用的说明（为空、过长或包含密钥）', '接口地址无效：需要不带账号的 HTTPS 地址', '没有配置接口地址、密钥或模型',
  ]);
  assert.equal(reasons.some((reason) => reason.includes('notes-secret') || reason.includes('notes.example')), false);
  const failed = await composeReleaseBody({ subjects: ['Add'], version: '0.1.1', sha, llm, fetchImpl: async () => new Response('', { status: 401 }) });
  assert.equal(failed.reason, '接口返回 HTTP 401');
});

test('中文翻译失败时保留已生成的英文说明', async () => {
  let calls = 0;
  const notes = await modelChangelog(['Add the update page'], {
    url: 'https://notes.example.test/v1/chat/completions', key: 'notes-secret', model: 'notes-model',
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ choices: [{ message: { content: '### Features\n\n- Updates can be checked.' } }] }), { status: 200 });
      }
      throw new Error('translation timed out');
    },
  });
  assert.equal(calls, 2);
  assert.match(notes.english, /### Features/);
  assert.equal(notes.chinese, undefined);
});

test('模型说明写入 Release，草稿重跑更新正文', async (t) => {
  const directory = await packageFixture(t);
  const { client, state } = githubFixture();
  const notes = await composeReleaseBody({
    subjects: ['Add the update page'], version: '0.1.1', sha,
    llm: { url: 'https://notes.example.test/v1/chat/completions', key: 'notes-secret', model: 'notes-model' },
    fetchImpl: async () => {
      state.notesCalls = (state.notesCalls ?? 0) + 1;
      const content = state.notesCalls === 1
        ? '### Features\n\n- Updates can be checked.'
        : '```markdown\n### 新功能\n\n- 可以检查更新。\n```';
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    },
  });
  assert.equal(notes.source, 'model');
  assert.match(notes.body, /### Features/);
  assert.match(notes.body, /### 新功能/);
  const options = { version: '0.1.1', sha, directory, body: notes.body };
  await publishRelease(client, options);
  assert.match(state.releases[0].body, /### Features/);
  assert.equal(state.releases[0].generate_release_notes, false);
  state.releases[0].draft = true;
  const revised = `${notes.body}\n\n补充`;
  await publishRelease(client, { ...options, body: revised });
  assert.equal(state.releases[0].body, revised);
  assert.equal(state.releases[0].draft, false);
});

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
  assert.equal(fixture.state.uploads[0].data.toString(), 'fixture-dmg-aarch64');
});
