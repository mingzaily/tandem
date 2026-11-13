import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { PendingQueuePanel } from './PendingQueuePanel';
import type { Attachment, QueuedMessage, TaskQueue } from '../lib/api';

const dragging = vi.hoisted(() => ({ entry: null as QueuedMessage | null }));
vi.hoisted(() => {
  vi.stubGlobal('navigator', { language: 'zh-CN' });
  vi.stubGlobal('document', Object.assign(new EventTarget(), { body: {} }));
});
vi.mock('react-dom', () => ({ createPortal: (children: ReactNode) => children }));
vi.mock('../lib/useQueueDrag', () => ({ useQueueDrag: () => ({
  drag: dragging.entry ? { entry: dragging.entry, from: 0, target: 0, left: 0, top: 0, width: 500, height: 32 } : null,
  sorting: false, startDrag() {},
}) }));
beforeEach(() => { dragging.entry = null; });
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => 6 + count * 32,
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ key: index, index, start: 6 + index * 32 })),
    measureElement: () => {}, scrollToIndex: () => {}, measurementsCache: [],
  }),
}));

afterAll(() => vi.unstubAllGlobals());

function render(count: number, paused: boolean, attachments: Attachment[] = []) {
  const queue: TaskQueue = {
    taskId: 'task', agent: 'claude', paused, pausedAfterRestart: false, error: null, revision: 1,
    entries: Array.from({ length: count }, (_, index) => ({
      id: String(index), prompt: '待发送', attachments, options: { model: null, effort: null, permissionMode: null },
    })),
  };
  return renderToStaticMarkup(<PendingQueuePanel queue={queue} onEdit={() => {}} onChange={() => {}} onError={() => {}} running onSteer={() => {}} onNewTask={async () => {}} />);
}

describe('queue image and file summaries', () => {
  const image = (id: string, preview: string | undefined = `data:image/png;base64,${id}`): Attachment => ({ id, name: `${id}.png`, kind: 'image', preview });
  const file = (id: string): Attachment => ({ id, name: `${id}.txt`, kind: 'file', path: `/project/${id}.txt` });
  it('shows a single image thumbnail without a second attachment count', () => {
    const html = render(1, false, [image('one')]);
    expect(html).toContain('src="data:image/png;base64,one"');
    expect(html).toContain('aria-label="1 张图片"');
    expect(html).not.toContain('lucide-paperclip');
    expect(html).not.toContain('aria-label="1 个文件"');
  });
  it('summarizes multiple images in one tooltip tag and preserves the inline count', () => {
    const html = render(1, false, [image('one'), image('two'), image('three')]);
    expect(html).toContain('aria-label="3 张图片"');
    expect(html).toMatch(/>3<\/span>/);
    expect(html).toContain('图片 × 3');
    expect(html).toContain('data-tooltip="待发送"');
    expect(html).not.toContain('one.png\ntwo.png\nthree.png');
    expect(html).not.toContain('lucide-paperclip');
  });
  it('counts only ordinary files next to a mixed image-and-file message', () => {
    const html = render(1, false, [image('image'), file('document'), file('notes')]);
    expect(html).toContain('aria-label="1 张图片"');
    expect(html).toContain('aria-label="2 个文件"');
    expect(html).not.toContain('aria-label="3 个文件"');
    expect(html.match(/lucide-paperclip/g)).toHaveLength(1);
    expect(html).toContain('document.txt\nnotes.txt');
  });
  it('uses the same image and file counts in the dragged row', () => {
    const attachments = [image('one'), image('two'), file('document')];
    dragging.entry = { id: '0', prompt: '待发送', attachments, options: { model: null, effort: null, permissionMode: null } };
    const html = render(1, false, attachments);
    expect(html.match(/aria-label="2 张图片"/g)).toHaveLength(2);
    expect(html.match(/aria-label="1 个文件"/g)).toHaveLength(2);
    expect(html.match(/lucide-paperclip/g)).toHaveLength(2);
    expect(html).not.toContain('aria-label="3 个文件"');
  });
  it('shows a file-only message without an image placeholder', () => {
    const html = render(1, false, [file('document')]);
    expect(html).toContain('aria-label="1 个文件"');
    expect(html).toContain('lucide-paperclip');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('张图片');
  });
  it('retains the image count when a preview is unavailable', () => {
    const withoutPreview = { ...image('missing'), preview: undefined };
    const html = render(1, false, [withoutPreview]);
    expect(html).toContain('aria-label="1 张图片"');
    expect(html).toContain('lucide-image');
    expect(html).not.toContain('lucide-paperclip');
    expect(html).not.toContain('<img');
  });
});

describe('pending queue structure', () => {
  it('keeps a queue icon and a same-position drag handle on every row', () => {
    const html = render(3, false);
    expect(html.match(/lucide-list-end/g)).toHaveLength(3);
    expect(html.match(/lucide-grip-vertical/g)).toHaveLength(3);
    expect(html).toContain('aria-label="移动第 1 条待发送消息"');
    expect(html).toContain('aria-keyshortcuts="ArrowUp ArrowDown Home End"');
  });

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
