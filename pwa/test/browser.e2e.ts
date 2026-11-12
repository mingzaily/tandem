import { chromium, type Page } from '@playwright/test';
import { preview } from 'vite';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { startRelay } from '../../relay/dev/rust-relay.ts';
import { fakeHost } from '../../relay/dev/fake-host.ts';
const dir = await mkdtemp(join(tmpdir(), 'tandem-browser-'));
const prefix = process.env.SHOTS ?? join(dir, 'pwa-');
const base = process.env.PWA_BASE ?? '/';
await mkdir(dirname(prefix), { recursive: true });
const relay = await startRelay({ hostToken: 'browser-test', dataFile: join(dir, 'tokens.json') });
let web: Awaited<ReturnType<typeof preview>> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const errors: string[] = [];
try {
  web = await preview({ base, preview: { port: 0, host: '127.0.0.1' } });
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const origin = `http://127.0.0.1:${(web.httpServer.address() as { port: number }).port}`;
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 360, height: 740 },
  ]) {
    for (const colorScheme of ['light', 'dark'] as const) {
      const context = await browser.newContext({
        viewport,
        colorScheme,
        isMobile: true,
        deviceScaleFactor: 2,
      });
      let approve!: () => void;
      const host = await fakeHost(
        relay.url,
        'browser-test',
        async () =>
          new Promise<boolean>((r) => {
            approve = () => r(true);
          }),
      );
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(10_000);
        page.on('pageerror', (e) => errors.push(e.message));
        const unexpected: string[] = [];
        page.on('request', (r) => {
          if (r.url().startsWith('https://images.invalid')) unexpected.push(r.url());
        });
        const tag = `${viewport.width}x${viewport.height}-${colorScheme}-`;
        const shot = async (name: string) => {
          await page.evaluate(() => document.fonts.ready);
          await page.waitForTimeout(150);
          await checkWidth(page);
          const header = (await page.locator('.app-header').count())
            ? await page.locator('.app-header').boundingBox()
            : null;
          if (header) assert.ok(header.y >= 0, '任务页顶栏保持可见');
          await page.screenshot({ path: prefix + tag + name + '.png', fullPage: false });
        };
        await page.goto(origin + base);
        assert.equal(await page.locator('html').getAttribute('data-theme'), 'tandem-' + colorScheme);
        await shot('pair');
        await page.getByRole('textbox', { name: '粘贴配对码' }).fill(host.pairCode);
        await page.getByRole('button', { name: '配对桌面端', exact: true }).click();
        await page.locator('.code span').last().waitFor();
        assert.match(await page.locator('.code').innerText(), /\d/);
        assert.equal(await page.locator('.code span').count(), 6);
        await shot('pair-code');
        approve();
        const task = page.getByRole('button', { name: /手机上的第一个任务/ });
        await task.waitFor();
        assert.equal(await page.locator('.connection-status').count(), 0, '正常连接不占状态行');
        await shot('list');
        assert.deepEqual(await page.locator('.project-heading span').allTextContents(), [
          '我的笔记',
          '对话',
          'Tandem',
        ]);
        assert.equal(
          await page.locator('.project-heading').filter({ hasText: '对话' }).locator('small').innerText(),
          '2',
        );
        assert.equal(await page.locator('.task-running').count(), 1);
        await page.getByRole('searchbox', { name: '搜索任务、项目或 CLI' }).fill('阅读笔记');
        await page.getByRole('button', { name: /整理本周的阅读笔记/ }).waitFor();
        assert.equal(await page.locator('.task').count(), 1);
        await page.getByRole('button', { name: '清除搜索' }).click();
        const conversations = page.locator('.project-toggle').filter({ hasText: '对话' });
        await conversations.click();
        assert.equal(await conversations.getAttribute('aria-expanded'), 'false');
        await conversations.click();
        await task.click();
        assert.equal(await page.locator('.composer .composer-controls').count(), 1);
        await page.locator('.md').waitFor();
        assert.equal(await page.locator('.md img').count(), 0);
        assert.equal(await page.evaluate(() => 'tandemInjected' in window), false);
        assert.deepEqual(unexpected, []);
        await page.locator('.stream').evaluate((el) => {
          el.scrollTop = 0;
        });
        await page.getByRole('separator', { name: '对话已压缩' }).waitFor();
        await page.getByText('已中断', { exact: true }).waitFor();
        assert.equal(await page.locator('.notice .lucide-circle-pause').count(), 1);
        const pauseColors = await page.locator('.notice').evaluate((notice) => {
          const sample = document.createElement('span');
          sample.style.color = 'var(--status-paused)';
          document.body.append(sample);
          const expected = getComputedStyle(sample).color;
          sample.remove();
          return { actual: getComputedStyle(notice).color, expected };
        });
        assert.equal(pauseColors.actual, pauseColors.expected, '中断标记使用暂停颜色');
        const work = page.getByRole('button', { name: /已处理/ });
        await work.click();
        await page.getByRole('button', { name: /Bash/ }).click();
        assert.equal(await page.locator('.tool-detail').count(), 1);
        await work.click();
        await shot('task');
        await page.getByRole('button', { name: '推理强度', exact: true }).click();
        await page.getByRole('option', { name: /中/ }).waitFor();
        assert.equal(await page.getByRole('option', { name: /中/ }).getAttribute('aria-selected'), 'true');
        await shot('effort');
        await page.getByRole('button', { name: '关闭', exact: true }).click();
        await page.getByRole('button', { name: '权限模式', exact: true }).click();
        await page.getByRole('option', { name: /完全访问/ }).click();
        await page.getByRole('button', { name: '确认启用' }).click();
        await page.getByRole('textbox', { name: '发送消息' }).fill('浏览器测试');
        await page.getByRole('button', { name: '发送消息', exact: true }).click();
        await page.getByRole('button', { name: '允许一次' }).waitFor();
        assert.equal(await page.locator('.running-status [role="status"]').innerText(), '等你确认…');
        assert.match(await page.locator('.run-meta').innerText(), /\d[\d,]* tok$/);
        assert.equal(await page.getByRole('textbox', { name: '发送消息' }).count(), 1);
        assert.equal(await page.getByRole('button', { name: '停止生成', exact: true }).count(), 1);
        await page.getByRole('textbox', { name: '发送消息' }).fill('确认期间保留的草稿');
        await shot('permission');
        const elapsedSeconds = async () => {
          const label = await page.locator('.run-meta').innerText();
          const match = label.match(/(?:(\d+)分)?(\d+)秒/);
          assert.ok(match, '运行状态显示用时');
          return Number(match[1] ?? 0) * 60 + Number(match[2]);
        };
        await page.waitForTimeout(2100);
        const elapsedBefore = await elapsedSeconds();
        assert.ok(elapsedBefore >= 2);
        await page.addInitScript(() => {
          Date.now = () => new Date().getTime() + 3_600_000;
          // Delay admission acknowledgement while preserving data-before-close ordering.
          const message = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage')!;
          Object.defineProperty(WebSocket.prototype, 'onmessage', {
            configurable: true,
            get: message.get,
            set(handler: WebSocket['onmessage']) {
              message.set!.call(
                this,
                handler &&
                  ((event: MessageEvent) => {
                    if (JSON.parse(String(event.data)).t === 'hello-ack') {
                      window.setTimeout(() => handler.call(this, event), 600);
                    } else {
                      handler.call(this, event);
                    }
                  }),
              );
            },
          });
        });
        await page.reload();
        await page.locator('.connection-status').filter({ hasText: '正在连接桌面端…' }).waitFor();
        await shot('connecting');
        await page.getByRole('button', { name: /手机上的第一个任务/ }).click();
        await page.getByRole('button', { name: '允许一次' }).waitFor();
        assert.equal(await page.locator('.connection-status').count(), 0, '重连成功后移除连接状态行');
        assert.ok((await elapsedSeconds()) >= elapsedBefore, '重载和手机时钟偏差保留运行用时');
        await shot('permission-recovered');
        await page.getByRole('button', { name: '允许一次' }).click();
        await page.getByText('下一步做什么？', { exact: true }).waitFor();
        await page.getByRole('textbox', { name: '发送消息' }).fill('提问期间保留的草稿');
        assert.equal(await page.getByRole('button', { name: '停止生成', exact: true }).count(), 1);
        await shot('question');
        await page.getByRole('radio').first().check();
        await page.getByText('下一步做什么？', { exact: true }).waitFor({ state: 'hidden' });
        await page.getByRole('button', { name: '发送消息', exact: true }).waitFor();
        assert.equal(
          await page.getByRole('textbox', { name: '发送消息' }).inputValue(),
          '提问期间保留的草稿',
        );
        await page.getByRole('button', { name: '新建任务', exact: true }).click();
        await page.getByRole('button', { name: '选择模型', exact: true }).click();
        await page.getByRole('heading', { name: 'Codex', exact: true }).waitFor();
        assert.equal(await page.locator('.model-group').count(), 3);
        await shot('models');
        await page.getByRole('option', { name: 'Codex 演示模型', exact: true }).click();
        await page.getByRole('textbox', { name: '发送消息' }).fill('从手机新建的任务');
        await page.getByRole('button', { name: '发送消息', exact: true }).click();
        await page.getByRole('button', { name: '允许一次' }).waitFor();
        assert.equal(await page.locator('.header-title strong').innerText(), '从手机新建的任务');
        assert.equal(await page.locator('.composer .composer-controls').count(), 1);
        await page.getByRole('button', { name: '拒绝', exact: true }).click();
        await page.getByRole('button', { name: '发送消息', exact: true }).waitFor();
        await page.reload();
        await task.waitFor();
        host.revoke();
        await page.getByText('此手机的配对已失效，请重新配对。', { exact: true }).waitFor();
        await shot('revoked');
        const replacement = await fakeHost(relay.url, 'browser-test', async () => true, {
          unavailableAgents: ['pi'],
        });
        try {
          await page.getByRole('textbox', { name: '粘贴配对码' }).fill(replacement.pairCode);
          await page.getByRole('button', { name: '配对桌面端', exact: true }).click();
          await page.getByRole('button', { name: /手机上的第一个任务/ }).waitFor();
          await page.getByRole('button', { name: '新建任务', exact: true }).click();
          await page.getByRole('button', { name: '选择模型', exact: true }).click();
          await page.getByRole('alert').filter({ hasText: '演示 Agent 暂未就绪' }).waitFor();
          await page.getByRole('option', { name: 'Codex 演示模型', exact: true }).click();
        } finally {
          await replacement.close();
        }
        await page.locator('.connection-status').filter({ hasText: '桌面端已离线' }).waitFor();
        await shot('offline');

        console.info(`${tag}通过：配对、列表、折叠、Markdown、面板、确认、提问、新建、重载、撤销`);
      } finally {
        await context.close();
        await host.close();
      }
    }
  }
  assert.deepEqual(errors, []);
  console.info(`浏览器端到端通过；截图前缀：${prefix}`);
} finally {
  await browser?.close();
  await relay.close();
  if (web) await new Promise<void>((r) => web!.httpServer.close(() => r()));
  await rm(dir, { recursive: true, force: true });
}
async function checkWidth(page: Page) {
  assert.equal(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <= innerWidth &&
        document.querySelector('main')!.scrollWidth <= innerWidth,
    ),
    true,
    '页面应适配手机宽度',
  );
}
