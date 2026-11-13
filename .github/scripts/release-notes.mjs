// Release notes shared by the desktop and relay releases. The body leads with Chinese, keeps
// English folded underneath, and says only what a reader needs: what changed and how to get it.
// Logs say where the notes came from, never the endpoint, the key or the model name.

const MAX_SUBJECTS = 100;

export function subjectOf(message = '') {
  const subject = message.split('\n', 1)[0].trim();
  return subject && !subject.startsWith('Merge ') ? subject : '';
}

/**
 * Commit subjects since `previous` (a tag), newest last. With `paths`, only commits touching one
 * of them count, which keeps desktop-only work out of the relay notes. Without a previous tag the
 * release commit stands alone, since there is nothing to compare with.
 */
export async function commitSubjects(client, { previous, sha, paths, log = console.info }) {
  const head = async () => [subjectOf((await client.request(`/commits/${sha}`)).commit.message)].filter(Boolean);
  if (!previous) {
    log(`更新说明：没有上一个版本标签，只取本次提交 ${sha.slice(0, 7)}`);
    return head();
  }
  const comparison = await client.request(`/compare/${previous}...${sha}`);
  let commits = comparison.commits ?? [];
  if (paths?.length) {
    const touched = new Set();
    for (const path of paths) {
      const listed = await client.request(`/commits?sha=${sha}&path=${encodeURIComponent(path)}&per_page=100`);
      for (const item of listed ?? []) touched.add(item.sha);
    }
    commits = commits.filter((item) => touched.has(item.sha));
  }
  const subjects = commits.map((item) => subjectOf(item.commit?.message)).filter(Boolean).slice(-MAX_SUBJECTS);
  const scope = paths?.length ? `，只算改动 ${paths.join('、')} 的提交` : '';
  log(`更新说明：取自 ${previous}...${sha.slice(0, 7)}，共 ${subjects.length} 条提交${scope}`);
  if (subjects.length || comparison.status === 'identical' || paths?.length) return subjects;
  return head();
}

/** A reason that is safe to log: it never carries the endpoint or the key. */
class NotesFailure extends Error {}

/** OpenAI-compatible services are often configured by their base URL, such as `…/v1`. */
export function chatEndpoint(url) {
  let endpoint;
  try {
    endpoint = new URL(url);
  } catch {
    return undefined;
  }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) return undefined;
  const path = endpoint.pathname.replace(/\/+$/, '');
  if (!path.endsWith('/chat/completions')) endpoint.pathname = `${path}/chat/completions`;
  return endpoint;
}

function failureReason(error) {
  if (error instanceof NotesFailure) return error.message;
  if (error?.name === 'TimeoutError') return '请求超过 60 秒';
  const code = error?.cause?.code;
  return `请求失败（${error?.name ?? 'Error'}${code ? ` ${code}` : ''}）`;
}

/** Busy or briefly unreachable services usually recover within seconds; bad config never does. */
const RETRY_DELAYS = [5000, 15000];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function transient(error) {
  if (error instanceof NotesFailure) return error.retry === true;
  return error?.name === 'TimeoutError' || ['ECONNRESET', 'ETIMEDOUT', 'UND_ERR_SOCKET'].includes(error?.cause?.code);
}

/** A short excerpt of an error reply, with the key, model and host taken out. */
function errorExcerpt(text, { key, model, endpoint }) {
  let excerpt = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  for (const secret of [key, model, endpoint.host].filter(Boolean)) excerpt = excerpt.split(secret).join('***');
  return excerpt;
}

function changelogText(text, key) {
  const changelog = String(text ?? '').trim().replace(/^```(?:markdown)?\s*/i, '').replace(/\s*```$/, '').trim();
  if (!changelog || changelog.length > 12000 || changelog.includes(key)) return undefined;
  return changelog;
}

