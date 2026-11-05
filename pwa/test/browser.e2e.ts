import { chromium } from '@playwright/test';
import { preview } from 'vite';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { createRelay } from '../../relay/src/server.ts';
import { fakeHost } from '../../relay/dev/fake-host.ts';
const dir = await mkdtemp(join(tmpdir(), 'tandem-browser-'));
const relay = await createRelay({ hostToken: 'browser-test', dataFile: join(dir, 'tokens.json') });
relay.server.listen(0, '127.0.0.1');
await once(relay.server, 'listening');
const host = await fakeHost(
  `ws://127.0.0.1:${(relay.server.address() as any).port}/ws`,
  'browser-test',
  async () => true,
);
const web = await preview({ preview: { port: 0, host: '127.0.0.1' } });
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    deviceScaleFactor: 2,
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const origin = `http://127.0.0.1:${(web.httpServer.address() as any).port}`;
  await page.goto(origin);
  await page.screenshot({ path: process.env.SHOTS + 'pair.png', fullPage: true });
  await page.getByRole('textbox', { name: '粘贴配对码' }).fill(host.pairCode);
  await page.getByRole('button', { name: '配对桌面端', exact: true }).click();
  await page.getByRole('button', { name: /手机上的第一个任务/ }).waitFor();
  await page.screenshot({ path: process.env.SHOTS + 'list.png', fullPage: true });
  await page.getByRole('button', { name: /手机上的第一个任务/ }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: process.env.SHOTS + 'task.png', fullPage: true });
  await page.getByRole('textbox', { name: '发送消息' }).fill('浏览器测试');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.getByRole('button', { name: '允许一次' }).waitFor();
  await page.screenshot({ path: process.env.SHOTS + 'permission.png', fullPage: true });
  await page.getByRole('button', { name: '允许一次' }).click();
  await page.getByText('下一步做什么？', { exact: true }).waitFor();
  await page.screenshot({ path: process.env.SHOTS + 'question.png', fullPage: true });
  await page.getByRole('radio').first().check();
  await page.getByRole('button', { name: '提交回答' }).click();
  await page.getByRole('button', { name: '发送消息', exact: true }).waitFor();
  await page.reload();
  await page.getByRole('button', { name: /手机上的第一个任务/ }).waitFor();
  await host.revoke();
  await page.getByText('此手机的访问权限已被桌面端撤销，请重新配对。', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: process.env.SHOTS + 'revoked.png', fullPage: true });
  console.info('浏览器端到端通过');
  await page.context().close();
} finally {
  await browser?.close();
  await host.close();
  await relay.close();
  await new Promise<void>((r) => web.httpServer.close(() => r()));
  await rm(dir, { recursive: true, force: true });
}
