import assert from 'node:assert/strict';
import test from 'node:test';
import { changeNotes, commitSubjects, releaseBody } from './release-notes.mjs';

const sha = 'a'.repeat(40);
const commit = (id, message) => ({ sha: id, commit: { message } });

test('按路径筛选只保留改动这些目录的提交', async () => {
  const requests = [];
  const client = {
    request: async (path) => {
      requests.push(path);
      if (path.startsWith('/compare/')) return { status: 'ahead', commits: [commit('1', 'Relay change'), commit('2', 'Desktop only'), commit('3', 'Phone change')] };
      if (path.includes('path=relay')) return [{ sha: '1' }];
      if (path.includes('path=pwa')) return [{ sha: '3' }];
      throw new Error(path);
    },
  };
  const logs = [];
  const subjects = await commitSubjects(client, { previous: 'relay-v0.1.1', sha, paths: ['relay', 'pwa'], log: (line) => logs.push(line) });
  assert.deepEqual(subjects, ['Relay change', 'Phone change']);
  assert.match(logs[0], /relay-v0\.1\.1\.\.\.aaaaaaa，共 2 条提交，只算改动 relay、pwa 的提交/);
  assert.ok(requests.includes(`/commits?sha=${sha}&path=relay&per_page=100`));
});

test('没有上一个标签时只取本次提交，并写明原因', async () => {
  const logs = [];
  const client = { request: async () => ({ commit: { message: 'Only change\n\nbody' } }) };
  assert.deepEqual(await commitSubjects(client, { sha, log: (line) => logs.push(line) }), ['Only change']);
  assert.match(logs[0], /没有上一个版本标签/);
});

test('日志记录请求、状态、用时和来源，不含地址、密钥和模型名', async () => {
  const logs = [];
  const llm = { url: 'https://notes.example.test/v1/chat/completions', key: 'notes-secret', model: 'secret-model' };
  let calls = 0;
  const notes = await changeNotes({
    subjects: ['Add a thing'], llm, log: (line) => logs.push(line),
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({ choices: [{ message: { content: calls === 1 ? '### Features\n\n- A thing.' : '### 新功能\n\n- 一个功能。' } }] }));
    },
  });
  assert.equal(notes.source, 'model');
  assert.ok(logs.some((line) => /英文说明：HTTP 200，用时 \d+ ms/.test(line)));
  assert.ok(logs.some((line) => /中文翻译：收到 \d+ 字/.test(line)));
  assert.equal(logs.at(-1), '更新说明：由模型生成');
  assert.equal(logs.some((line) => /notes-secret|notes\.example|secret-model/.test(line)), false);
});

test('失败时日志写明原因，正文退回提交标题', async () => {
  const logs = [];
  const notes = await changeNotes({
    subjects: ['Add a thing'], log: (line) => logs.push(line),
    llm: { url: 'https://notes.example.test/v1', key: 'k', model: 'm' },
    fetchImpl: async () => new Response('', { status: 403 }),
  });
  assert.deepEqual([notes.zh, notes.en, notes.reason], ['- Add a thing', '- Add a thing', '接口返回 HTTP 403']);
  assert.equal(logs.at(-1), '更新说明：使用提交标题（接口返回 HTTP 403）');
});

test('正文中文在前，英文折叠在 details 里', () => {
  const body = releaseBody({ zh: '- 中文', en: '- English', zhAfter: '## 下载', enAfter: '## Download' });
  assert.equal(body, '## 更新内容\n\n- 中文\n\n## 下载\n\n<details>\n<summary>English</summary>\n\n## What\'s new\n\n- English\n\n## Download\n\n</details>');
});
