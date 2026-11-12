import { createHash } from 'node:crypto';
import { appendFile, realpath, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { root } from './run.mjs';

import { compareVersions, githubClient, nextVersion, releaseVersion, reserveTag } from './release-version.mjs';

const cargoVersion = /(^\[package\][\s\S]*?\nversion = ")([^"]+)(")/m;
const lockVersion = /(^\[\[package\]\]\nname = "tandem"\nversion = ")([^"]+)(")/m;

export async function sourceVersions(directory = root) {
  const names = ['desktop/package.json', 'desktop/src-tauri/tauri.conf.json', 'desktop/src-tauri/Cargo.toml', 'desktop/src-tauri/Cargo.lock'];
  const files = await Promise.all(names.map(async (name) => ({ name, text: await readFile(resolve(directory, name), 'utf8') })));
  const versions = [JSON.parse(files[0].text).version, JSON.parse(files[1].text).version,
    cargoVersion.exec(files[2].text)?.[2], lockVersion.exec(files[3].text)?.[2]];
  if (versions.some((version) => !version || version !== versions[0])) {
    throw new Error(`桌面版本需要一致：${names.map((name, i) => `${name}=${versions[i] ?? '缺失'}`).join('，')}`);
  }
  return { version: versions[0], files };
}

export async function stampVersion(version, directory = root) {
  if (!releaseVersion(`v${version}`)) throw new Error(`日期发布版本格式错误：${version}`);
  const { files } = await sourceVersions(directory);
  const contents = [
    ...files.slice(0, 2).map((file) => JSON.stringify({ ...JSON.parse(file.text), version }, null, 2) + '\n'),
    files[2].text.replace(cargoVersion, (_, before, previous, after) => before + version + after),
    files[3].text.replace(lockVersion, (_, before, previous, after) => before + version + after),
  ];
  for (let i = 0; i < files.length; i++) await writeFile(resolve(directory, files[i].name), contents[i]);
}

function newestRelease(releases) {
  return releases.filter((release) => !release.draft && !release.prerelease && releaseVersion(release.tag_name))
    .sort((a, b) => compareVersions(b.tag_name.slice(1), a.tag_name.slice(1)))[0];
}

function subjectOf(message = '') {
  const subject = message.split('\n', 1)[0].trim();
  return subject && !subject.startsWith('Merge ') ? subject : '';
}

export async function releaseSubjects(client, { version, sha }) {
  if (!releaseVersion(`v${version}`)) throw new Error(`发布版本格式错误：${version}`);
  const tags = await client.list('/tags');
  const previous = tags
    .map((item) => ({ name: item.name, version: releaseVersion(item.name)?.version }))
    .filter((item) => item.version && compareVersions(item.version, version) < 0)
    .sort((left, right) => compareVersions(right.version, left.version))[0];
  if (!previous) return [subjectOf((await client.request(`/commits/${sha}`)).commit.message)].filter(Boolean);
  const comparison = await client.request(`/compare/${previous.name}...${sha}`);
  const subjects = (comparison.commits ?? [])
    .map((item) => subjectOf(item.commit?.message))
    .filter(Boolean)
    .slice(0, 100);
  if (subjects.length || comparison.status === 'identical') return subjects;
  return [subjectOf((await client.request(`/commits/${sha}`)).commit.message)].filter(Boolean);
}

export function commitChangelog(subjects) {
  if (!subjects.length) return '这一版发布安装包。';
  return `这一版的提交：\n\n${subjects.map((subject) => `- ${subject}`).join('\n')}`;
}

export function englishCommitChangelog(subjects) {
  if (!subjects.length) return 'This release publishes the desktop packages.';
  return `Changes in this release:\n\n${subjects.map((subject) => `- ${subject}`).join('\n')}`;
}

export function installNote(version, sha) {
  return `macOS 安装包分为 Apple Silicon 和 Intel。\n\n版本：${version}\n源码提交：${sha}\n\n使用 Tandem 自签名证书签名，未经过 Apple 公证。首次打开如被系统拦截，请在“系统设置 → 隐私与安全性”中允许打开。\n\n下载后可使用 SHA256SUMS 核对安装包。`;
}

export function englishInstallNote(version, sha) {
  return `Separate macOS packages for Apple Silicon and Intel.\n\nVersion: ${version}\nCommit: ${sha}\n\nThe app is signed with a Tandem self-signed certificate and not notarized. If macOS blocks the first open, allow it in System Settings → Privacy & Security.\n\nCheck the downloads with SHA256SUMS.`;
}

function changelogText(text, key) {
  const changelog = String(text ?? '').trim().replace(/^```(?:markdown)?\s*/i, '').replace(/\s*```$/, '').trim();
  if (!changelog || changelog.length > 12000 || changelog.includes(key)) return undefined;
  return changelog;
}

async function chatCompletion(endpoint, { key, model, prompt, fetchImpl }) {
  const response = await fetchImpl(endpoint, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60000),
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!response.ok) return undefined;
  const payload = await response.json();
  return changelogText(payload?.choices?.[0]?.message?.content, key);
}

