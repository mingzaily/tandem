import type { ModelOption, TurnOptions, UsageWindow } from './api';
import { t } from './i18n';

export type PermissionMode = 'ask' | 'acceptEdits' | 'auto' | 'bypassPermissions';

export interface TurnPrefs {
  model: string | null;
  effort: string | null;
  permissionMode: PermissionMode;
}

export const DEFAULT_PREFS: TurnPrefs = { model: null, effort: null, permissionMode: 'ask' };

/** Leaves out whatever the chosen model cannot do, so the CLI never rejects the turn. */
export function turnOptions(prefs: TurnPrefs, models: ModelOption[]): TurnOptions {
  const model = models.find((option) => option.value === (prefs.model ?? 'default'));
  const effortFits = !model || (model.supportsEffort && model.supportedEffortLevels.includes(prefs.effort ?? ''));
  const autoFits = !model || model.supportsAutoMode;
  const mode = prefs.permissionMode === 'auto' && !autoFits ? 'ask' : prefs.permissionMode;
  return {
    model: prefs.model,
    effort: effortFits ? prefs.effort : null,
    permissionMode: mode === 'ask' ? null : mode,
  };
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = String(total % 60);
  const minutes = Math.floor(total / 60);
  if (minutes === 0) return t('elapsedSeconds', { seconds });
  if (minutes < 60) return t('elapsedMinutes', { minutes: String(minutes), seconds });
  return t('elapsedHours', { hours: String(Math.floor(minutes / 60)), minutes: String(minutes % 60) });
}

export function formatTokens(tokens: number): string {
  if (tokens < 1000) return String(tokens);
  const thousands = tokens / 1000;
  if (thousands < 1000) return `${Number(thousands.toFixed(thousands < 10 ? 1 : 0))}k`;
  return `${Number((thousands / 1000).toFixed(1))}M`;
}

export function resetTimeMs(window: UsageWindow): number | null {
  const { resetsAt } = window;
  if (resetsAt === null) return null;
  const at = typeof resetsAt === 'number' ? resetsAt * 1000 : Date.parse(resetsAt);
  return Number.isNaN(at) ? null : at;
}

/** "4小时 剩余 97%": how long until the window resets, and how much of it is left. */
export function describeUsage(window: UsageWindow, now: number): { text: string; low: boolean } | null {
  const at = resetTimeMs(window);
  if (at === null) return null;
  const minutes = Math.max(1, Math.floor((at - now) / 60_000));
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const label =
    days > 0
      ? t('windowDays', { count: String(days) })
      : hours > 0
        ? t('windowHours', { count: String(hours) })
        : t('windowMinutes', { count: String(minutes) });
  const remaining = Math.round(100 - Math.min(100, Math.max(0, window.usedPercent)));
  return { text: t('usageRemaining', { window: label, percent: String(remaining) }), low: remaining <= 20 };
}

export function contextPercent(usedTokens: number, windowTokens: number): number {
  if (windowTokens <= 0) return 0;
  return Math.min(100, Math.round((usedTokens / windowTokens) * 100));
}
