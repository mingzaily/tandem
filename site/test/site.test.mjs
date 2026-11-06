import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { runInNewContext } from 'node:vm';

const root = resolve('.vitepress/dist');
async function files(path) {
  const entries = await readdir(path, { withFileTypes: true });
  return (await Promise.all(entries.map((e) => e.isDirectory() ? files(resolve(path, e.name)) : resolve(path, e.name)))).flat();
}
test('built pages contain valid local navigation, fragments and no internal development documents', async () => {
  const html = (await files(root)).filter((p) => p.endsWith('.html'));
  assert.ok(html.length >= 9);
  assert.ok(html.every((p) => !p.includes('/docs/')));
  for (const page of html) {
    const content = await readFile(page, 'utf8');
    for (const [, href] of content.matchAll(/href="([^"]+)"/g)) {
      if (/^(https?:|mailto:|data:)/.test(href)) continue;
      const [address, fragment] = href.split('#');
      const path = decodeURIComponent(address.split('?')[0]);
      const target = !path ? page : path.startsWith('/tandem/') ? resolve(root, path.slice(8)) : resolve(dirname(page), path);
      const candidates = [target, target + '.html', resolve(target, 'index.html')];
      const found = await Promise.all(candidates.map((p) => stat(p).then((s) => s.isFile(), () => false)));
      assert.ok(found.some(Boolean), `${page}: ${href}`);
      if (fragment) {
        const destination = await readFile(candidates[found.indexOf(true)], 'utf8');
        const ids = [...destination.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => id);
        assert.ok(ids.includes(decodeURIComponent(fragment)), `${page}: missing fragment ${href}`);
      }
    }
  }
});

test('published PWA installs within its own path and preserves other applications caches', async () => {
  const origin = 'https://pages.example';
  const app = '/tandem/app/';
  const manifestUrl = new URL(app + 'manifest.webmanifest', origin);
  const manifest = JSON.parse(await readFile(resolve(root, 'app/manifest.webmanifest'), 'utf8'));
  for (const field of ['start_url', 'scope']) {
    assert.equal(new URL(manifest[field], manifestUrl).pathname, app);
  }
  // Explicit manifest IDs resolve from the origin; omitted IDs use the launch URL.
  const launch = new URL(manifest.start_url, manifestUrl);
  assert.equal(new URL(manifest.id ?? launch.href, launch.origin).pathname, app);
  for (const icon of manifest.icons) {
    const path = new URL(icon.src, manifestUrl).pathname;
    assert.ok(path.startsWith(app));
    assert.ok((await stat(resolve(root, path.slice('/tandem/'.length)))).isFile());
  }
  const html = await readFile(resolve(root, 'app/index.html'), 'utf8');
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /href="\/tandem\/app\/manifest.webmanifest"/);

  const events = new Map();
  const installed = [];
  const deleted = [];
  const opened = [];
  const previous = 'tandem-shell:/tandem/app/:previous';
  const foreign = ['tandem-shell:/:previous', 'tandem-shell:/other/:previous', 'another-app'];
  runInNewContext(await readFile(resolve(root, 'app/sw.js'), 'utf8'), {
    URL,
    self: {
      location: { origin },
      clients: { claim: async () => {} },
      addEventListener: (name, handler) => events.set(name, handler),
    },
    caches: {
      open: async (name) => {
        opened.push(name);
        return { addAll: async (urls) => installed.push(...urls), match: async () => new Response('cached') };
      },
      keys: async () => [previous, ...foreign, ...new Set(opened)],
      delete: async (name) => { deleted.push(name); return true; },
    },
  });
  for (const lifecycle of ['install', 'activate']) {
    let work;
    events.get(lifecycle)({ waitUntil: (promise) => { work = promise; } });
    await work;
  }
  assert.ok(opened[0].startsWith('tandem-shell:/tandem/app/:'));
  assert.deepEqual(deleted, [previous]);
  assert.ok(installed.every((path) => path.startsWith(app)));
  for (const path of installed) {
    const target = resolve(root, path.slice('/tandem/'.length), path.endsWith('/') ? 'index.html' : '');
    assert.ok((await stat(target)).isFile(), path);
  }
  for (const [address, method, cached] of [
    [app, 'GET', true],
    [app + 'index.html', 'GET', true],
    ['/tandem/', 'GET', false],
    ['/tandem/guide/pairing', 'GET', false],
    ['/ws', 'GET', false],
    [app + 'unlisted', 'GET', false],
    [app, 'POST', false],
    ['https://relay.example/ws', 'GET', false],
  ]) {
    let response;
    events.get('fetch')({ request: { url: new URL(address, origin).href, method }, respondWith: (promise) => { response = promise; } });
    assert.equal(Boolean(response), cached, `${method} ${address}`);
    if (response) assert.equal(await (await response).text(), 'cached');
  }
});