export async function modelChangelog(subjects, { url = '', key = '', model = '', fetchImpl = fetch } = {}) {
  if (!subjects.length || !url || !key || !model) return undefined;
  let endpoint;
  try {
    endpoint = new URL(url);
  } catch {
    return undefined;
  }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) return undefined;
  try {
    const english = await chatCompletion(endpoint, {
      key, model, fetchImpl,
      prompt: `Based on these git commit subjects, write concise user-facing release notes in markdown. Group them as Features, Bug Fixes, and Improvements, and omit empty groups. Keep only changes a desktop user can notice. Skip dependency bumps, formatting, and docs-only commits. One sentence per item. Output only the notes, without a preamble or install instructions.\n\nCommit subjects:\n${subjects.join('\n')}`,
    });
    if (!english) return undefined;
    let chinese;
    try {
      chinese = await chatCompletion(endpoint, {
        key, model, fetchImpl,
        prompt: `把下面的发布说明译成简体中文。保留 markdown 结构、标题层级、链接、代码和产品名 Tandem。只输出译文，不要前言。\n\n${english}`,
      });
    } catch {
      chinese = undefined;
    }
    return chinese ? { english, chinese } : { english };
  } catch {
    return undefined;
  }
}

export async function composeReleaseBody({ subjects, version, sha, llm, fetchImpl }) {
  const generated = await modelChangelog(subjects, { ...llm, fetchImpl });
  const english = generated?.english ?? englishCommitChangelog(subjects);
  const chinese = generated?.chinese ?? commitChangelog(subjects);
  return {
    body: `${english}\n\n${englishInstallNote(version, sha)}\n\n<!-- lang:zh -->\n\n${chinese}\n\n${installNote(version, sha)}`,
    source: generated?.english ? 'model' : 'commits',
  };
}

export async function prepareRelease(client, { base, sha }) {
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('发布需要完整的提交 SHA');
  const tags = await client.list('/tags');
  const version = nextVersion(base, tags, sha);
  const tag = `v${version}`;
  const newest = newestRelease(await client.list('/releases'));
  if (newest && compareVersions(newest.tag_name.slice(1), version) >= 0) {
    return { version, tag, skip: true };
  }
  if (newest) {
    const comparison = await client.request(`/compare/${newest.tag_name}...${sha}`);
    if (!['ahead', 'identical'].includes(comparison.status)) return { version, tag, skip: true };
  }
  if (!tags.some((item) => item.name === tag)) await reserveTag(client, tag, sha);
  return { version, tag, skip: false };
}

