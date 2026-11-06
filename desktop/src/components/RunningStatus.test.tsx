import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { RunningStatus } from './RunningStatus';
import { applyTurnEvent, turnStatus } from '../lib/items';
import { emptyRateHistory } from '../lib/tokenRate';

vi.hoisted(() => vi.stubGlobal('navigator', { language: 'zh-CN' }));
afterAll(() => vi.unstubAllGlobals());

describe('running tool status', () => {
  const props = { startedAt: Date.now(), outputTokens: 352, activity: 1, rate: emptyRateHistory(Date.now()) };
  const tool = (name: string) => applyTurnEvent([], { type: 'toolUse', id: 'call', name, input: 'private arguments' });

  it('shows the exact tool name, a full hover label, and the existing token control', () => {
    const name = `mcp__memory__${'long_tool_name_'.repeat(12)}search`;
    const html = renderToStaticMarkup(<RunningStatus {...props} status={turnStatus(tool(name), false)} />);
    expect(html).toContain(`${name} 运行中…`);
    expect(html).toContain(`title="${name} 运行中…"`);
    expect(html).toContain('352 tok');
    expect(html).not.toContain('private arguments');
  });

  it('keeps the generic calling label when the CLI gives no name', () => {
    const html = renderToStaticMarkup(<RunningStatus {...props} status={turnStatus(tool(''), false)} />);
    expect(html).toContain('正在调用工具…');
    expect(html).not.toContain('运行中…');
  });

  it('gives confirmation precedence over a tool name', () => {
    const html = renderToStaticMarkup(<RunningStatus {...props} status={turnStatus(tool('mcp__memory__search'), true)} />);
    expect(html).toContain('等你确认…');
    expect(html).not.toContain('mcp__memory__search');
  });
});
