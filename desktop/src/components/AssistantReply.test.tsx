import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { AssistantReply } from './AssistantReply';

vi.hoisted(() => vi.stubGlobal('navigator', { language: 'zh-CN' }));
vi.mock('./Markdown', () => ({ Markdown: ({ text }: { text: string }) => <div className="md">{text}</div> }));
afterAll(() => vi.unstubAllGlobals());

describe('assistant copy footer', () => {
  it('keeps streaming and intermediate text free of an action bar', () => {
    const html = renderToStaticMarkup(<AssistantReply text="progress" copyable={false} at={new Date(2026, 10, 11, 15, 22).getTime()} />);
    expect(html).toContain('progress');
    expect(html).not.toContain('data-reply-actions');
    expect(html).not.toContain('aria-label="复制回复"');
    expect(html).not.toContain('<time');
  });

  it('places the recorded local time after copy and exposes its full date on hover', () => {
    const date = new Date(2026, 10, 11, 15, 22, 31);
    const html = renderToStaticMarkup(<AssistantReply text="final reply" copyable at={date.getTime()} />);
    expect(html.indexOf('<time')).toBeGreaterThan(html.indexOf('aria-label="复制回复"'));
    expect(html).toContain(`dateTime="${date.toISOString()}"`);
    expect(html).toMatch(/<time[^>]*>15:22<\/time>/);
    expect(html).toContain('data-tooltip="2026/11/11 15:22:31"');
    expect(html).toContain('aria-label="回复时间：2026/11/11 15:22:31"');
  });

  it.each([undefined, Number.NaN, Number.POSITIVE_INFINITY])('keeps copy available when the native record time is %s', (at) => {
    const html = renderToStaticMarkup(<AssistantReply text="old reply" copyable at={at} />);
    expect(html).toContain('aria-label="复制回复"');
    expect(html).not.toContain('<time');
    expect(html).not.toContain('Invalid Date');
  });

  it('puts a compact copy button under the reply with the reference geometry and existing tooltip', () => {
    const html = renderToStaticMarkup(<AssistantReply text="**final reply**" copyable />);
    expect(html.indexOf('data-reply-actions')).toBeGreaterThan(html.indexOf('**final reply**'));
    expect(html).toContain('aria-label="复制回复"');
    expect(html).toContain('data-tooltip="复制回复"');
    expect(html).toContain('size-6');
    expect(html).toContain('width="14"');
    expect(html).toContain('stroke-width="2"');
    expect(html).not.toContain('border-[var(--border-default)]');
  });
});
