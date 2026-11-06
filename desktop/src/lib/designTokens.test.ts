// Guards the design rule that UI values come from tokens and are written the way each token needs.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const lightValues = new Map<string, string>();
// theme.css comes first because it overrides colors.css.
for (const file of ['design/tokens/theme.css', 'design/tokens/colors.css', 'design/tokens/tokens.css']) {
  const light = readFileSync(join(root, file), 'utf8').split(/\.dark \{|\[data-theme="tandem-dark"\]/)[0];
  for (const [, name, value] of light.matchAll(/^\s+(--[\w-]+): ([^;]+);/gm)) {
    if (!lightValues.has(name)) lightValues.set(name, value);
  }
}

function resolveToken(name: string): string | undefined {
  const value = lightValues.get(name);
  const alias = value?.match(/^var\((--[\w-]+)\)$/);
  return alias ? resolveToken(alias[1]) : value;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.test\./.test(entry) || !/\.(tsx|css)$/.test(entry) ? [] : [path];
  });
}

const sources = sourceFiles(join(root, 'src')).map((path) => ({
  path,
  text: readFileSync(path, 'utf8'),
}));

describe('design tokens', () => {
  it('types shadow length tokens as box shadows rather than shadow colors', () => {
    const ambiguous = sources.flatMap(({ path, text }) =>
      [...text.matchAll(/shadow-\[var\((--shadow-[\w-]+)\)\]/g)].map(([, name]) => `${path}: ${name}`),
    );
    expect(ambiguous).toEqual([]);
  });

  it('uses only tokens that exist', () => {
    const missing = sources.flatMap(({ path, text }) =>
      [...text.matchAll(/var\((--[\w-]+)/g)]
        .filter(([, name]) => !lightValues.has(name))
        .map(([, name]) => `${path}: ${name}`),
    );
    expect(missing).toEqual([]);
  });

  it('wraps tokens that hold HSL channels in hsl()', () => {
    const unwrapped = sources.flatMap(({ path, text }) =>
      [...text.matchAll(/(hsl\()?var\((--[\w-]+)\)/g)]
        .filter(([, wrapper, name]) => !wrapper && /^[\d.]+ [\d.]+% [\d.]+%/.test(resolveToken(name) ?? ''))
        .map(([, , name]) => `${path}: ${name}`),
    );
    expect(unwrapped).toEqual([]);
  });

  it('does not wrap tokens that hold whole colors in hsl()', () => {
    const wrapped = sources.flatMap(({ path, text }) =>
      [...text.matchAll(/hsl\(var\((--[\w-]+)\)/g)]
        .filter(([, name]) => /^(#|rgba?\()/.test(resolveToken(name) ?? ''))
        .map(([, name]) => `${path}: ${name}`),
    );
    expect(wrapped).toEqual([]);
  });
});
