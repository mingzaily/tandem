import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { RateCard, RunningStatus } from './RunningStatus';
import { applyTurnEvent, turnStatus } from '../lib/items';
import { emptyRateHistory, recordSpeed } from '../lib/tokenRate';

vi.hoisted(() => vi.stubGlobal('navigator', { language: 'zh-CN' }));
afterAll(() => vi.unstubAllGlobals());

describe('measured speed card', () => {
  it('keeps speed unknown while still showing the CLI cumulative output', () => {
    const html = renderToStaticMarkup(<RateCard rate={emptyRateHistory()} outputTokens={35_000} now={1_000} />);
    expect(html.match(/—/g)).toHaveLength(3);
    expect(html).toContain('35k tok');
    expect(html).not.toContain('0 tok/s');
  });

  it('shows paired measurements and keeps an idle reading distinct from active generation', () => {
    const rate = recordSpeed(emptyRateHistory(), { rate: 50, average: 45, peak: 60, generationMs: 20_000, measuredTokens: 900, streaming: false }, 1_000);
    const html = renderToStaticMarkup(<RateCard rate={rate} outputTokens={35_000} now={2_000} />);
    expect(html).toContain('50.0');
    expect(html).toContain('45.0 tok/s');
    expect(html).toContain('60.0 tok/s');
    expect(html).toContain('暂未生成，显示上一次的速度');
  });
});

describe('running tool status', () => {
  const props = { startedAt: Date.now(), outputTokens: 352, activity: 1, rate: emptyRateHistory() };
  const tool = (name: string) => applyTurnEvent([], { type: 'toolUse', id: 'call', name, input: 'private arguments' });

  it('shows the exact tool name, a full hover label, and the existing token control', () => {
    const name = `mcp__memory__${'long_tool_name_'.repeat(12)}search`;
    const html = renderToStaticMarkup(<RunningStatus {...props} status={turnStatus(tool(name), false)} />);
    expect(html).toContain(`${name} 运行中…`);
    expect(html).toContain(`data-tooltip="${name} 运行中…"`);
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