export async function publishRelease(client, { version, sha, directory, repository = client.repository, now = new Date(), body = installNote(version, sha) }) {
  if (!releaseVersion(`v${version}`)) throw new Error(`发布版本格式错误：${version}`);
  const tag = `v${version}`;
  const architectures = [['aarch64', 'darwin-aarch64'], ['x64', 'darwin-x86_64']];
  const expected = architectures.map(([arch]) => `Tandem_${version}_${arch}.dmg`);
  const names = (await readdir(directory)).filter((name) => name.endsWith('.dmg'));
  if (names.length !== expected.length || expected.some((name) => !names.includes(name))) {
    throw new Error(`发布目录需要且只允许 ${expected.join('、')}`);
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '')) throw new Error('发布需要有效的 GitHub 仓库地址');
  const platforms = {};
  const artifacts = [];
  for (const [arch, platform] of architectures) {
    const dmgName = `Tandem_${version}_${arch}.dmg`;
    const archiveName = `Tandem_${arch}.app.tar.gz`;
    const dmg = await readFile(resolve(directory, dmgName));
    const archive = await readFile(resolve(directory, archiveName));
    const signature = (await readFile(resolve(directory, `${archiveName}.sig`), 'utf8')).trim();
    if (!dmg.length || !archive.length || !signature) throw new Error(`${arch} 安装包、更新包和签名需要完整生成`);
    platforms[platform] = {
      signature, url: `https://github.com/${repository}/releases/download/${tag}/${archiveName}`,
    };
    artifacts.push(
      { name: dmgName, data: dmg }, { name: archiveName, data: archive },
      { name: `${archiveName}.sig`, data: Buffer.from(`${signature}\n`) },
    );
  }
  const manifest = { version, pub_date: now.toISOString(), notes: `Tandem ${version}`, platforms };
  artifacts.push({ name: 'latest.json', data: Buffer.from(JSON.stringify(manifest, null, 2) + '\n') });
  const checksum = artifacts.map(({ name, data }) => `${createHash('sha256').update(data).digest('hex')}  ${name}\n`).join('');
  const assets = [...artifacts, { name: 'SHA256SUMS', data: Buffer.from(checksum) }];
  let release = await client.request(`/releases/tags/${tag}`, { optional: true });
  if (release && !release.draft) {
    if (!assets.every((asset) => release.assets.some((existing) => existing.name === asset.name))) {
      throw new Error('已发布版本的产物清单不完整，请核对该 Release');
    }
    return release;
  }
  if (!release) {
    release = await client.request('/releases', {
      method: 'POST', json: {
        tag_name: tag, target_commitish: sha, name: `Tandem ${tag}`, draft: true, prerelease: false,
        generate_release_notes: false, body,
      },
    });
  }
  for (const asset of assets) {
    const existing = release.assets.find((item) => item.name === asset.name);
    if (existing) await client.request(`/releases/assets/${existing.id}`, { method: 'DELETE' });
    const upload = new URL(release.upload_url.split('{')[0]);
    upload.searchParams.set('name', asset.name);
    await client.request(upload.href, { method: 'POST', data: asset.data });
  }
  const newest = newestRelease(await client.list('/releases'));
  const latest = !newest || compareVersions(version, newest.tag_name.slice(1)) > 0;
  return client.request(`/releases/${release.id}`, {
    method: 'PATCH', json: { draft: false, make_latest: String(latest), body },
  });
}

async function main() {
  const [command, argument] = process.argv.slice(2);
  if (command === 'check') {
    console.info(`桌面源码版本一致：${(await sourceVersions()).version}`);
    return;
  }
  if (command === 'stamp') {
    await stampVersion(argument);
    console.info(`CI 构建版本：${argument}`);
    return;
  }
  if (!['prepare', 'publish'].includes(command)) throw new Error('用法：desktop-release.mjs check | stamp <version> | prepare | publish <产物目录>');
  if (process.env.GITHUB_REF !== 'refs/heads/main') throw new Error('桌面发布只接受 main 分支');
  const client = githubClient({ repository: process.env.GITHUB_REPOSITORY, token: process.env.GH_TOKEN,
    apiUrl: process.env.GITHUB_API_URL });
  if (command === 'prepare') {
    const { version: base } = await sourceVersions();
    const plan = await prepareRelease(client, { base, sha: process.env.GITHUB_SHA });
    await appendFile(process.env.GITHUB_OUTPUT, Object.entries(plan).map(([key, value]) => `${key}=${value}\n`).join(''));
    console.info(plan.skip ? `跳过已发布或已被新版本覆盖的提交：${plan.tag}` : `已分配构建版本：${plan.tag}`);
  } else {
    const version = process.env.DESKTOP_VERSION;
    const sha = process.env.GITHUB_SHA;
    const subjects = await releaseSubjects(client, { version, sha });
    const notes = await composeReleaseBody({
      subjects, version, sha,
      llm: {
        url: process.env.TANDEM_RELEASE_NOTES_API_URL,
        key: process.env.TANDEM_RELEASE_NOTES_API_KEY,
        model: process.env.TANDEM_RELEASE_NOTES_MODEL,
      },
    });
    console.info(notes.source === 'model' ? '发布说明由模型生成' : '发布说明使用提交标题');
    const release = await publishRelease(client, { version, sha, directory: resolve(argument), body: notes.body });
    console.info(`桌面版本已发布：${release.html_url}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(await realpath(process.argv[1])).href) await main();
