import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { ReplyError } from './ReplyError';

vi.hoisted(() => vi.stubGlobal('navigator', { language: 'zh-CN' }));
afterAll(() => vi.unstubAllGlobals());

const render = (details: string) => renderToStaticMarkup(<ReplyError details={details} />);

describe('failed reply timeline record', () => {
  it('shows the reported quota and reset time without requiring expansion', () => {
    const html = render("You've hit your 5-hour limit · resets 1am (Asia/Shanghai)");
    expect(html).toContain('已达到 5 小时用量上限');
    expect(html).toContain('额度重置时间：1am (Asia/Shanghai)');
    expect(html).not.toContain('<details');
    expect(html).not.toContain('<pre');
    expect(html).not.toContain('查看错误详情');
    expect(html).toContain('aria-label="回复异常，本轮已结束"');
  });

  it('shows a short readable reason directly in the normal text column', () => {
    const html = render('Error reading response: malformed server-sent event JSON.');
    expect(html).toMatch(/<p[^>]*>Error reading response: malformed server-sent event JSON\.<\/p>/);
    expect(html).not.toContain('<details');
    expect(html).not.toContain('<pre');
  });

  it('keeps a readable first-line reason visible while only the diagnostics are folded', () => {
    const html = render('Connection closed by upstream\n    at Stream.read (stream.ts:20)\nrequest id: 123');
    expect(html).toMatch(/<p[^>]*>Connection closed by upstream<\/p>/);
    expect(html).toContain('<details');
    expect(html).not.toContain('open=""');
    expect(html).toContain('at Stream.read (stream.ts:20)');
    expect(html).toContain('request id: 123');
  });

  it('keeps raw JSON details collapsed behind the fallback outcome', () => {
    const html = render('{"error":"provider rejected"}\nrequest id: 123');
    expect(html).toContain('回复异常，本轮已结束');
    expect(html).toContain('rounded-xl');
    expect(html).toContain('bg-[var(--surface-elevated)]');
    expect(html).toContain('text-[var(--text-primary)]');
    expect(html).toContain('查看错误详情');
    expect(html).toContain('<details');
    expect(html).not.toContain('open=""');
    expect(html).toContain('provider rejected');
  });

  it('bounds a long first-line summary and retains the complete diagnostic text', () => {
    const message = 'Request failed: ' + 'diagnostic '.repeat(50);
    const html = render(message);
    const paragraph = html.match(/<p[^>]*>(.*?)<\/p>/s)![1];
    expect(paragraph.length).toBeLessThanOrEqual(241);
    expect(paragraph).toContain('…');
    expect(html).toContain(message);
  });

  it('uses only explicitly reported quota fields and keeps other account errors intact', () => {
    const missingTime = render("You've hit your 5-hour limit");
    expect(missingTime).toContain('已达到 5 小时用量上限');
    expect(missingTime).not.toContain('额度重置时间');
    const unknown = render('Account unavailable');
    expect(unknown).toMatch(/<p[^>]*>Account unavailable<\/p>/);
    expect(unknown).not.toContain('用量上限');
    expect(unknown).not.toContain('额度重置时间');
  });

  it('localizes a quota reason in English while preserving the reported timezone', () => {
    vi.stubGlobal('navigator', { language: 'en-US' });
    try {
      const html = render("You've hit your 5-hour limit · resets 1am (Asia/Shanghai)");
      expect(html).toContain('The 5-hour usage limit has been reached.');
      expect(html).toContain('Quota resets at 1am (Asia/Shanghai)');
      expect(html).not.toContain('<details');
    } finally { vi.stubGlobal('navigator', { language: 'zh-CN' }); }
  });

  it('renders upstream markup as folded plain text', () => {
    const html = render('<html><h1>Gateway error</h1></html>');
    expect(html).toContain('<details');
    expect(html).toContain('&lt;html&gt;');
    expect(html).not.toContain('<html>');
    expect(html).not.toContain('open=""');
  });

  it('keeps an error outcome visible when the CLI supplies no details', () => {
    const html = render('  \n ');
    expect(html).toContain('回复异常，本轮已结束');
    expect(html).not.toContain('<details');
  });
});
