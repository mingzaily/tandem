import {
  Check,
  ChevronDown,
  CodeXml,
  Folder,
  FolderPlus,
  Gauge,
  GitBranch,
  MessagesSquare,
  Hand,
  Monitor,
  Sparkles,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Agent, ModelOption, UsageWindows } from '../lib/api';
import {
  contextPercent,
  describeUsage,
  formatTokens,
  type PermissionMode,
  type TurnPrefs,
} from '../lib/composerStatus';
import { hasString, t, type StringKey } from '../lib/i18n';
import { CONVERSATION_CWD, projectName } from '../lib/items';
import { AgentMark } from './AgentMark';
import { ComposerMenu, MENU_ROW } from './ComposerMenu';

const MODES: { id: PermissionMode; label: StringKey; hint: StringKey; icon: LucideIcon; tone?: string }[] = [
  { id: 'ask', label: 'modeAsk', hint: 'modeAskHint', icon: Hand },
  { id: 'acceptEdits', label: 'modeAcceptEdits', hint: 'modeAcceptEditsHint', icon: CodeXml },
  {
    id: 'auto',
    label: 'modeAuto',
    hint: 'modeAutoHint',
    icon: Sparkles,
    tone: 'text-[var(--perm-auto-selected-text)]',
  },
  {
    id: 'bypassPermissions',
    label: 'modeBypass',
    hint: 'modeBypassHint',
    icon: TriangleAlert,
    tone: 'text-[var(--perm-bypass-selected-text)]',
  },
];

interface SelectProps {
  agent: Agent;
  prefs: TurnPrefs;
  models: ModelOption[];
  disabled?: boolean;
  onChange: (prefs: TurnPrefs) => void;
}

const selectedModel = (prefs: TurnPrefs, models: ModelOption[]) =>
  models.find((option) => option.value === (prefs.model ?? 'default'));

const CODEX_HINTS: Partial<Record<PermissionMode, StringKey>> = {
  ask: 'modeAskHintCodex',
  auto: 'modeAutoHintCodex',
  bypassPermissions: 'modeBypassHintCodex',
};

/** Pi never asks, so there is nothing to choose. Saying so beats a menu with one choice. */
export function PermissionSelect(props: SelectProps) {
  if (props.agent === 'pi') {
    return (
      <span title={t('modePiHint')} className="inline-flex h-[30px] min-w-0 items-center gap-1 px-2.5 text-13 text-[var(--text-secondary)]">
        <Hand size={15} strokeWidth={1.8} aria-hidden className="shrink-0" />
        <span className="truncate">{t('modePi')}</span>
      </span>
    );
  }
  return <PermissionMenu {...props} />;
}