async function chatAttempt(endpoint, { key, model, prompt, fetchImpl, label, log }) {
  const started = Date.now();
  log(`${label}：请求模型`);
  const response = await fetchImpl(endpoint, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60000),
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }] }),
  });
  log(`${label}：HTTP ${response.status}，用时 ${Date.now() - started} ms`);
  if (!response.ok) {
    const excerpt = errorExcerpt(await response.text().catch(() => ''), { key, model, endpoint });
    if (excerpt) log(`${label}：接口回复 ${excerpt}`);
    const failure = new NotesFailure(`接口返回 HTTP ${response.status}`);
    failure.retry = response.status === 429 || response.status >= 500;
    throw failure;
  }
  const payload = await response.json().catch(() => undefined);
  const text = changelogText(payload?.choices?.[0]?.message?.content, key);
  if (!text) throw new NotesFailure('接口没有返回可用的说明（为空、过长或包含密钥）');
  log(`${label}：收到 ${text.length} 字`);
  return text;
}

async function chatCompletion(endpoint, { wait = sleep, ...options }) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await chatAttempt(endpoint, options);
    } catch (error) {
      if (attempt >= RETRY_DELAYS.length || !transient(error)) throw error;
      options.log(`${options.label}：${failureReason(error)}，${RETRY_DELAYS[attempt] / 1000} 秒后重试`);
      await wait(RETRY_DELAYS[attempt]);
    }
  }
}

const AUDIENCES = {
  desktop: 'people who use the Tandem desktop app',
  relay: 'people who self-host the Tandem relay server and phone app',
};

export async function modelChangelog(subjects, {
  url = '', key = '', model = '', fetchImpl = fetch, onFailure = () => {}, log = () => {}, audience = 'desktop', wait,
} = {}) {
  if (!subjects.length) return undefined;
  if (!url || !key || !model) {
    onFailure('没有配置接口地址、密钥或模型');
    return undefined;
  }
  const endpoint = chatEndpoint(url);
  if (!endpoint) {
    onFailure('接口地址无效：需要不带账号的 HTTPS 地址');
    return undefined;
  }
  try {
    const english = await chatCompletion(endpoint, {
      key, model, fetchImpl, log, wait, label: '英文说明',
      prompt: `Based on these git commit subjects, write concise release notes in markdown for ${AUDIENCES[audience] ?? AUDIENCES.desktop}. Use "### Features", "### Fixes" and "### Improvements" headings and omit empty ones. Keep only changes those readers can notice. Skip dependency bumps, formatting, CI, tests and docs-only commits. One sentence per item. Output only the notes, without a preamble, version numbers or install instructions.\n\nCommit subjects:\n${subjects.join('\n')}`,
    });
    let chinese;
    try {
      chinese = await chatCompletion(endpoint, {
        key, model, fetchImpl, log, wait, label: '中文翻译',
        prompt: `把下面的发布说明译成简体中文。标题依次译为“### 新功能”“### 修复”“### 改进”，保留 markdown 结构、链接、代码和产品名 Tandem。只输出译文，不要前言。\n\n${english}`,
      });
    } catch (error) {
      log(`中文翻译失败：${failureReason(error)}，中文改用提交标题`);
    }
    return chinese ? { english, chinese } : { english };
  } catch (error) {
    onFailure(failureReason(error));
    return undefined;
  }
}

function subjectList(subjects, empty) {
  return subjects.length ? subjects.map((subject) => `- ${subject}`).join('\n') : empty;
}

/** Notes in both languages; each language falls back to the commit subjects on its own. */
export async function changeNotes({ subjects, llm = {}, fetchImpl, audience = 'desktop', log = console.info, wait }) {
  let reason;
  const generated = await modelChangelog(subjects, {
    ...llm, fetchImpl, audience, log, wait, onFailure: (why) => { reason = why; },
  });
  const notes = {
    en: generated?.english ?? subjectList(subjects, 'No listed changes.'),
    zh: generated?.chinese ?? subjectList(subjects, '没有可列出的改动。'),
    source: generated?.english ? 'model' : 'commits',
    reason,
  };
  if (notes.source === 'model') log(generated.chinese ? '更新说明：由模型生成' : '更新说明：英文由模型生成，中文使用提交标题');
  else log(`更新说明：使用提交标题${reason ? `（${reason}）` : ''}`);
  return notes;
}

/** Chinese first; English stays one click away without doubling the page. */
export function releaseBody({ zh, en, zhAfter, enAfter }) {
  return [
    '## 更新内容', zh, zhAfter,
    '<details>\n<summary>English</summary>', '## What\'s new', en, enAfter, '</details>',
  ].join('\n\n');
}
