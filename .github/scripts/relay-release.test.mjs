import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { imageVersion, latestVersion, shouldPromote, registryImage, prepareRelay, stampRelay, relaySource, publishRelayRelease, pullNotes } from './relay-release.mjs';
import { nextVersion } from './release-version.mjs';

for (const [candidate, current, expected] of [
  ['relay-v0.1.0', undefined, true],
  ['relay-v1.10.0', 'relay-v1.9.9', true],
  ['relay-v2.0.0', 'relay-v1.99.99', true],
  ['relay-v1.2.4', 'relay-v1.2.3', true],
  ['relay-v1.2.3', 'relay-v1.2.3', false],
  ['relay-v1.2.2', 'relay-v1.2.3', false],
  ['relay-v0.99.0', 'relay-v1.0.0', false],
  ['relay-v2.0.0-rc.1', 'relay-v1.0.0', false],
  ['relay-v2.0.0+build', undefined, false],
  ['v2.0.0', undefined, false],
  ['main', undefined, false],
]) {
  test(`${candidate} 对 ${current ?? '首次发布'} 的 latest 晋升为 ${expected}`, () => {
    assert.equal(shouldPromote(candidate, current), expected);
  });
}
test('现有 latest 的版本无法识别时阻止覆盖', () => {
  assert.throws(() => shouldPromote('relay-v2.0.0', 'unknown'), /核对/);
});

const credentials = { image: 'ghcr.io/example/relay', username: 'fixture', password: 'secret-fixture' };
function registry(t, responses) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    assert.ok(responses.length, `unexpected request: ${url}`);
    const [status, body, headers] = responses.shift();
    return new Response(JSON.stringify(body), { status, headers });
  });
  return calls;
}
test('首次发布仅将 latest 的 404 视为尚无版本', async (t) => {
  registry(t, [[200, { token: 'fixture' }], [404, {}]]);
  assert.equal(await latestVersion(credentials), undefined);
});
test('读取多架构 latest 的 linux/amd64 配置版本，跳过证明清单', async (t) => {
  const calls = registry(t, [
    [200, { token: 'fixture' }],
    [200, { manifests: [
      { platform: { os: 'unknown', architecture: 'unknown' }, digest: 'proof' },
      { platform: { os: 'linux', architecture: 'amd64' }, digest: 'manifest' },
    ] }],
    [200, { config: { digest: 'config' } }],
    [200, { config: { Labels: { 'org.opencontainers.image.version': 'relay-v1.2.3' } } }],
  ]);
  assert.equal(await latestVersion(credentials), 'relay-v1.2.3');
  assert.ok(calls[2].url.endsWith('/manifests/manifest'));
  assert.ok(calls[3].url.endsWith('/blobs/config'));
  assert.equal(calls[1].options.headers.Authorization, 'Bearer fixture');
});
test('已有单架构镜像同样按配置版本判断', async (t) => {
  registry(t, [[200, { token: 'fixture' }], [200, { config: { digest: 'config' } }],
    [200, { config: { Labels: { 'org.opencontainers.image.version': 'relay-v0.1.0' } } }]]);
  assert.equal(await latestVersion(credentials), 'relay-v0.1.0');
});
for (const status of [401, 403, 500]) {
  test(`读取 latest 遇到 HTTP ${status} 时阻止晋升`, async (t) => {
    registry(t, [[200, { token: 'fixture' }], [status, {}]]);
    await assert.rejects(latestVersion(credentials), new RegExp(`HTTP ${status}`));
  });
}
test('准入失败不会按首次发布处理，也不暴露凭证', async (t) => {
  registry(t, [[401, {}]]);
  await assert.rejects(latestVersion(credentials), (error) => {
    assert.match(error.message, /GHCR 准入失败/);
    assert.ok(!error.message.includes(credentials.password));
    return true;
  });
});
test('latest 缺少版本标签时阻止覆盖', async (t) => {
  registry(t, [[200, { token: 'fixture' }], [200, { config: { digest: 'config' } }], [200, { config: {} }]]);
  await assert.rejects(latestVersion(credentials), /缺少版本标签/);
});

const sourceSha = 'a'.repeat(40);
const nextSha = 'b'.repeat(40);
const date = new Date('2026-11-11T01:00:00Z');
function gitFixture(tags = [], comparison = 'ahead') {
  const calls = [];
  let commit;
  return { calls, list: async () => tags, request: async (path, options) => {
    calls.push([path, options]);
    if (path.startsWith('/compare/')) return { status: comparison };
    if (path === '/git/tags') {
      assert.equal(options.json.message, options.json.tag);
      assert.equal(options.json.message.includes('\n'), false);
      commit = options.json.object;
      return { sha: `annotated-${options.json.tag}` };
    }
    assert.equal(path, '/git/refs');
    const name = options.json.ref.slice('refs/tags/'.length);
    assert.equal(options.json.sha, `annotated-${name}`);
    tags.push({ name, commit: { sha: commit } });
  } };
}
const gitTag = (name, sha = nextSha) => ({ name, commit: { sha } });
const imageDigest = 'sha256:' + 'c'.repeat(64);
const imageRecord = { version: 'relay-v0.1.2026111101', revision: sourceSha, digest: imageDigest, platforms: ['amd64', 'arm64'] };

