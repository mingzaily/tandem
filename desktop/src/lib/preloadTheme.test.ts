import { describe, expect, it } from 'vitest';
import preload from '../preload-theme.js?raw';

describe('document-start theme', () => {
  it('uses the injected appearance before the frontend or styles initialize', () => {
    const toggle = (theme: string, systemDark: boolean) => {
      const classes = new Set<string>();
      const root = { dataset: {} as Record<string, string>, classList: { toggle: (name: string, on: boolean) => { if (on) classes.add(name); else classes.delete(name); } } };
      const window = { __TANDEM_PREFERENCES__: { config: { theme, dark_theme: 'github-dark', light_theme: 'tandem-light' } }, matchMedia: () => ({ matches: systemDark }) };
      new Function('window', 'document', preload)(window, { documentElement: root });
      return { dark: classes.has('dark'), theme: root.dataset.theme };
    };
    expect(toggle('dark', false)).toEqual({ dark: true, theme: 'github-dark' });
    expect(toggle('light', true)).toEqual({ dark: false, theme: 'tandem-light' });
    expect(toggle('system', true)).toEqual({ dark: true, theme: 'github-dark' });
  });

  it('applies as soon as WebKit creates the HTML element', () => {
    let changed!: () => void;
    let disconnected = false;
    const document = { documentElement: null as null | { dataset: Record<string, string>; classList: { toggle: () => void } } };
    class Observer { constructor(callback: () => void) { changed = callback; } observe() {} disconnect() { disconnected = true; } }
    new Function('window', 'document', 'MutationObserver', preload)({ __TANDEM_PREFERENCES__: { config: { theme: 'dark', dark_theme: 'tandem-dark' } } }, document, Observer);
    document.documentElement = { dataset: {}, classList: { toggle: () => {} } };
    changed();
    expect(document.documentElement.dataset.theme).toBe('tandem-dark');
    expect(disconnected).toBe(true);
  });
});
