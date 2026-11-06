import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { PendingQueuePanel } from './PendingQueuePanel';
import type { TaskQueue } from '../lib/api';

vi.hoisted(() => vi.stubGlobal('navigator', { language: 'zh-CN' }));
afterAll(() => vi.unstubAllGlobals());

function render(count: number, paused: boolean) {
  const queue: TaskQueue = {
    taskId: 'task', agent: 'claude', paused, error: null, revision: 1,
    entries: Array.from({ length: count }, (_, index) => ({
      id: String(index), prompt: '待发送', attachments: [], options: { model: null, effort: null, permissionMode: null },
    })),
  };
  return renderToStaticMarkup(<PendingQueuePanel queue={queue} onEdit={() => {}} onChange={() => {}} onError={() => {}} />);
}

describe('pending queue structure', () => {
  it('keeps the pause explanation and continue action out of the input card', () => {
    const html = render(3, true);
    expect(html).toContain('role="list"');
    expect(html).not.toContain('任务已停止，队列暂停');
    expect(html).not.toContain('继续发送');
    expect(html).not.toContain('>待发送消息<');
  });

  it('keeps a short active queue free of a title bar and footer actions', () => {
    const html = render(3, false);
    expect(html).toContain('aria-label="待发送消息"');
    expect(html).not.toContain('>待发送消息<');
    expect(html).not.toContain('任务已停止');
    expect(html).not.toContain('继续发送</button>');
    expect(html).not.toContain('aria-expanded=');
  });

  it('offers the folded tail independently of pause state', () => {
    const html = render(7, false);
    expect(html).toContain('还有 4 条');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('继续发送</button>');
    expect(html).not.toContain('任务已停止');
    expect(html.indexOf('还有 4 条')).toBeLessThan(html.lastIndexOf('</div>'));
  });

  it('keeps the folded tail in the list while pause belongs to the status strip', () => {
    const html = render(7, true);
    expect(html).toContain('还有 4 条');
    expect(html).not.toContain('任务已停止');
    expect(html).not.toContain('继续发送');
  });
});
