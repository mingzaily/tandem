import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { Composer } from './Composer';

vi.hoisted(() => vi.stubGlobal('navigator', { language: 'zh-CN' }));
afterAll(() => vi.unstubAllGlobals());

function render(props: Partial<Parameters<typeof Composer>[0]> = {}) {
  return renderToStaticMarkup(<Composer draftKey="test" running={false} placeholder="继续聊一聊…" toolbarLeft={null} toolbarRight={null} onSend={() => {}} onStop={() => {}} {...props} />);
}

describe('composer action meaning', () => {
  it('keeps the stop action visible without an extra queue instruction', () => {
    const html = render({ running: true });
    expect(html).not.toContain('本条消息将加入待发送队列');
    expect(html).not.toContain('aria-describedby=');
    expect(html).toContain('aria-label="停止生成"');
  });

  it('identifies enqueueing with its icon, tooltip and accessible name', () => {
    const html = render({ queueing: true });
    expect(html).not.toContain('本条消息将加入待发送队列');
    expect(html).toContain('aria-label="加入待发送队列"');
    expect(html).toContain('data-tooltip="加入待发送队列"');
    expect(html).toContain('lucide-list-plus');
    expect(html).not.toContain('lucide-arrow-up');
    expect(html).not.toContain('aria-label="停止生成"');
  });

  it('identifies editing and shows a visible save action with one cancel entry', () => {
    const html = render({ queueing: true, editing: { id: 'queued', prompt: '待发送', attachments: [], options: { model: null, effort: null, permissionMode: null } } });
    expect(html).toContain('aria-label="编辑待发送消息"');
    expect(html).toMatch(/aria-label="保存修改"[^>]*>保存修改<\/button>/);
    expect(html.match(/aria-label="取消编辑"/g)).toHaveLength(1);
    expect(html).not.toContain('本条消息将加入待发送队列');
    expect(html).not.toContain('lucide-list-plus');
  });

  it('allows adding and removing images while editing a queued message', () => {
    const html = render({ editing: {
      id: 'queued', prompt: '待发送', options: { model: null, effort: null, permissionMode: null },
      attachments: [{ id: 'image', name: 'image.png', kind: 'image', preview: 'data:image/png;base64,AA' }],
    } });
    const add = html.match(/<button[^>]*aria-label="添加图片或文件"[^>]*>/)?.[0];
    expect(add).toBeDefined();
    expect(add).not.toContain('disabled=');
    expect(html).toContain('aria-label="移除 image.png"');
  });

  it('gives queued fenced code the same typography and measuring mirror as the ordinary composer', () => {
    const html = render({ editing: { id: 'queued-code', prompt: '```sh\n  terminal output\n```', attachments: [], options: { model: null, effort: null, permissionMode: null } } });
    expect(html).toContain('composer-code-only');
    expect(html).toContain('composer-code-backdrop');
    expect(html).toContain('data-code-fence');
    expect(html).toContain('  terminal output\n');
    expect(html).toContain('aria-label="保存修改"');
  });

  it('keeps ordinary task and new-task inputs free of queue instructions', () => {
    for (const variant of ['task', 'new'] as const) {
      const html = render({ variant });
      expect(html).not.toContain('aria-describedby=');
      expect(html).not.toContain('本条消息将加入待发送队列');
      expect(html).toContain('aria-label="发送消息"');
      expect(html).toContain('lucide-arrow-up');
      expect(html).not.toContain('lucide-list-plus');
    }
  });
});
