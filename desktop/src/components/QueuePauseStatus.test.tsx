import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { QueuePauseStatus } from './QueuePauseStatus';

vi.hoisted(() => vi.stubGlobal('navigator', { language: 'zh-CN' }));
afterAll(() => vi.unstubAllGlobals());

describe('queue pause status', () => {
  it('presents pause and resume together outside the queue list', () => {
    const html = renderToStaticMarkup(<QueuePauseStatus
      queue={{ taskId: 'task', agent: 'claude', entries: [], paused: true, pausedAfterRestart: false, error: null, revision: 1 }}
      onChange={() => {}} onError={() => {}} />);
    expect(html).toContain('role="status"');
    expect(html).toContain('任务已停止，队列暂停');
    expect(html).toContain('lucide-pause');
    expect(html).toContain('继续发送</button>');
    expect(html).not.toContain('role="list"');
  });

  it('says a restart paused the queue rather than a stopped task', () => {
    const html = renderToStaticMarkup(<QueuePauseStatus
      queue={{ taskId: 'task', agent: 'claude', entries: [], paused: true, pausedAfterRestart: true, error: null, revision: 1 }}
      onChange={() => {}} onError={() => {}} />);
    expect(html).toContain('应用重启过，待发送的消息已暂停');
    expect(html).not.toContain('任务已停止');
  });
});
