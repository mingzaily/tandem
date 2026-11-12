import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const css = postcss.parse(readFileSync(resolve(root, 'src/styles/app.css'), 'utf8'));
const tokens = postcss.parse(readFileSync(resolve(root, 'design/tokens/tokens.css'), 'utf8'));
const values = new Map<string, string>();
tokens.walkDecls((declaration) => { values.set(declaration.prop, declaration.value); });

function declarations(selector: string) {
  const result = new Map<string, string>();
  css.walkRules((rule) => {
    if (rule.selectors.includes(selector)) rule.walkDecls((declaration) => { result.set(declaration.prop, declaration.value); });
  });
  return result;
}

function pixels(value: string, rootSize: number): number {
  const resolved = value.replace(/var\((--[\w-]+)\)/g, (_, token: string) => String(pixels(values.get(token)!, rootSize)));
  const expression = resolved.replace(/^calc\((.*)\)$/, '$1');
  if (/^\d+(?:\.\d+)?rem$/.test(expression)) return Number.parseFloat(expression) * rootSize;
  if (/^\d+(?:\.\d+)?px$/.test(expression)) return Number.parseFloat(expression);
  const subtraction = expression.match(/^([\d.]+) - ([\d.]+)$/);
  return subtraction ? Number(subtraction[1]) - Number(subtraction[2]) : Number(expression);
}

describe('composer text alignment', () => {
  it.each([14, 16, 18])('keeps queued text and its more row aligned while reserving the handle at a %ipx root size', (rootSize) => {
    const queue = declarations('.pending-queue-row').get('padding-left')!;
    const more = declarations('.pending-queue-more').get('padding-left')!;
    const gutter = pixels(values.get('--space-1')!, rootSize);
    const queueInset = pixels(values.get('--queue-content-inset')!, rootSize);
    expect(gutter + pixels(queue, rootSize)).toBe(queueInset);
    expect(gutter + pixels(more, rootSize)).toBe(queueInset);
  });

  it('uses the reference input inset without inheriting the queue handle space', () => {
    const editorInset = pixels(declarations('.composer-content-inset').get('padding-inline')!, 16);
    expect(editorInset).toBe(11);
    expect(pixels(values.get('--queue-content-inset')!, 16)).toBe(36);
    const surfaceInset = pixels(declarations('.composer-code-surface').get('left')!, 16);
    expect(surfaceInset).toBeGreaterThanOrEqual(0);
    expect(surfaceInset).toBeLessThan(editorInset);
  });

  it('puts the input, mirror, attachments, editing header and toolbar on the shared input inset', () => {
    const source = readFileSync(resolve(root, 'src/components/Composer.tsx'), 'utf8');
    expect(source).toMatch(/<textarea[\s\S]*?className="composer-content-inset /);
    expect(source).toContain('composer-content-inset flex flex-wrap');
    expect(source).toContain('composer-content-inset flex items-center justify-between');
    expect(source).toContain('composer-content-inset flex items-center justify-between gap-2 pb-2.5');
    expect(readFileSync(resolve(root, 'src/components/CodeFenceBackdrop.tsx'), 'utf8')).toContain('composer-content-inset composer-code-mirror');
    expect(source).not.toContain('px-6');
  });
});
