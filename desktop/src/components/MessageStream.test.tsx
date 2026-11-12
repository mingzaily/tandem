import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { Group } from './MessageStream';
import { buildRows, type Item, type WorkGroup } from '../lib/items';

vi.hoisted(() => vi.stubGlobal('navigator', { language: 'zh-CN' }));
afterAll(() => vi.unstubAllGlobals());

const work: Item = { type: 'thinking', id: 'thinking', text: 'Still checking the project' };
const steer: Item = { type: 'user', id: 'steer', text: 'Only check Code', steered: true };
const group = (steered: boolean): WorkGroup => buildRows([
  { type: 'user', id: 'user', text: 'Check usage' }, work, ...(steered ? [steer] : []),
], true)[1] as WorkGroup;

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
