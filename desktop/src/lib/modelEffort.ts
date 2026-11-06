import type { ModelOption } from './api';
import { hasString, t } from './i18n';

export interface ModelReadState { loading: boolean; error: string | null }

export function effortLabel(level: string): string {
  const key = `effort_${level}`;
  return hasString(key) ? t(key) : level;
}

export function effectiveEffort(model: ModelOption | undefined, chosen: string | null | undefined): string | null {
  const levels = model?.supportedEffortLevels ?? [];
  if (chosen && levels.includes(chosen)) return chosen;
  return model?.defaultEffort && levels.includes(model.defaultEffort) ? model.defaultEffort : null;
}

export const effortStops = (levels: string[], defaultLevel: string | null): (string | null)[] =>
  defaultLevel ? levels : [null, ...levels];

const COLORS: Record<string, string> = {
  off: 'var(--text-tertiary)', none: 'var(--text-tertiary)',
  minimal: 'var(--effort-tier-minimal)', low: 'var(--effort-tier-low)', medium: 'var(--effort-tier-medium)',
  high: 'var(--effort-tier-high)', xhigh: 'var(--effort-tier-xhigh)', max: 'var(--effort-tier-max)', ultra: 'var(--effort-tier-ultra)',
};

export const effortColor = (level: string | null): string => level ? COLORS[level] ?? 'var(--slider-fill)' : 'var(--slider-fill)';

export function effortColorAt(stops: (string | null)[], position: number): string {
  const lower = Math.floor(position);
  const upper = Math.min(stops.length - 1, lower + 1);
  return `color-mix(in srgb, ${effortColor(stops[lower])} ${(1 - (position - lower)) * 100}%, ${effortColor(stops[upper])})`;
}
