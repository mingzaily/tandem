import { appendFile, realpath, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { root, run } from './run.mjs';
import { compareVersions, githubClient, nextVersion, releaseVersion, reserveTag } from './release-version.mjs';
import { changeNotes, commitSubjects, releaseBody } from './release-notes.mjs';

/** Only these folders go into the relay image, so only their commits describe a relay release. */
const RELAY_PATHS = ['relay', 'pwa'];

export function stableVersion(tag) {
  return releaseVersion(tag, 'relay-v');
}

export function shouldPromote(candidate, current) {
  const next = stableVersion(candidate);
  if (!next) return false;
  if (current === undefined) return true;
  const previous = stableVersion(current);
  if (!previous) throw new Error(`latest 的版本标签 ${current} 不是正式 relay-vX.Y.Z，请先核对仓库中的 latest 镜像`);
  return compareVersions(next.version, previous.version) > 0;
}

export async function registryImage({ image, reference, username, password }) {
  if (!/^ghcr\.io\/[\w.-]+\/[\w.-]+$/.test(image) || !/^[\w.:-]+$/.test(reference)) {
    throw new Error('镜像需要使用 GHCR 仓库及有效标签');
  }
  const repository = image.slice('ghcr.io/'.length);
  const auth = await fetch(`https://ghcr.io/token?service=ghcr.io&scope=${encodeURIComponent(`repository:${repository}:pull`)}`, {
    headers: { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` },
  });
  if (!auth.ok) throw new Error(`GHCR 准入失败：HTTP ${auth.status}`);
  const { token } = await auth.json();
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json',
  };
  const request = (path) => fetch(`https://ghcr.io/v2/${repository}/${path}`, { headers });
  const json = async (response) => {
    if (!response.ok) throw new Error(`读取 GHCR ${reference} 失败：HTTP ${response.status}`);
    return response.json();
  };
  const response = await request(`manifests/${reference}`);
  if (response.status === 404) return undefined;
  const digest = response.headers.get('docker-content-digest');
  let manifest = await json(response);
  const platforms = manifest.manifests?.filter(({ platform }) => platform?.os === 'linux').map(({ platform }) => platform.architecture) ?? [];
  if (manifest.manifests) {
    const linux = manifest.manifests.find(({ platform }) => platform?.os === 'linux' && platform.architecture === 'amd64');
    if (!linux) throw new Error(`GHCR ${reference} 缺少 linux/amd64 镜像，需核对已发布产物`);
    manifest = await json(await request(`manifests/${linux.digest}`));
  }
  const config = await json(await request(`blobs/${manifest.config.digest}`));
  const version = config.config.Labels?.['org.opencontainers.image.version'];
  if (!version) throw new Error(`GHCR ${reference} 缺少版本标签，需核对已发布产物`);
  return { version, digest, revision: config.config.Labels?.['org.opencontainers.image.revision'], platforms };
}

export async function latestVersion(credentials) {
  return (await registryImage({ ...credentials, reference: 'latest' }))?.version;
}

export async function prepareRelay(client, { base, sha, readImage }) {
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('发布需要完整的提交 SHA');
  const tags = await client.list('/tags');
  const version = nextVersion(base, tags, sha, 'relay-v');
  const tag = `relay-v${version}`;
  const newest = tags.filter((item) => releaseVersion(item.name, 'relay-v'))
    .sort((a, b) => compareVersions(b.name.slice(7), a.name.slice(7)))[0];
  if (newest && compareVersions(newest.name.slice(7), version) > 0) return { version, tag, skip: true, digest: '' };
  if (newest && newest.commit.sha !== sha) {
    const comparison = await client.request(`/compare/${newest.name}...${sha}`);
    if (!['ahead', 'identical'].includes(comparison.status)) return { version, tag, skip: true, digest: '' };
  }
  const reserved = tags.some((item) => item.name === tag);
  if (!reserved) await reserveTag(client, tag, sha);
  // A fresh reservation has no published image. This also allows the first
  // release to create its GHCR package before requesting pull access to it.
  const image = reserved ? await readImage(tag) : undefined;
  if (image && (image.version !== tag || image.revision !== sha || !/^sha256:[a-f0-9]{64}$/.test(image.digest ?? '')
      || !['amd64', 'arm64'].every((architecture) => image.platforms.includes(architecture)))) {
    throw new Error('已存在的 relay 版本需要对应同一提交及完整双架构镜像');
  }
  return { version, tag, skip: false, digest: image?.digest ?? '' };
}

export function pullNotes(tag, image, repository) {
  const pull = `\`\`\`bash\ndocker pull ${image}:${tag}\n\`\`\``;
  const readme = `https://github.com/${repository}/blob/${tag}/relay/README.md`;
  return {
    zh: `## 镜像\n\n${pull}\n\n同时提供 amd64 和 arm64，\`latest\` 只指向最新的正式版本。部署和升级见 [relay/README.md](${readme})。`,
    en: `## Image\n\n${pull}\n\nBuilt for amd64 and arm64; \`latest\` points at the newest stable release. See [relay/README.md](${readme}) to deploy or upgrade.`,
  };
}

/**
 * A GitHub Release for the relay tag, so the tag page says what changed and how to pull it. It is
 * never marked Latest: the desktop updater reads the latest release's manifest.
 */
export async function publishRelayRelease(client, { tag, sha, body, log = console.info }) {
  if (!stableVersion(tag)) throw new Error(`relay 发布版本格式错误：${tag}`);
  const existing = await client.request(`/releases/tags/${tag}`, { optional: true });
  if (existing) {
    log(`relay Release 已存在，保持原说明：${existing.html_url}`);
    return existing;
  }
  return client.request('/releases', {
    method: 'POST', json: {
      tag_name: tag, target_commitish: sha, name: `Tandem Relay ${tag.slice('relay-'.length)}`, body,
      draft: false, prerelease: false, make_latest: 'false', generate_release_notes: false,
    },
  });
}

export async function relaySubjects(client, { tag, sha, log = console.info }) {
  const current = stableVersion(tag);
  const tags = await client.list('/tags');
  const previous = tags
    .map((item) => ({ name: item.name, version: stableVersion(item.name)?.version }))
    .filter((item) => item.version && compareVersions(item.version, current.version) < 0)
    .sort((left, right) => compareVersions(right.version, left.version))[0];
  return commitSubjects(client, { previous: previous?.name, sha, paths: RELAY_PATHS, log });
}

const cargoVersion = /(^\[package\][\s\S]*?\nversion = ")([^"]+)(")/m;
const lockVersion = /(^\[\[package\]\]\nname = "tandem-relay"\nversion = ")([^"]+)(")/m;
export async function relaySource(directory = root) {
  const files = await Promise.all(['relay/Cargo.toml', 'relay/Cargo.lock'].map(async (name) => ({
    path: `${directory}/${name}`, text: await readFile(`${directory}/${name}`, 'utf8'),
  })));
  const version = cargoVersion.exec(files[0].text)?.[2];
  if (!version || lockVersion.exec(files[1].text)?.[2] !== version) throw new Error('relay 的 Cargo.toml 与 Cargo.lock 版本需要一致');
  return { version, files };
}
export async function stampRelay(version, directory = root) {
  if (!releaseVersion(`relay-v${version}`, 'relay-v')) throw new Error('relay 发布版本格式错误');
  const { files } = await relaySource(directory);
  for (const [index, file] of files.entries()) {
    await writeFile(file.path, file.text.replace(index ? lockVersion : cargoVersion,
      (_, before, previous, after) => before + version + after));
  }
}

async function main() {
  const [command, argument] = process.argv.slice(2);
  if (command === 'stamp') { await stampRelay(argument); return; }
  const credentials = { image: process.env.RELAY_IMAGE, username: process.env.REGISTRY_USER, password: process.env.REGISTRY_PASSWORD };
  if (command === 'prepare') {
    if (process.env.GITHUB_REF !== 'refs/heads/main') throw new Error('relay 自动发布只接受 main 分支');
    const client = githubClient({ repository: process.env.GITHUB_REPOSITORY, token: process.env.GH_TOKEN,
      apiUrl: process.env.GITHUB_API_URL });
    const { version: base } = await relaySource();
    const plan = await prepareRelay(client, { base, sha: process.env.GITHUB_SHA,
      readImage: (reference) => registryImage({ ...credentials, reference }) });
    await appendFile(process.env.GITHUB_OUTPUT, Object.entries(plan).map(([key, value]) => `${key}=${value}\n`).join(''));
    console.info(plan.skip ? `跳过已被新版本覆盖的 relay 提交：${plan.tag}` : `relay 构建版本：${plan.tag}${plan.digest ? '，复用已发布镜像' : ''}`);
    return;
  }
  const tag = process.env.RELAY_TAG;
  if (command === 'release') {
    const client = githubClient({ repository: process.env.GITHUB_REPOSITORY, token: process.env.GH_TOKEN,
      apiUrl: process.env.GITHUB_API_URL });
    const sha = process.env.GITHUB_SHA;
    const subjects = await relaySubjects(client, { tag, sha });
    const notes = await changeNotes({
      subjects, audience: 'relay',
      llm: {
        url: process.env.TANDEM_RELEASE_NOTES_API_URL,
        key: process.env.TANDEM_RELEASE_NOTES_API_KEY,
        model: process.env.TANDEM_RELEASE_NOTES_MODEL,
      },
    });
    const pull = pullNotes(tag, credentials.image, client.repository);
    const release = await publishRelayRelease(client, {
      tag, sha, body: releaseBody({ zh: notes.zh, en: notes.en, zhAfter: pull.zh, enAfter: pull.en }),
    });
    console.info(`relay Release：${release.html_url}`);
    return;
  }
  if (!stableVersion(tag)) {
    console.info('本次构建保留版本／SHA 标签，latest 只晋升正式 relay-vX.Y.Z。');
    return;
  }
  const current = await latestVersion(credentials);
  if (shouldPromote(tag, current)) {
    if (!process.argv.includes('--publish')) throw new Error('晋升 latest 需要显式传入 --publish');
    await run('docker', ['buildx', 'imagetools', 'create', '--tag', `${credentials.image}:latest`, `${credentials.image}@${process.env.RELAY_DIGEST}`]);
    console.info(`latest 已晋升到 ${tag}`);
  } else {
    console.info(`latest 保持 ${current}，跳过 ${tag}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(await realpath(process.argv[1])).href) await main();
