import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { fakeHost } from '../../relay/dev/fake-host.ts';
const origin = process.env.PWA_ORIGIN!;
assert.ok(origin, '设置 PWA_ORIGIN 为本机容器的 HTTP 地址');
const health = await fetch(origin + '/healthz');
assert.deepEqual(await health.json(), { ok: true, v: 1 });
const index = await fetch(origin);
assert.equal(index.headers.get('x-content-type-options'), 'nosniff');
assert.match(await index.text(), /Content-Security-Policy/);
const host = await fakeHost(origin.replace('http:', 'ws:') + '/ws', 'container-fixture', async () => true);
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(origin);
  await page.getByRole('heading', { name: '电脑上的事，接着做。' }).waitFor();
  await page.getByRole('textbox', { name: '粘贴配对码' }).fill(host.pairCode);
  await page.getByRole('button', { name: '配对桌面端', exact: true }).click();
  await page.getByRole('button', { name: /手机上的第一个任务/ }).waitFor();
  assert.deepEqual(errors, []);
  console.log('容器 /healthz、CSP、PWA 页面、WebSocket 配对与任务列表通过。');
} finally {
  await browser?.close();
  await host.close();
}
