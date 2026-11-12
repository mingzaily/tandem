export function releaseVersion(tag, prefix = 'v') {
  if (!tag.startsWith(prefix)) return undefined;
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(20\d{6})(0[1-9]|[1-9]\d)$/.exec(tag.slice(prefix.length));
  if (!match) return undefined;
  const [, major, minor, date, sequence] = match;
  const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) return undefined;
  return { version: tag.slice(prefix.length), major, minor, date, sequence: Number(sequence) };
}

export function compareVersions(left, right) {
  const a = left.split('.').map(BigInt);
  const b = right.split('.').map(BigInt);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  }
  return 0;
}

export function nextVersion(base, tags, sha, now = new Date(), prefix = 'v') {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.0$/.test(base)) {
    throw new Error('源码版本使用 major.minor.0，CI 自动生成日期发布号');
  }
  const [major, minor] = base.split('.');
  const versions = tags.map((tag) => ({ ...releaseVersion(tag.name, prefix), sha: tag.commit.sha }))
    .filter((tag) => tag.version && tag.major === major && tag.minor === minor)
    .sort((a, b) => compareVersions(b.version, a.version));
  const existing = versions.find((tag) => tag.sha === sha);
  if (existing) return existing.version;
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now).replaceAll('-', '');
  if (versions[0]?.date > date) throw new Error('当前北京时间早于已分配版本的日期，请核对运行器时间');
  const sequence = Math.max(0, ...versions.filter((tag) => tag.date === date).map((tag) => tag.sequence)) + 1;
  if (sequence > 99) throw new Error('当日发布序号已达 99，请在次日发布');
  return `${major}.${minor}.${date}${String(sequence).padStart(2, '0')}`;
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

