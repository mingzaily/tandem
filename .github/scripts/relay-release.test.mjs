import test from 'node:test';
import assert from 'node:assert/strict';
import { latestVersion, shouldPromote } from './relay-release.mjs';

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
    const [status, body] = responses.shift();
    return new Response(JSON.stringify(body), { status });
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
