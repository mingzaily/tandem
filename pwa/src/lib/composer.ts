import type { Agent, ModelOption, TaskModel, TurnOptions } from './types';

export interface ComposerPreferences {
  model: string;
  effort: string;
  permission: string;
}

export const DEFAULT_PREFERENCES: ComposerPreferences = { model: '', effort: '', permission: 'default' };

export function taskPreferences(native?: TaskModel | null, permission?: string | null): ComposerPreferences {
  const mode = permission ?? 'default';
  return {
    model: native?.model ?? '',
    effort: native?.effort ?? '',
    permission: ['default', 'acceptEdits', 'auto', 'bypassPermissions'].includes(mode) ? mode : 'default',
  };
}

/** Native model IDs can resolve to an alias in the CLI's menu. */
export function selectedModel(model: string, models: ModelOption[]): ModelOption | undefined {
  return (
    models.find((option) => option.value === (model || 'default')) ??
    (model
      ? (models.find((option) => option.value !== 'default' && option.resolvedModel === model) ??
        models.find((option) => option.resolvedModel === model))
      : models[0])
  );
}

export function turnOptions(agent: Agent, prefs: ComposerPreferences, models: ModelOption[]): TurnOptions {
  const chosen = selectedModel(prefs.model, models);
  const effortFits =
    !chosen || (chosen.supportsEffort && chosen.supportedEffortLevels.includes(prefs.effort));
  const permission =
    prefs.permission === 'auto' && chosen?.supportsAutoMode === false ? 'default' : prefs.permission;
  return {
    model: prefs.model && prefs.model !== 'default' ? prefs.model : null,
    effort: effortFits && prefs.effort ? prefs.effort : null,
    permissionMode: agent === 'pi' || permission === 'default' ? null : permission,
  };
}

/** Clear the sent version while keeping a draft edited during the request. */
export function sentDraft(drafts: Record<string, string>, key: string, text: string): Record<string, string> {
  if (drafts[key] !== text) return drafts;
  const next = { ...drafts };
  delete next[key];
  return next;
}
