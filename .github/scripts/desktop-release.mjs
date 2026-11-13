import { appendFile, realpath, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { root } from './run.mjs';

import { compareVersions, githubClient, nextVersion, releaseVersion, reserveTag } from './release-version.mjs';
import { changeNotes, commitSubjects, releaseBody } from './release-notes.mjs';

export { chatEndpoint, modelChangelog } from './release-notes.mjs';

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

export async function releaseSubjects(client, { version, sha, log = console.info }) {
  if (!releaseVersion(`v${version}`)) throw new Error(`发布版本格式错误：${version}`);
  const tags = await client.list('/tags');
  const previous = tags
    .map((item) => ({ name: item.name, version: releaseVersion(item.name)?.version }))
    .filter((item) => item.version && compareVersions(item.version, version) < 0)
    .sort((left, right) => compareVersions(right.version, left.version))[0];
  return commitSubjects(client, { previous: previous?.name, sha, log });
}

/** Which file to take, with direct links; GitHub already shows the tag and commit above. */
export function downloadNotes(version, repository) {
  const link = (arch) => {
    const name = `Tandem_${version}_${arch}.dmg`;
    return `[${name}](https://github.com/${repository}/releases/download/v${version}/${name})`;
  };
  return {
    zh: `## 下载\n\n| 电脑 | 安装包 |\n| --- | --- |\n| Apple 芯片（M 系列） | ${link('aarch64')} |\n| Intel 芯片 | ${link('x64')} |\n\n已安装的 Tandem 会在“设置 → 关于”中收到这次更新。安装包使用 Tandem 自签名证书，未经 Apple 公证；首次打开如被拦截，请在“系统设置 → 隐私与安全性”中允许。`,
    en: `## Download\n\n| Mac | Package |\n| --- | --- |\n| Apple silicon (M series) | ${link('aarch64')} |\n| Intel | ${link('x64')} |\n\nInstalled copies get this update from Settings → About. The app is signed with Tandem's self-signed certificate and not notarized; if macOS blocks the first open, allow it in System Settings → Privacy & Security.`,
  };
}

export async function composeReleaseBody({ subjects, version, llm, fetchImpl, repository, log = console.info }) {
  const notes = await changeNotes({ subjects, llm, fetchImpl, audience: 'desktop', log });
  const download = downloadNotes(version, repository);
  return {
    body: releaseBody({ zh: notes.zh, en: notes.en, zhAfter: download.zh, enAfter: download.en }),
    source: notes.source,
    reason: notes.reason,
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

export async function publishRelease(client, {
  version, directory, repository = client.repository, now = new Date(),
  body = releaseBody({ zh: '没有可列出的改动。', en: 'No listed changes.', zhAfter: downloadNotes(version, repository).zh, enAfter: downloadNotes(version, repository).en }),
}) {
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
  const assets = [];
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
    // The signature lives in latest.json, and GitHub lists a SHA-256 for every asset, so the
    // release carries only what people download and what the updater fetches.
    assets.push({ name: dmgName, data: dmg }, { name: archiveName, data: archive });
  }
  const manifest = { version, pub_date: now.toISOString(), notes: `Tandem ${version}`, platforms };
  assets.push({ name: 'latest.json', data: Buffer.from(JSON.stringify(manifest, null, 2) + '\n') });
  let release = await client.request(`/releases/tags/${tag}`, { optional: true });
  if (release && !release.draft) {
    if (!assets.every((asset) => release.assets.some((existing) => existing.name === asset.name))) {
      throw new Error('已发布版本的产物清单不完整，请核对该 Release');
    }
    return release;
  }
  if (!release) {
    // prepare already reserved the tag. GitHub rejects a commit SHA as target_commitish once that
    // commit is no longer a branch tip, which happens whenever main moves on during the build.
    release = await client.request('/releases', {
      method: 'POST', json: {
        tag_name: tag, name: `Tandem ${tag}`, draft: true, prerelease: false,
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
      subjects, version, repository: client.repository,
      llm: {
        url: process.env.TANDEM_RELEASE_NOTES_API_URL,
        key: process.env.TANDEM_RELEASE_NOTES_API_KEY,
        model: process.env.TANDEM_RELEASE_NOTES_MODEL,
      },
    });
    const release = await publishRelease(client, { version, directory: resolve(argument), body: notes.body });
    console.info(`桌面版本已发布：${release.html_url}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(await realpath(process.argv[1])).href) await main();
