import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, it, vi } from 'vitest';
import MessageStream, { Group } from './MessageStream';
import { buildRows, type Item, type WorkGroup } from '../lib/items';

vi.hoisted(() => vi.stubGlobal('navigator', { language: 'zh-CN' }));
afterAll(() => vi.unstubAllGlobals());
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count, getItemKey, estimateSize }: { count: number; getItemKey: (index: number) => string; estimateSize: () => number }) => ({
    getTotalSize: () => count * estimateSize(),
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, key: getItemKey(index), start: index * estimateSize(), size: estimateSize() })),
    measureElement: () => {}, scrollToIndex: () => {},
  }),
}));

describe('completed turn footer placement', () => {
  it('renders the reply, file changes and recorded time before the next running input', () => {
    const html = renderToStaticMarkup(<MessageStream taskId="task" agent="pi" items={[
      { type: 'user', id: 'u', text: 'edit files' },
      { type: 'tool', id: 'edit', name: 'Edit', input: '{"file_path":"/code/file.ts"}', result: 'ok', isError: false, truncated: false },
      { type: 'assistant', id: 'final', text: 'Finished editing.', at: new Date(2026, 10, 12, 15, 11).getTime() },
      { type: 'user', id: 'next', text: 'Start the next task.' },
      { type: 'assistant', id: 'streaming', text: 'Still working.' },
    ]} isRunning editableId={null} onEditLast={async () => {}} sendWithCmdEnter={false} isLoading={false} cwd="/code" bottomPadding={150} />);
    const reply = html.indexOf('Finished editing.');
    const card = html.indexOf('1 个文件已更改');
    const actions = html.indexOf('data-reply-actions');
    const time = html.indexOf('<time');
    const next = html.indexOf('Start the next task.');
    expect(card).toBeGreaterThan(reply);
    expect(actions).toBeGreaterThan(card);
    expect(time).toBeGreaterThan(actions);
    expect(next).toBeGreaterThan(time);
    expect(html.match(/data-reply-actions/g)).toHaveLength(1);
    expect(html).toMatch(/<time[^>]*>15:11<\/time>/);
  });
});

const work: Item = { type: 'thinking', id: 'thinking', text: 'Still checking the project' };
const steer: Item = { type: 'user', id: 'steer', text: 'Only check Code', steered: true };
const group = (steered: boolean): WorkGroup => buildRows([
  { type: 'user', id: 'user', text: 'Check usage' }, work, ...(steered ? [steer] : []),
], true)[1] as WorkGroup;

describe('recovered work without a final reply', () => {
  const pending: Item = { type: 'tool', id: 'pending-read', name: 'Read', input: '{"file_path":"/code/input.ts"}', result: null, isError: false, truncated: false, at: 320000 };
  const restored = (): WorkGroup => buildRows([
    { type: 'user', id: 'input', text: 'do work', at: 1000 },
    { type: 'assistant', id: 'progress', text: 'Saved progress from the earlier attempt.', at: 2000 },
    pending,
  ], false)[1] as WorkGroup;
  it('opens the outer record with progress prose while keeping inner tool details folded and static', () => {
    const group = restored();
    const html = renderToStaticMarkup(<Group group={group} expanded={new Map()} onToggle={() => {}} />);
    expect(html).toContain('工作过程 · 5 分 19 秒');
    expect(html).toMatch(/aria-expanded="true"[^>]*data-work-group="completed"/);
    expect(html).toContain('Saved progress from the earlier attempt.');
    expect(html).not.toContain('已处理 5 分 19 秒');
    expect(html).not.toContain('lucide-loader-circle');
    const nested = group.items.find((item) => item.type === 'group')!;
    const expanded = renderToStaticMarkup(<Group group={group} expanded={new Map([[nested.id, true]])} onToggle={() => {}} />);
    expect(expanded).toContain('aria-label="未记录结果"');
    expect(expanded).not.toContain('lucide-loader-circle');
  });
  it('preserves an explicit manual close while ordinary completed turns still start folded', () => {
    const group = restored();
    const closed = renderToStaticMarkup(<Group group={group} expanded={new Map([[group.id, false]])} onToggle={() => {}} />);
    expect(closed).toContain('aria-expanded="false"');
    expect(closed).not.toContain('Saved progress from the earlier attempt.');
    const completed = buildRows([{ type: 'user', id: 'u', text: 'work' }, work, { type: 'assistant', id: 'answer', text: 'Done' }], false)[1] as WorkGroup;
    const html = renderToStaticMarkup(<Group group={completed} expanded={new Map()} onToggle={() => {}} />);
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('Still checking the project');
  });
});

describe('steered work preview', () => {
  it('keeps the visible thinking row and disclosure open when a steer is appended', () => {
    for (const steered of [false, true]) {
      const html = renderToStaticMarkup(<Group group={group(steered)} expanded={new Map()} onToggle={() => {}} />);
      expect(html).toMatch(/aria-expanded="true"[^>]*data-work-group="running"/);
      expect(html).toContain('lucide-loader-circle');
      expect(html).toContain('Still checking the project');
    }
  });

  it('uses a static icon for earlier work without hiding its preview when new work starts after a steer', () => {
    const rows = buildRows([{ type: 'user', id: 'user', text: 'Check usage' }, work, steer,
      { type: 'tool', id: 'tool', name: 'Read', input: '{}', result: null, isError: false, truncated: false }], true);
    const previous = rows[1] as WorkGroup;
    const current = rows[3] as WorkGroup;
    const html = renderToStaticMarkup(<Group group={previous} expanded={new Map()} onToggle={() => {}} />);
    expect(html).toContain('data-work-group="completed"');
    expect(html).toContain('Still checking the project');
    expect(html).toContain('lucide-layers');
    expect(html).not.toContain('lucide-loader-circle');
    const live = renderToStaticMarkup(<Group group={current} expanded={new Map()} onToggle={() => {}} />);
    expect(live).toContain('data-work-group="running"');
  });

  it('preserves an explicit close while an explicitly expanded preview stays expanded', () => {
    const current = group(true);
    const closed = renderToStaticMarkup(<Group group={current} expanded={new Map([[current.id, false]])} onToggle={() => {}} />);
    expect(closed).not.toContain('Still checking the project');
    expect(closed).toContain('aria-expanded="false"');
    const opened = renderToStaticMarkup(<Group group={current} expanded={new Map([[current.id, true]])} onToggle={() => {}} />);
    expect(opened).toContain('Still checking the project');
  });
});
