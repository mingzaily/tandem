import type { Agent, ModelOption } from './api';
import type { TurnPrefs } from './composerStatus';

export const AGENT_NAMES: Record<Agent, string> = { claude: 'Claude Code', codex: 'Codex', pi: 'Pi' };

/** Model and strength apply together; a CLI default stays a reference to its configuration. */
export function modelPrefsFor(prefs: TurnPrefs, model: ModelOption, followsConfig: boolean, effort = prefs.effort): TurnPrefs {
  return { ...prefs, model: followsConfig ? null : model.value, effort: model.supportsEffort && model.supportedEffortLevels.includes(effort ?? '') ? effort : null };
}

/** A resolved default shares its row with the real model; choosing it follows CLI config. */
export function modelRowsOf(models: ModelOption[]) {
  const fallback = models.find((option) => option.value === 'default');
  const hasTwin = Boolean(fallback?.resolvedModel) && models.some((option) => option.value !== 'default' && option.resolvedModel === fallback?.resolvedModel);
  return {
    rows: hasTwin ? models.filter((option) => option !== fallback) : models,
    followsConfig: (option: ModelOption) => option === fallback || (hasTwin && option.resolvedModel === fallback?.resolvedModel),
  };
}
