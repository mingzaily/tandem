import { describe, expect, it } from 'vitest';
import { localFileTarget, shouldRenderFileChip } from './fileLinks';

describe('Markdown file references', () => {
  it('recognizes absolute, relative and file URLs with line suffixes', () => {
    expect(localFileTarget('/tmp/a%20b.ts:42:3')).toEqual('/tmp/a b.ts');
    expect(localFileTarget('file:///tmp/a.ts#L42')).toEqual('/tmp/a.ts');
    expect(localFileTarget('./src/app.tsx:18')).toEqual('./src/app.tsx');
    expect(localFileTarget('https://example.com/a.ts')).toBeNull();
    expect(localFileTarget('https://example.com:443')).toBeNull();
    expect(localFileTarget('javascript:42')).toBeNull();
    expect(localFileTarget('app.ts:42')).toBe('app.ts');
    expect(localFileTarget('javascript:alert(1)')).toBeNull();
    expect(localFileTarget('file://another-host/file.ts')).toBeNull();
  });
  it('uses chips for filenames and path labels, and underlines prose', () => {
    const path = '/repo/src/app.tsx';
    for (const label of ['app.tsx', 'app.tsx:42', 'src/app.tsx:42:3', path]) expect(shouldRenderFileChip(path, label)).toBe(true);
    for (const label of ['查看实现', '阅读这份说明', 'line\nbreak']) expect(shouldRenderFileChip(path, label)).toBe(false);
  });
});
