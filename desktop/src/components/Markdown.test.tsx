import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { Markdown } from './Markdown';

vi.hoisted(() => vi.stubGlobal('navigator', { language: 'zh-CN' }));
afterAll(() => vi.unstubAllGlobals());

describe('Markdown code block copy', () => {
  it('gives every fenced block its own copy action while retaining highlighted code and whitespace', () => {
    const html = renderToStaticMarkup(<Markdown text={'```ts\nconst value = 1;\n  console.log(value);\n```\n\n```\n  plain text\n```'} />);
    expect(html.match(/aria-label="复制代码"/g)).toHaveLength(2);
    expect(html).toContain('hljs-keyword');
    expect(html.replace(/<[^>]*>/g, '')).toContain('  console.log(value);\n');
    expect(html).toContain('  plain text\n');
    expect(html).toContain('md-code-block');
  });
  it('supports indented blocks and keeps inline code free of copy controls', () => {
    const block = renderToStaticMarkup(<Markdown text={'    first line\n    second line'} />);
    expect(block).toContain('aria-label="复制代码"');
    expect(block).toContain('first line\nsecond line\n');
    const inline = renderToStaticMarkup(<Markdown text={'Use `const value = 1` here.'} />);
    expect(inline).toContain('<code>const value = 1</code>');
    expect(inline).not.toContain('<button');
  });
  it('keeps streaming fences and long commands readable with one independent copy action', () => {
    const command = 'security ' + 'long-command-argument '.repeat(80);
    const html = renderToStaticMarkup(<Markdown text={'```sh\n' + command} />);
    expect(html.match(/aria-label="复制代码"/g)).toHaveLength(1);
    expect(html).toContain(command);
    expect(html).toContain('<pre');
  });
});
