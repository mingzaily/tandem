import { chromium, type Page } from '@playwright/test';
import { build } from 'vite';
import { createServer } from 'node:http';
import { cp, mkdir, mkdtemp, readFile, rm, stat, appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

const pwa = fileURLToPath(new URL('../', import.meta.url));
const site = resolve(pwa, '../site/.vitepress/dist');
const dir = await mkdtemp(join(tmpdir(), 'tandem-hosting-'));
const shots = process.env.SHOTS ?? join(dir, 'shots/');
const rootApp = join(dir, 'root');
const publicDir = join(dir, 'public');
const types: Record<string, string> = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2',
};
const errors: string[] = [];
const web = createServer(async (request, response) => {
  const path = decodeURIComponent(new URL(request.url!, 'http://localhost').pathname);
  const nested = path === '/tandem' || path.startsWith('/tandem/');
  const root = nested ? site : rootApp;
  const file = resolve(root, path.slice(nested ? '/tandem/'.length : 1));
  if (file !== root && !file.startsWith(root + sep)) { response.writeHead(404).end(); return; }
  try {
    const info = await stat(file);
    if (info.isDirectory() && !path.endsWith('/')) {
      response.writeHead(301, { Location: path + '/' }).end(); return;
    }
    const target = info.isDirectory() ? join(file, 'index.html') : file;
    const bytes = await readFile(target);
    response.writeHead(200, { 'Content-Type': types[extname(target)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    response.end(bytes);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') errors.push(String(error));
    response.writeHead(404).end();
  }
});
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  await mkdir(shots, { recursive: true });
  await cp(join(pwa, 'public'), publicDir, { recursive: true });
  await build({ root: pwa, base: '/', publicDir, build: { outDir: rootApp }, logLevel: 'error' });
  const originalWorker = await readFile(join(rootApp, 'sw.js'), 'utf8');
  await appendFile(join(publicDir, 'icon.svg'), '\n<!-- hosting update fixture -->\n');
  await build({ root: pwa, base: '/', publicDir, build: { outDir: rootApp }, logLevel: 'error' });
  assert.notEqual(await readFile(join(rootApp, 'sw.js'), 'utf8'), originalWorker, '固定名称图标更新会生成新离线外壳版本');
  await new Promise<void>((ready) => web.listen(0, '127.0.0.1', ready));
  const address = web.address() as { port: number };
  const origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const screenshot = async (page: Page, name: string) => {
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, name);
    await page.screenshot({ path: join(shots, name + '.png') });
  };
  for (const width of [1440, 390]) {
    for (const colorScheme of ['light', 'dark'] as const) {
      const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 960 }, colorScheme });
      try {
        const page = await context.newPage();
        page.on('pageerror', (error) => errors.push(error.message));
        for (const [name, path] of [['home', ''], ['start', 'guide/quick-start.html'], ['proxy', 'guide/proxy.html'], ['pairing', 'guide/pairing.html']]) {
          await page.goto(origin + '/tandem/' + path);
          await page.locator('.VPContent').waitFor();
          await screenshot(page, `${name}-${width}-${colorScheme}`);
        }
        await page.goto(origin + '/tandem/');
        const entry = width === 1440
          ? page.locator('.VPNavBar').getByRole('link', { name: '打开手机端', exact: true })
          : page.locator('.product-remote .product-link');
        await entry.click();
        await page.getByRole('heading', { name: '电脑上的事，接着做。' }).waitFor();
        assert.equal(page.url(), origin + '/tandem/app/');
        assert.equal(await page.locator('img').first().getAttribute('src'), '/tandem/app/icon.svg');
        await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
        assert.equal(await page.evaluate(async () => (await navigator.serviceWorker.ready).scope), origin + '/tandem/app/');
        await page.goBack();
        await page.locator('.VPContent').waitFor();
        assert.equal(await page.evaluate(() => navigator.serviceWorker.controller), null, '手机端 worker 保持官网和文档的页面边界');
      } finally { await context.close(); }
    }
  }
  for (const [width, height] of [[390, 844], [360, 740]]) {
    for (const colorScheme of ['light', 'dark'] as const) {
      const context = await browser.newContext({ viewport: { width, height }, colorScheme });
      try {
        const page = await context.newPage();
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto(origin + '/tandem/app/');
        await page.getByRole('heading', { name: '电脑上的事，接着做。' }).waitFor();
        await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
        await screenshot(page, `app-${width}-${colorScheme}`);
        const manifestPath = await page.locator('link[rel=manifest]').getAttribute('href');
        assert.ok(manifestPath);
        const manifestUrl = new URL(manifestPath, page.url());
        const manifest = await (await fetch(manifestUrl)).json();
        assert.equal(new URL(manifest.start_url, manifestUrl).href, page.url());
        assert.equal(new URL(manifest.scope, manifestUrl).pathname, '/tandem/app/');
        const inspector = await context.newCDPSession(page);
        const parsed = await inspector.send('Page.getAppManifest');
        assert.deepEqual(parsed.errors, []);
        assert.equal((await inspector.send('Page.getAppId')).appId, page.url(), '安装身份使用手机端入口路径');
        await inspector.detach();
        await context.setOffline(true);
        await page.reload();
        await page.getByRole('heading', { name: '电脑上的事，接着做。' }).waitFor();
        assert.equal(await page.evaluate(async () => {
          const names = await caches.keys();
          const shell = await caches.open(names.find((name) => name.startsWith('tandem-shell:/tandem/app/:'))!);
          return (await shell.keys()).every((request) => new URL(request.url).pathname.startsWith('/tandem/app/'));
        }), true);
      } finally { await context.close(); }
    }
  }
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(origin + '/');
    await page.getByRole('heading', { name: '电脑上的事，接着做。' }).waitFor();
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    assert.equal(await page.evaluate(async () => (await navigator.serviceWorker.ready).scope), origin + '/');
    const inspector = await context.newCDPSession(page);
    assert.deepEqual((await inspector.send('Page.getAppManifest')).errors, []);
    assert.equal((await inspector.send('Page.getAppId')).appId, origin + '/');
    await inspector.detach();
    await screenshot(page, 'root-app-390');
    await context.setOffline(true);
    await page.reload();
    await page.getByRole('heading', { name: '电脑上的事，接着做。' }).waitFor();
  } finally { await context.close(); }
  assert.deepEqual(errors, []);
  console.info('官网四页的宽窄浅深色、手机端原生跳转、安装范围、离线外壳与根路径自托管通过。');
} finally {
  await browser?.close();
  await new Promise<void>((done, fail) => web.close((error) => error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING' ? fail(error) : done()));
  await rm(dir, { recursive: true, force: true });
}