function PermissionMenu({ agent, prefs, models, disabled, onChange }: SelectProps) {
  const modes = agent === 'codex' ? MODES.filter((mode) => mode.id !== 'acceptEdits') : MODES;
  const hintFor = (mode: (typeof MODES)[number]) => t((agent === 'codex' && CODEX_HINTS[mode.id]) || mode.hint);
  const [confirming, setConfirming] = useState(false);
  const autoUnavailable = selectedModel(prefs, models)?.supportsAutoMode === false;
  const activeId = prefs.permissionMode === 'auto' && autoUnavailable ? 'ask' : prefs.permissionMode;
  const active = modes.find((mode) => mode.id === activeId) ?? modes[0];
  const ActiveIcon = active.icon;

  return (
    <ComposerMenu
      label={t('permissionModes')}
      title={hintFor(active)}
      width={224}
      disabled={disabled}
      triggerClassName={active.tone ?? 'text-[var(--text-primary)]'}
      trigger={
        <>
          <ActiveIcon size={15} strokeWidth={1.8} aria-hidden className="shrink-0" />
          <span className="truncate">{t(active.label)}</span>
          <ChevronDown size={13} aria-hidden className="shrink-0" />
        </>
      }
    >
      {(close) =>
        confirming ? (
          <div className="p-2">
            <p className="text-13 font-medium text-[var(--perm-bypass-selected-text)]">{t('modeBypassConfirm')}</p>
            <p className="mt-1 text-12 leading-[1.5] text-[var(--text-secondary)]">{agent === 'codex' ? t('modeBypassHintCodex') : t('modeBypassHint')}</p>
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="h-7 rounded-full border border-[var(--border-default)] px-3 text-12 text-[var(--text-primary)] hover:bg-[var(--cmd-palette-item-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
              >
                {t('modeCancel')}
              </button>
              <button
                type="button"
                onClick={() => {
                  onChange({ ...prefs, permissionMode: 'bypassPermissions' });
                  setConfirming(false);
                  close();
                }}
                className="h-7 rounded-full bg-[var(--send-btn-bg)] px-3 text-12 text-[var(--send-btn-icon)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
              >
                {t('modeBypassEnable')}
              </button>
            </div>
          </div>
        ) : (
          <ul role="listbox" aria-label={t('permissionModes')} className="flex flex-col gap-0.5">
            {modes.map((mode) => {
              const Icon = mode.icon;
              const isSelected = mode.id === active.id;
              return (
                <li key={mode.id} role="option" aria-selected={isSelected}>
                  <button
                    type="button"
                    title={hintFor(mode)}
                    disabled={mode.id === 'auto' && autoUnavailable}
                    onClick={() => {
                      if (mode.id === 'bypassPermissions' && !isSelected) {
                        setConfirming(true);
                        return;
                      }
                      onChange({ ...prefs, permissionMode: mode.id });
                      close();
                    }}
                    className={`${MENU_ROW} ${isSelected ? `font-medium ${mode.tone ?? ''}` : ''}`}
                  >
                    <Icon size={17} strokeWidth={1.8} aria-hidden className="shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{t(mode.label)}</span>
                    {isSelected ? <Check size={13} aria-hidden className="shrink-0 text-[var(--model-item-check)]" /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )
      }
    </ComposerMenu>
  );
}

const AGENT_NAMES: Record<Agent, string> = { claude: 'Claude Code', codex: 'Codex', pi: 'Pi' };

/** "default" has no name of its own, so it shows the model it stands for. */
function triggerName(model: ModelOption | undefined, models: ModelOption[], agent: Agent): string {
  if (!model) return AGENT_NAMES[agent];
  if (model.value !== 'default') return model.displayName;
  const same = models.find((option) => option.value !== 'default' && option.resolvedModel === model.resolvedModel);
  return same?.displayName ?? t('modelDefault');
}

interface OtherAgent {
  agent: Agent;
  prefs: TurnPrefs;
  models: ModelOption[];
  usage: UsageWindows | null;
  /** Choosing a model here also makes this the agent for the new task. */
  onChoose: (prefs: TurnPrefs) => void;
  onPrefsChange: (prefs: TurnPrefs) => void;
}

interface ModelSelectProps extends SelectProps {
  usage: UsageWindows | null;
  /** A new task can still use another agent. An existing task stays with its own. */
  others?: OtherAgent[];
}

const effortLabel = (level: string) => {
  const key = `effort_${level}`;
  return hasString(key) ? t(key) : level;
};

const MODEL_PANEL_HEIGHT_PX = 440;
const MODEL_PANEL_WIDTH_PX = 372;
const MODEL_PANEL_WIDTH_WITH_RAIL_PX = 420;
const MODEL_PANEL_BODY = 'flex overflow-hidden';

/** A notched track, with the first stop for "let the CLI decide". */
/** The level to show for a model: what was chosen if it has that, or what it runs at by itself. */
function effectiveEffort(model: ModelOption | undefined, chosen: string | null | undefined): string | null {
  const levels = model?.supportedEffortLevels ?? [];
  if (chosen && levels.includes(chosen)) return chosen;
  return model?.defaultEffort && levels.includes(model.defaultEffort) ? model.defaultEffort : null;
}

/**
 * Every stop is a real level. Landing on the model's own one chooses nothing, so the CLI's config
 * keeps deciding. A separate "default" stop exists only while that level could not be read.
 */
function EffortSlider({
  levels,
  value,
  defaultLevel,
  onChange,
}: {
  levels: string[];
  value: string | null;
  defaultLevel: string | null;
  onChange: (level: string | null) => void;
}) {
  const stops: (string | null)[] = defaultLevel ? levels : [null, ...levels];
  const shown = value ?? defaultLevel;
  const index = Math.max(0, stops.indexOf(shown));
  const last = stops.length - 1;
  const label = shown ? effortLabel(shown) : t('effortDefault');
  const change = (level: string | null) => onChange(level === defaultLevel ? null : level);
  const percent = (index / last) * 100;
  const track = useRef<HTMLDivElement>(null);

  const pick = (clientX: number) => {
    if (!track.current) return;
    const { left, width } = track.current.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - left) / width));
    change(stops[Math.round(ratio * last)]);
  };

  return (
    <div className="shrink-0 border-t border-[var(--model-dropdown-border)] px-3 pb-2.5 pt-2">
      <div className="flex items-center justify-between text-12 leading-[1.33]">
        <span className="font-medium text-[var(--cmd-palette-item-meta)]">{t('effortMenu')}</span>
        <span className="text-[var(--text-secondary)]">
          {label}
          {shown && !value ? ` · ${t('effortDefault')}` : ''}
        </span>
      </div>
      <div
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label={t('effortMenu')}
        aria-valuemin={0}
        aria-valuemax={last}
        aria-valuenow={index}
        aria-valuetext={label}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          pick(event.clientX);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) pick(event.clientX);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' && index > 0) change(stops[index - 1]);
          if (event.key === 'ArrowRight' && index < last) change(stops[index + 1]);
        }}
        className="relative mx-2 mt-1 flex h-[26px] cursor-pointer touch-none items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
      >
        <div className="absolute -inset-x-2 h-3 rounded-full bg-[var(--slider-track)]" />
        <div className="absolute -left-2 h-3 rounded-full bg-[var(--slider-fill)]" style={{ width: `calc(${percent}% + 8px)` }} />
        {stops.map((stop, stopIndex) => (
          <span
            key={stop ?? 'default'}
            aria-hidden
            className="absolute size-[5px] -translate-x-1/2 rounded-full"
            style={{
              left: `${(stopIndex / last) * 100}%`,
              backgroundColor: 'color-mix(in srgb, var(--model-dropdown-bg) 65%, transparent)',
            }}
          />
        ))}
        <span
          aria-hidden
          className="absolute size-4 -translate-x-1/2 rounded-full bg-[var(--slider-thumb)]"
          style={{ left: `${percent}%`, boxShadow: 'var(--slider-thumb-shadow)' }}
        />
      </div>
    </div>
  );
}

