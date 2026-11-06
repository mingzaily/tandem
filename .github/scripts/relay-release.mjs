import { pathToFileURL } from 'node:url';
import { run } from './run.mjs';

export function stableVersion(tag) {
  const match = /^relay-v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(tag);
  return match?.slice(1).map(BigInt);
}

export function shouldPromote(candidate, current) {
  const next = stableVersion(candidate);
  if (!next) return false;
  if (current === undefined) return true;
  const previous = stableVersion(current);
  if (!previous) throw new Error(`latest 的版本标签 ${current} 不是正式 relay-vX.Y.Z，请先核对仓库中的 latest 镜像`);
  for (let index = 0; index < next.length; index++) {
    if (next[index] !== previous[index]) return next[index] > previous[index];
  }
  return false;
}

export async function latestVersion({ image, username, password }) {
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
    if (!response.ok) throw new Error(`读取 GHCR latest 失败：HTTP ${response.status}`);
    return response.json();
  };
  const response = await request('manifests/latest');
  if (response.status === 404) return undefined;
  let manifest = await json(response);
  if (manifest.manifests) {
    const linux = manifest.manifests.find(({ platform }) => platform.os === 'linux' && platform.architecture === 'amd64');
    if (!linux) throw new Error('GHCR latest 缺少 linux/amd64 镜像，需核对已发布产物');
    manifest = await json(await request(`manifests/${linux.digest}`));
  }
  const config = await json(await request(`blobs/${manifest.config.digest}`));
  const version = config.config.Labels?.['org.opencontainers.image.version'];
  if (!version) throw new Error('GHCR latest 缺少版本标签，需核对已发布产物');
  return version;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const tag = process.env.RELAY_TAG;
  if (!stableVersion(tag)) {
    console.info('本次构建保留版本／SHA 标签，latest 只晋升正式 relay-vX.Y.Z。');
  } else {
    const image = process.env.RELAY_IMAGE;
    const current = await latestVersion({ image, username: process.env.REGISTRY_USER, password: process.env.REGISTRY_PASSWORD });
    if (shouldPromote(tag, current)) {
      if (!process.argv.includes('--publish')) throw new Error('晋升 latest 需要显式传入 --publish');
      await run('docker', ['buildx', 'imagetools', 'create', '--tag', `${image}:latest`, `${image}@${process.env.RELAY_DIGEST}`]);
      console.info(`latest 已晋升到 ${tag}`);
    } else {
      console.info(`latest 保持 ${current}，跳过 ${tag}`);
    }
  }
}
