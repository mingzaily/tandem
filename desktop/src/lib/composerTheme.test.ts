import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';
import { DARK_THEMES, LIGHT_THEMES, type ThemeChoice } from './settings';

const root = resolve(import.meta.dirname, '../..');
const sheets = ['colors.css', 'theme.css', 'themes.css'].map((file) => postcss.parse(readFileSync(resolve(root, 'design/tokens', file), 'utf8')));
const css = postcss.parse(readFileSync(resolve(root, 'src/styles/app.css'), 'utf8'));
const surface = new Map<string, string>();
css.walkRules('.composer-code-surface', (rule) => { rule.walkDecls((decl) => { surface.set(decl.prop, decl.value); }); });

type Color = [number, number, number, number];
function palette(theme: ThemeChoice) {
  const values = new Map<string, string>();
  for (const sheet of sheets) sheet.walkRules((rule) => {
    if (!rule.selectors.some((selector) => selector === ':root' || selector === '.dark' && theme.isDark || selector === `[data-theme="${theme.id}"]`)) return;
    rule.walkDecls((decl) => { values.set(decl.prop, decl.value); });
  });
  const expand = (text: string): string => text.replace(/var\((--[\w-]+)\)/g, (_, token: string) => {
    const value = values.get(token);
    if (!value) throw new Error(`Missing ${token} in ${theme.id}`);
    return expand(value);
  });
  return (value: string) => color(expand(value));
}
function color(text: string): Color {
  const hex = /^#([\da-f]{6})$/i.exec(text);
  if (hex) return [parseInt(hex[1].slice(0, 2), 16), parseInt(hex[1].slice(2, 4), 16), parseInt(hex[1].slice(4, 6), 16), 1];
  const rgba = /^rgba?\(([^)]+)\)$/.exec(text);
  if (rgba) {
    const [r, g, b, a = 1] = rgba[1].split(',').map(Number);
    return [r, g, b, a];
  }
  const mix = /^color-mix\(in srgb, (.+) ([\d.]+)%, (.+)\)$/.exec(text);
  if (mix) {
    const a = color(mix[1]), b = color(mix[3]), weight = Number(mix[2]) / 100;
    const alpha = a[3] * weight + b[3] * (1 - weight);
    return [0, 1, 2].map((index) => (a[index] * a[3] * weight + b[index] * b[3] * (1 - weight)) / alpha).concat(alpha) as Color;
  }
  throw new Error(`Unsupported theme color ${text}`);
}
const over = (front: Color, back: Color): Color => [0, 1, 2].map((index) => front[index] * front[3] + back[index] * (1 - front[3])).concat(1) as Color;
const luminance = (value: Color) => value.slice(0, 3).map((channel) => channel / 255).map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
function contrast(text: Color, background: Color) {
  const a = luminance(over(text, background)), b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe('composer code colors follow the active theme', () => {
  it.each([...LIGHT_THEMES, ...DARK_THEMES])('$id keeps the code surface distinct and its theme text readable', (theme) => {
    const read = palette(theme);
    const input = read('var(--chat-input-bg)');
    const code = over(read(surface.get('background')!), input);
    const text = read('var(--chat-input-text)');
    const distance = Math.max(...code.slice(0, 3).map((channel, index) => Math.abs(channel - input[index])));
    expect(distance).toBeGreaterThan(4);
    // Preserve theme foreground legibility, including palettes with softer input text.
    expect(contrast(text, code)).toBeGreaterThanOrEqual(Math.min(4.5, contrast(text, input) * 0.85));
    expect(read('var(--chat-input-chip-border)')[3]).toBeGreaterThan(0);
  });
});
