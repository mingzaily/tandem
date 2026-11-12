function parseVersion(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  if (!match) return undefined;
  const [, major, minor, patchText] = match;
  if (patchText.length >= 7) {
    const date = /^(20\d{6})(0[1-9]|[1-9]\d)$/.exec(patchText);
    if (!date) return undefined;
    const iso = `${date[1].slice(0, 4)}-${date[1].slice(4, 6)}-${date[1].slice(6, 8)}`;
    const parsed = new Date(`${iso}T00:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) return undefined;
    return { version, major, minor, patch: Number(patchText), kind: 'date' };
  }
  return { version, major, minor, patch: Number(patchText), kind: 'sequence' };
}

export function releaseVersion(tag, prefix = 'v') {
  if (!tag.startsWith(prefix)) return undefined;
  return parseVersion(tag.slice(prefix.length));
}

export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) throw new Error(`版本格式错误：${left}，${right}`);
  if (a.major !== b.major) return BigInt(a.major) > BigInt(b.major) ? 1 : -1;
  if (a.minor !== b.minor) return BigInt(a.minor) > BigInt(b.minor) ? 1 : -1;
  if (a.kind !== b.kind) return a.kind === 'sequence' ? 1 : -1;
  return a.patch === b.patch ? 0 : a.patch > b.patch ? 1 : -1;
}

export function nextVersion(base, tags, sha, prefix = 'v') {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.0$/.test(base)) {
    throw new Error('源码版本使用 major.minor.0，CI 自动生成递增发布号');
  }
  const [major, minor] = base.split('.');
  const versions = tags.map((tag) => ({ ...releaseVersion(tag.name, prefix), sha: tag.commit.sha }))
    .filter((tag) => tag.version && tag.major === major && tag.minor === minor);
  const existing = versions.find((tag) => tag.sha === sha);
  if (existing) return existing.version;
  const patch = Math.max(0, ...versions.filter((tag) => tag.kind === 'sequence').map((tag) => tag.patch)) + 1;
  return `${major}.${minor}.${patch}`;
}

export async function reserveTag(client, name, commit) {
  const annotated = await client.request('/git/tags', {
    method: 'POST',
    json: {
      tag: name, message: name, object: commit, type: 'commit',
      tagger: {
        name: 'Tandem Release', email: 'noreply@users.noreply.github.com',
        date: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      },
    },
  });
  if (!annotated?.sha) throw new Error(`附注 tag 没有返回对象：${name}`);
  await client.request('/git/refs', { method: 'POST', json: { ref: `refs/tags/${name}`, sha: annotated.sha } });
}

export function githubClient({ repository, token, apiUrl = 'https://api.github.com', fetchImpl = fetch }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !token) throw new Error('发布需要 GITHUB_REPOSITORY 和 GH_TOKEN');
  const prefix = `/repos/${repository}`;
  async function request(path, { method = 'GET', json, data, optional = false } = {}) {
    const url = /^https?:\/\//.test(path) ? path : apiUrl + prefix + path;
    const response = await fetchImpl(url, {
      method, redirect: 'error', signal: AbortSignal.timeout(120000),
      headers: {
        Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(json ? { 'Content-Type': 'application/json' } : {}),
        ...(data ? { 'Content-Type': 'application/octet-stream' } : {}),
      },
      body: json ? JSON.stringify(json) : data,
    });
    if (response.status === 404 && optional) return undefined;
    if (!response.ok) throw new Error(`GitHub ${method} 请求失败：HTTP ${response.status}`);
    return response.status === 204 ? undefined : response.json();
  }
  async function list(path) {
    const items = [];
    for (let page = 1; ; page++) {
      const batch = await request(`${path}?per_page=100&page=${page}`);
      items.push(...batch);
      if (batch.length < 100) return items;
    }
  }
  return { request, list, repository };
}

