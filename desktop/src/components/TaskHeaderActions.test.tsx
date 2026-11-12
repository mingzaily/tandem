import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { TaskHeaderActions } from './TaskHeaderActions';

vi.hoisted(() => vi.stubGlobal('navigator', { language: 'zh-CN' }));
afterAll(() => vi.unstubAllGlobals());

const task = { id: 'task', agent: 'pi' as const, cwd: '/project', title: 'Task', updatedAtMs: 0 };

describe('task header menu', () => {
  it('marks its own trigger open and keeps it closed for the sidebar trigger', () => {
    for (const source of ['header', 'sidebar'] as const) {
      const html = renderToStaticMarkup(<TaskHeaderActions task={task} menuAnchor={{ source, id: task.id, x: 0, y: 0 }} onMenu={() => {}} onError={() => {}} />);
      expect(html).toMatch(new RegExp(`aria-label="更多"[^>]*aria-expanded="${source === 'header'}"[^>]*aria-pressed="${source === 'header'}"`));
    }
  });
});
