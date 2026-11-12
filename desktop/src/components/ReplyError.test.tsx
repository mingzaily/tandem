import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { ReplyError } from './ReplyError';

vi.hoisted(() => vi.stubGlobal('navigator', { language: 'zh-CN' }));
afterAll(() => vi.unstubAllGlobals());

describe('failed reply timeline record', () => {
  it('shows a short turn outcome and keeps raw protocol details collapsed', () => {
    const html = renderToStaticMarkup(<ReplyError details={'{"error":"provider rejected"}\nrequest id: 123'} />);
    expect(html).toContain('回复异常，本轮已结束');
    expect(html).toContain('查看错误详情');
    expect(html).toContain('<details');
    expect(html).not.toContain('open=""');
    expect(html).toContain('provider rejected');
    expect(html).toContain('request id: 123');
  });
  it('keeps an error outcome visible when the CLI supplies no details', () => {
    const html = renderToStaticMarkup(<ReplyError details="" />);
    expect(html).toContain('回复异常，本轮已结束');
    expect(html).not.toContain('<details');
  });
});