test('桌面与 relay 使用同一递增序号，命名空间独立，日期 tag 不占新序号', () => {
  const tags = [gitTag('v0.1.4'), gitTag('v0.1.2026111105'), gitTag('relay-v0.1.3'), gitTag('relay-v0.1.2026111101')];
  assert.equal(nextVersion('0.1.0', tags, sourceSha), '0.1.5');
  assert.equal(nextVersion('0.1.0', tags, sourceSha, 'relay-v'), '0.1.4');
  assert.equal(nextVersion('0.1.0', [gitTag('relay-v0.1.2026111101', sourceSha)], sourceSha, 'relay-v'), '0.1.2026111101');
});

test('relay 预留版本在失败重跑时保持原值', async () => {
  const client = gitFixture();
  const options = { base: '0.1.0', sha: sourceSha, now: date, readImage: async () => undefined };
  const first = await prepareRelay(client, options);
  const retry = await prepareRelay(client, { ...options, now: new Date('2026-11-12T01:00:00Z') });
  assert.deepEqual(first, { version: '0.1.1', tag: 'relay-v0.1.1', skip: false, digest: '' });
  assert.deepEqual(first, retry);
  assert.equal(client.calls.filter(([path]) => path === '/git/refs').length, 1);
});

test('首次分配版本先创建 GHCR 包，准备阶段不请求尚不存在的镜像', async () => {
  const client = gitFixture();
  const plan = await prepareRelay(client, { base: '0.1.0', sha: sourceSha, now: date,
    readImage: async () => { throw new Error('first package is not created yet'); } });
  assert.equal(plan.digest, '');
  assert.equal(plan.skip, false);
});

test('已发布的完整双架构镜像复用 digest，继续处理可能失败的 latest 晋升', async () => {
  const client = gitFixture([gitTag('relay-v0.1.2026111101', sourceSha)]);
  const plan = await prepareRelay(client, { base: '0.1.0', sha: sourceSha, now: date, readImage: async () => imageRecord });
  assert.equal(plan.digest, imageDigest);
  assert.equal(plan.skip, false);
  assert.equal(client.calls.length, 0);
});

for (const change of [{ revision: nextSha }, { digest: 'invalid' }, { version: 'relay-v0.1.2026111102' }, { platforms: ['amd64'] }]) {
  test('现有版本的提交、digest 或架构不符时拒绝覆盖 ' + JSON.stringify(change), async () => {
    const client = gitFixture([gitTag('relay-v0.1.2026111101', sourceSha)]);
    await assert.rejects(prepareRelay(client, { base: '0.1.0', sha: sourceSha, now: date,
      readImage: async () => ({ ...imageRecord, ...change }) }), /同一提交及完整双架构/);
  });
}

test('旧提交完整重跑被新 relay 版本覆盖时跳过', async () => {
  const client = gitFixture([gitTag('relay-v0.1.2026111101', sourceSha), gitTag('relay-v0.1.2026111102')]);
  const plan = await prepareRelay(client, { base: '0.1.0', sha: sourceSha, now: date, readImage: async () => { throw new Error('unexpected'); } });
  assert.equal(plan.skip, true);
  assert.equal(client.calls.length, 0);
});

for (const comparison of ['behind', 'diverged']) {
  test('relay 旧提交尚未分配版本时跳过：' + comparison, async () => {
    const client = gitFixture([gitTag('relay-v0.1.2026111001')], comparison);
    const plan = await prepareRelay(client, { base: '0.1.0', sha: sourceSha, now: date, readImage: async () => undefined });
    assert.equal(plan.skip, true);
    assert.equal(client.calls.some(([path]) => path === '/git/refs'), false);
  });
}

test('递增镜像版本高于日期版本，旧任务重跑保留 latest', () => {
  assert.equal(shouldPromote('relay-v0.1.1', 'relay-v0.1.2026111201'), true);
  assert.equal(shouldPromote('relay-v0.1.2026111102', 'relay-v0.1.2026111101'), true);
  assert.equal(shouldPromote('relay-v0.1.2026111101', 'relay-v0.1.2026111102'), false);
  assert.equal(shouldPromote('relay-v0.1.2026111101', 'relay-v0.1.1'), false);
  assert.equal(shouldPromote('relay-v0.1.2026111101', 'relay-v0.1.2026111101'), false);
});