function RailButton({ agent, usage, isActive, onClick }: { agent: Agent; usage: UsageWindows | null; isActive: boolean; onClick: () => void }) {
  const used = (usage?.sevenDay ?? usage?.fiveHour)?.usedPercent;
  return (
    <button
      type="button"
      aria-label={AGENT_NAMES[agent]}
      title={AGENT_NAMES[agent]}
      aria-pressed={isActive}
      onClick={onClick}
      className={`relative flex h-[38px] w-[34px] shrink-0 flex-col items-center justify-center rounded-[9px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] ${
        isActive
          ? 'bg-[var(--accent-cta-bg)] text-[var(--accent-pure-cta-fg)] shadow-[var(--shadow-menu)]'
          : 'text-[var(--text-tertiary)] hover:bg-[var(--model-item-hover)] hover:text-[var(--text-secondary)]'
      }`}
    >
      <span className="flex h-6 items-center justify-center">
        <AgentMark agent={agent} size={16} />
      </span>
      {used === undefined ? null : (
        <span
          aria-hidden
          className="absolute bottom-[3px] h-[3px] w-[22px] overflow-hidden rounded-full"
          style={{ backgroundColor: 'color-mix(in srgb, currentColor 18%, transparent)' }}
        >
          <span className="block h-full rounded-full bg-current" style={{ width: `${100 - Math.min(100, used)}%` }} />
        </span>
      )}
    </button>
  );
}

/**
 * The CLI reports "default" as a model of its own, which is the same as one of the others. It gets
 * no row unless nothing else matches, and choosing the matching row keeps following the CLI's config.
 */
function modelRowsOf(models: ModelOption[]) {
  const fallback = models.find((option) => option.value === 'default');
  const hasTwin = models.some((option) => option.value !== 'default' && option.resolvedModel === fallback?.resolvedModel);
  return {
    rows: hasTwin ? models.filter((option) => option !== fallback) : models,
    followsConfig: (option: ModelOption) => option === fallback || (hasTwin && option.resolvedModel === fallback?.resolvedModel),
  };
}

/** One highlight slides between rows instead of each row fading its own background. */
function useRowGlide() {
  const layer = useRef<HTMLSpanElement>(null);
  const activeRow = useRef<HTMLElement | null>(null);

  const setActive = (row: HTMLElement | null) => {
    activeRow.current?.removeAttribute('data-menu-active');
    row?.setAttribute('data-menu-active', '');
    activeRow.current = row;
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>('[data-menu-row]');
    const element = layer.current;
    if (!element || !row || row === activeRow.current) return;
    const isFirst = element.style.opacity !== '1';
    element.style.transition = isFirst ? 'none' : '';
    element.style.width = `${row.offsetWidth}px`;
    element.style.height = `${row.offsetHeight}px`;
    element.style.transform = `translate(${row.offsetLeft}px, ${row.offsetTop}px)`;
    element.style.opacity = '1';
    setActive(row);
  };
  const onPointerLeave = () => {
    if (layer.current) layer.current.style.opacity = '0';
    setActive(null);
  };
  return { layer, handlers: { onPointerMove, onPointerLeave } };
}

export function ModelSelect({ agent, prefs, models, usage, disabled, onChange, others = [] }: ModelSelectProps) {
  const model = selectedModel(prefs, models);
  const levels = model?.supportsEffort ? model.supportedEffortLevels : [];
  const effort = effectiveEffort(model, prefs.effort);
  const available = others.filter((other) => other.models.length > 0);
  const hasOther = available.length > 0;
  const [viewedAgent, setViewedAgent] = useState<Agent>(agent);
  useEffect(() => setViewedAgent(agent), [agent]);

  const other = available.find((candidate) => candidate.agent === viewedAgent);
  const isViewingOther = other !== undefined;
  const viewedModels = other ? other.models : models;
  const viewedPrefs = other ? other.prefs : prefs;
  const viewedModel = selectedModel(viewedPrefs, viewedModels);
  const viewedLevels = viewedModel?.supportsEffort ? viewedModel.supportedEffortLevels : [];
  const viewedEffort = viewedPrefs.effort && viewedLevels.includes(viewedPrefs.effort) ? viewedPrefs.effort : null;
  const viewedDefault = effectiveEffort(viewedModel, null);
  const { rows: modelRows, followsConfig } = modelRowsOf(viewedModels);
  const glide = useRowGlide();
  const choose = (next: TurnPrefs) => (other ? other.onChoose(next) : onChange(next));
  const changeViewedPrefs = (next: TurnPrefs) => (other ? other.onPrefsChange(next) : onChange(next));

  return (
    <ComposerMenu
      label={t('modelMenu')}
      align="right"
      width={hasOther ? MODEL_PANEL_WIDTH_WITH_RAIL_PX : MODEL_PANEL_WIDTH_PX}
      panelMaxHeight={MODEL_PANEL_HEIGHT_PX}
      bodyClassName={MODEL_PANEL_BODY}
      disabled={disabled || (models.length === 0 && !hasOther)}
      trigger={
        <>
          <AgentMark agent={agent} size={13} className="mr-0.5 shrink-0 text-[var(--model-trigger-text)]" />
          <span className="truncate text-[var(--model-trigger-text)]">{triggerName(model, models, agent)}</span>
          {levels.length > 0 ? (
            <span className="ml-1 inline-flex shrink-0 items-center gap-1 text-[var(--model-trigger-meta)]">
              <Gauge size={13} strokeWidth={1.8} aria-hidden />
              {effort ? effortLabel(effort) : t('effortDefault')}
            </span>
          ) : null}
          <ChevronDown size={13} aria-hidden className="shrink-0 text-[var(--model-trigger-arrow)]" />
        </>
      }
    >
      {(close) => (
        <>
          {hasOther ? (
            <div className="flex min-h-0 w-12 shrink-0 flex-col items-center gap-0.5 overflow-y-auto border-r border-[var(--model-dropdown-border)] px-1.5 py-2">
              <RailButton agent={agent} usage={usage} isActive={!isViewingOther} onClick={() => setViewedAgent(agent)} />
              {available.map((candidate) => (
                <RailButton
                  key={candidate.agent}
                  agent={candidate.agent}
                  usage={candidate.usage}
                  isActive={viewedAgent === candidate.agent}
                  onClick={() => setViewedAgent(candidate.agent)}
                />
              ))}
            </div>
          ) : null}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <ul
              role="listbox"
              aria-label={AGENT_NAMES[viewedAgent]}
              {...glide.handlers}
              className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overscroll-contain p-2 pb-3"
            >
              <span
                ref={glide.layer}
                aria-hidden
                className="pointer-events-none absolute left-0 top-0 rounded-lg bg-[hsl(var(--sidebar-item-hover))] opacity-0 transition-[transform,opacity] duration-[var(--motion-instant)] ease-[var(--motion-ease-out)]"
              />
              {modelRows.map((option) => {
                const isSelected = viewedPrefs.model ? option.value === viewedPrefs.model : followsConfig(option);
                const name = option.value === 'default' ? t('modelDefault') : option.displayName;
                const description = option.description;
                const rowEffort = option.supportsEffort ? effectiveEffort(option, viewedPrefs.effort) : null;
                return (
                  <li key={option.value} role="option" aria-selected={isSelected}>
                    <button
                      type="button"
                      onClick={() => {
                        choose({ ...viewedPrefs, model: followsConfig(option) ? null : option.value });
                        close();
                      }}
                      data-menu-row
                      className={`relative flex w-full flex-col rounded-lg px-3 py-2 text-left text-[var(--model-item-text)] transition-colors duration-[var(--motion-instant)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] ${
                        isSelected ? 'bg-[hsl(var(--sidebar-item-hover))] data-[menu-active]:bg-transparent' : ''
                      }`}
                    >
                      <span className="flex w-full items-center gap-2">
                        <span className="flex size-[18px] shrink-0 items-center justify-center text-[var(--text-secondary)]">
                          <AgentMark agent={viewedAgent} size={14} />
                        </span>
                        <span title={name} className="min-w-0 truncate text-14 font-medium leading-5">
                          {name}
                        </span>
                        {rowEffort ? (
                          <span className="ml-auto shrink-0 text-12 text-[var(--text-tertiary)]">{effortLabel(rowEffort)}</span>
                        ) : null}
                      </span>
                      {description ? (
                        <span title={description} className="block max-w-[30ch] truncate pl-[26px] pt-px text-12 leading-[1.4] text-[var(--model-item-desc)]">
                          {description}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
            {viewedLevels.length > 0 ? (
              <EffortSlider levels={viewedLevels} value={viewedEffort} defaultLevel={viewedDefault} onChange={(level) => changeViewedPrefs({ ...viewedPrefs, effort: level })} />
            ) : null}
          </div>
        </>
      )}
    </ComposerMenu>
  );
}

export interface ProjectPicker {
  value: string | null;
  options: string[];
  onChange: (cwd: string) => void;
  onAddProject: () => void;
}

const PROJECT_PILL =
  'max-w-[220px] gap-1.5 !border-[var(--create-agent-control-border)] !bg-[var(--create-agent-control-bg)] !px-3 text-12 font-medium text-[var(--create-agent-control-text)] enabled:hover:!bg-[var(--create-agent-control-bg-hover)]';

export function ProjectSelect({ value, options, onChange, onAddProject }: ProjectPicker) {
  return (
    <ComposerMenu
      label={t('chooseProject')}
      title={value === CONVERSATION_CWD ? t('conversations') : (value ?? undefined)}
      width={280}
      align="right"
      side="below"
      triggerClassName={PROJECT_PILL}
      trigger={
        <>
          {value === CONVERSATION_CWD ? (
            <MessagesSquare size={12} strokeWidth={2} aria-hidden className="shrink-0 text-[var(--create-agent-control-icon)]" />
          ) : (
            <Folder size={12} strokeWidth={2} aria-hidden className="shrink-0 text-[var(--create-agent-control-icon)]" />
          )}
          <span className="truncate">{value === CONVERSATION_CWD ? t('conversations') : value ? projectName(value) : t('chooseProject')}</span>
          <ChevronDown size={12} strokeWidth={2} aria-hidden className="shrink-0 text-[var(--create-agent-control-icon)]" />
        </>
      }
    >
      {(close) => (
        <>
          <ul role="listbox" aria-label={t('chooseProject')} className="flex flex-col gap-0.5">
            <li role="option" aria-selected={value === CONVERSATION_CWD}>
              <button
                type="button"
                onClick={() => {
                  onChange(CONVERSATION_CWD);
                  close();
                }}
                className={MENU_ROW}
              >
                <MessagesSquare size={14} strokeWidth={1.8} aria-hidden className="shrink-0 text-[var(--cmd-palette-item-icon)]" />
                <span className="min-w-0 flex-1 truncate">{t('conversations')}</span>
                {value === CONVERSATION_CWD ? <Check size={13} aria-hidden className="shrink-0" /> : null}
              </button>
            </li>
            {options.map((cwd) => (
            <li key={cwd} role="option" aria-selected={cwd === value}>
              <button
                type="button"
                title={cwd}
                onClick={() => {
                  onChange(cwd);
                  close();
                }}
                className={MENU_ROW}
              >
                <Folder size={14} strokeWidth={1.8} aria-hidden className="shrink-0 text-[var(--cmd-palette-item-icon)]" />
                <span className="min-w-0 flex-1 truncate">{projectName(cwd)}</span>
                {cwd === value ? <Check size={13} aria-hidden className="shrink-0" /> : null}
              </button>
            </li>
            ))}
          </ul>
          <div className="my-1 border-t border-[var(--border-default)]" />
          <button
            type="button"
            onClick={() => {
              close();
              onAddProject();
            }}
            className={MENU_ROW}
          >
            <FolderPlus size={14} strokeWidth={1.8} aria-hidden className="shrink-0 text-[var(--cmd-palette-item-icon)]" />
            <span className="min-w-0 flex-1 truncate">{t('addProject')}</span>
          </button>
        </>
      )}
    </ComposerMenu>
  );
}

interface BranchPillProps {
  branch: string;
  /** Only Claude Code can start a task in a worktree from here. */
  canUseWorktree: boolean;
  worktree: boolean;
  onWorktreeChange: (worktree: boolean) => void;
}

/** The branch is shown, not changed: switching it could disturb work in the checkout. */
export function BranchPill({ branch, canUseWorktree, worktree, onWorktreeChange }: BranchPillProps) {
  return (
    <span className="inline-flex h-[30px] min-w-0 max-w-[260px] items-center gap-1.5 rounded-full border border-[var(--create-agent-control-border)] bg-[var(--create-agent-control-bg)] px-3 text-12 font-medium text-[var(--create-agent-control-text)]">
      <GitBranch size={12} strokeWidth={2} aria-hidden className="shrink-0 text-[var(--create-agent-control-icon)]" />
      <span title={branch} className="min-w-0 truncate">{branch}</span>
      {canUseWorktree ? (
        <>
          <span aria-hidden className="mx-0.5 h-3 w-px shrink-0 bg-[var(--create-agent-control-border)]" />
          <label title={t('worktreeToggle')} className="flex shrink-0 cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              aria-label={t('worktreeToggle')}
              checked={worktree}
              onChange={(event) => onWorktreeChange(event.target.checked)}
              className="size-3.5 accent-[var(--switch-track-on)]"
            />
            worktree
          </label>
        </>
      ) : null}
    </span>
  );
}

/** The countdown shows minutes at its finest. */
const USAGE_CLOCK_MS = 60_000;

function UsageChip({ usage }: { usage: UsageWindows | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const clock = window.setInterval(() => setNow(Date.now()), USAGE_CLOCK_MS);
    return () => window.clearInterval(clock);
  }, [usage]);
  const parts = [usage?.fiveHour, usage?.sevenDay]
    .map((window) => (window ? describeUsage(window, now) : null))
    .filter((part) => part !== null);
  if (parts.length === 0) return null;
  return (
    <span className="flex items-center gap-2 text-12 font-medium leading-none tabular-nums text-[var(--msg-tool-card-chevron)]">
      {parts.map((part, index) => (
        <span key={index} className="flex items-center gap-2">
          {index > 0 ? <span aria-hidden className="h-3 w-px bg-[var(--border-default)]" /> : null}
          <span className={part.low ? 'text-[var(--error-fg)]' : undefined}>{part.text}</span>
        </span>
      ))}
    </span>
  );
}

const RING_SIZE = 20;
const RING_STROKE = 2.5;

function contextColor(percent: number): string {
  if (percent > 90) return 'var(--error-flat)';
  return percent > 70 ? 'var(--warning-fg)' : 'var(--msg-tool-card-chevron)';
}

function ContextRing({ usedTokens, windowTokens, onCompact }: ContextProps) {
  const percent = contextPercent(usedTokens, windowTokens);
  const radius = (RING_SIZE - RING_STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  const color = contextColor(percent);
  const center = RING_SIZE / 2;
  const level = percent > 90 ? 'contextNearLimit' : percent > 70 ? 'contextElevated' : 'contextAvailable';
  return (
    <ComposerMenu
      label={t('contextTitle')}
      title={t('contextRing', { used: formatTokens(usedTokens), total: formatTokens(windowTokens), percent: String(percent) })}
      width={300}
      align="right"
      triggerClassName="!h-6 gap-1 !px-1.5 text-12 font-medium leading-none tabular-nums text-[var(--msg-tool-card-chevron)] hover:bg-[var(--surface-hover)]"
      bodyClassName="flex flex-col gap-3 p-4"
      trigger={
        <>
          <svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`} aria-hidden className="-rotate-90">
            <circle cx={center} cy={center} r={radius} fill="none" stroke="var(--msg-tool-card-border)" strokeWidth={RING_STROKE} />
            <circle
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke={color}
              strokeWidth={RING_STROKE}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - percent / 100)}
            />
          </svg>
          {percent}%
        </>
      }
    >
      {(close) => (
        <>
          <div className="flex flex-col gap-1">
            <h3 className="text-14 font-medium text-[var(--text-primary)]">{t('contextTitle')}</h3>
            <p className="text-12 leading-relaxed text-[var(--text-secondary)]">{t('contextMeaning')}</p>
          </div>
          <div>
            <div className="flex items-end justify-between gap-3">
              <span className="flex items-baseline gap-1 tabular-nums text-[var(--text-primary)]">
                <span className="text-[26px] font-medium leading-none tracking-tight">{percent}</span>
                <span className="text-14">%</span>
                <span className="ml-1 text-12 text-[var(--text-secondary)]">{t('contextUsed')}</span>
              </span>
              <span className="text-12 font-medium" style={{ color }}>
                {t(level)}
              </span>
            </div>
            <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-[var(--msg-tool-card-border)]">
              <div className="h-full rounded-full" style={{ width: `${percent}%`, backgroundColor: color }} />
            </div>
            <p className="mt-2 text-12 tabular-nums text-[var(--text-secondary)]">
              {t('contextTokens', { used: formatTokens(usedTokens), total: formatTokens(windowTokens) })}
            </p>
          </div>
          <div className="border-t border-[var(--border-default)] pt-3">
            {onCompact ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    close();
                    onCompact();
                  }}
                  className="inline-flex h-8 items-center rounded-full border border-[var(--settings-theme-card-border)] px-3 text-13 text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                >
                  {t('contextCompact')}
                </button>
                <p className="mt-2 text-12 leading-relaxed text-[var(--text-secondary)]">{t('contextCompactHelp')}</p>
              </>
            ) : (
              <p className="text-12 leading-relaxed text-[var(--text-secondary)]">{t('contextAutoHelp')}</p>
            )}
          </div>
        </>
      )}
    </ComposerMenu>
  );
}

interface ContextProps {
  usedTokens: number;
  windowTokens: number;
  /** Missing where the CLI manages this itself, or while the task cannot take a turn. */
  onCompact?: () => void;
}

interface ComposerFooterProps {
  /** The new task page picks its project above the input box, so it passes none. */
  cwd: string | null;
  /** Shown in place of the folder's name, which means nothing for a conversation. */
  label?: string;
  usage: UsageWindows | null;
  context: { usedTokens: number; windowTokens: number } | null;
  onCompact?: () => void;
}

/** The line under the input box: where the task runs, plan usage and context. */
export function ComposerFooter({ cwd, label, usage, context, onCompact }: ComposerFooterProps) {
  return (
    <div className="mt-2 flex min-h-6 items-center justify-between gap-3 px-1">
      <span title={cwd ?? undefined} className="flex min-w-0 items-center gap-1.5">
        {cwd ? (
          <>
            <Monitor size={12} aria-hidden className="shrink-0 text-[var(--workingdir-icon)]" />
            <span className="truncate text-12 font-medium leading-none text-[var(--workingdir-text)]">
              {label ?? projectName(cwd)}
            </span>
          </>
        ) : null}
      </span>
      <div className="flex shrink-0 items-center gap-3">
        <UsageChip usage={usage} />
        {context ? <ContextRing {...context} onCompact={onCompact} /> : null}
      </div>
    </div>
  );
}