test('relay CI 同步 Cargo 版本并保留其他依赖', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'tandem-relay-stamp-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'relay'));
  await writeFile(join(directory, 'relay/Cargo.toml'), '[package]\nname = "tandem-relay"\nversion = "0.1.0"\n[dependencies]\nserde = "1"\n');
  await writeFile(join(directory, 'relay/Cargo.lock'), 'version = 4\n\n[[package]]\nname = "tandem-relay"\nversion = "0.1.0"\n');
  await stampRelay('0.1.2', directory);
  assert.equal((await relaySource(directory)).version, '0.1.2');
  assert.match(await readFile(join(directory, 'relay/Cargo.toml'), 'utf8'), /serde = "1"/);
  await assert.rejects(stampRelay('0.1.2026022901', directory), /格式错误/);
});

test('GHCR 查询带回多架构 digest、版本和源码提交', async (t) => {
  registry(t, [
    [200, { token: 'fixture' }],
    [200, { manifests: [
      { platform: { os: 'linux', architecture: 'amd64' }, digest: 'manifest' },
      { platform: { os: 'linux', architecture: 'arm64' }, digest: 'arm' },
    ] }, { 'docker-content-digest': imageDigest }],
    [200, { config: { digest: 'config' } }],
    [200, { config: { Labels: { 'org.opencontainers.image.version': imageRecord.version, 'org.opencontainers.image.revision': sourceSha } } }],
  ]);
  assert.deepEqual(await registryImage({ ...credentials, reference: imageRecord.version }), imageRecord);
});

test('relay Release 不抢桌面的 Latest，重跑保留已有说明', async () => {
  const sha = 'c'.repeat(40);
  const created = [];
  let existing;
  const client = {
    request: async (path, options = {}) => {
      if (path === '/releases/tags/relay-v0.1.2') return existing;
      assert.equal(path, '/releases');
      created.push(options.json);
      return { html_url: 'https://example.test/relay', ...options.json };
    },
  };
  await publishRelayRelease(client, { tag: 'relay-v0.1.2', sha, body: 'notes', log: () => {} });
  assert.equal(created.length, 1);
  assert.equal(created[0].make_latest, 'false');
  assert.equal('target_commitish' in created[0], false);
  assert.equal(created[0].name, 'Tandem Relay v0.1.2');
  existing = { html_url: 'https://example.test/old' };
  assert.equal((await publishRelayRelease(client, { tag: 'relay-v0.1.2', sha, body: 'new', log: () => {} })).html_url, 'https://example.test/old');
  assert.equal(created.length, 1);
  await assert.rejects(publishRelayRelease(client, { tag: 'v0.1.2', sha, body: 'x', log: () => {} }), /格式错误/);
});

test('relay 说明给出带版本的拉取命令和部署文档', () => {
  const { zh, en } = pullNotes('relay-v0.1.2', 'ghcr.io/mingzaily/tandem-relay', 'mingzaily/tandem');
  for (const text of [zh, en]) {
    assert.match(text, /docker pull ghcr\.io\/mingzaily\/tandem-relay:v0\.1\.2\n/);
    assert.match(text, /blob\/relay-v0\.1\.2\/relay\/README\.md/);
  }
});

test('镜像标签用 vX.Y.Z，latest 晋升兼容 relay-v 和无前缀的旧格式', async () => {
  assert.equal(imageVersion('v0.1.3').version, '0.1.3');
  assert.equal(imageVersion('0.1.2').version, '0.1.2');
  assert.equal(imageVersion('relay-v0.1.1').version, '0.1.1');
  assert.equal(imageVersion('vv0.1.1'), undefined);
  assert.equal(shouldPromote('relay-v0.1.4', 'v0.1.3'), true);
  assert.equal(shouldPromote('relay-v0.1.3', 'v0.1.3'), false);
  assert.equal(shouldPromote('relay-v0.1.2', 'relay-v0.1.1'), true);
  assert.equal(shouldPromote('relay-v0.1.3', '0.1.2'), true);
  assert.equal(shouldPromote('relay-v0.1.2', '0.1.2'), false);
  const reads = [];
  const client = gitFixture([gitTag('relay-v0.1.1', sourceSha)]);
  const plan = await prepareRelay(client, {
    base: '0.1.0', sha: sourceSha, now: date,
    readImage: async (reference) => { reads.push(reference); return { ...imageRecord, version: 'v0.1.1' }; },
  });
  assert.deepEqual(reads, ['v0.1.1']);
  assert.equal(plan.digest, imageDigest);
});
