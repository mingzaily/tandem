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
  ShieldCheck,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { lazy, Suspense, useEffect, useState } from 'react';
import type { Agent, ModelOption, UsageWindows } from '../lib/api';
import {
  contextPercent,
  describeUsage,
  formatTokens,
  type PermissionMode,
  type TurnPrefs,
} from '../lib/composerStatus';
import { t, type StringKey } from '../lib/i18n';
import { CONVERSATION_CWD, projectName } from '../lib/items';
import { AgentMark } from './AgentMark';
import type { ModelAgentChoice } from './ModelPickerPanel';
import { effectiveEffort, effortLabel, type ModelReadState } from '../lib/modelEffort';
import { AGENT_NAMES } from '../lib/modelRows';
import { ComposerMenu, MENU_ROW } from './ComposerMenu';

const MODES: { id: PermissionMode; label: StringKey; hint: StringKey; icon: LucideIcon; tone?: string }[] = [
  { id: 'ask', label: 'modeAsk', hint: 'modeAskHint', icon: Hand },
  { id: 'acceptEdits', label: 'modeAcceptEdits', hint: 'modeAcceptEditsHint', icon: CodeXml },
  {
    id: 'auto',
    label: 'modeAuto',
    hint: 'modeAutoHint',
    icon: ShieldCheck,
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

const ModelPickerPanel = lazy(() => import('./ModelPickerPanel'));

/** "default" has no name of its own, so it shows the model it stands for. */
function triggerName(model: ModelOption | undefined, models: ModelOption[], agent: Agent): string {
  if (!model) return AGENT_NAMES[agent];
  if (model.value !== 'default') return model.displayName;
  const same = model.resolvedModel ? models.find((option) => option.value !== 'default' && option.resolvedModel === model.resolvedModel) : undefined;
  return same?.displayName ?? t('modelFollowCli');
}

interface ModelSelectProps extends SelectProps {
  usage: UsageWindows | null;
  status: ModelReadState;
  onRefresh: () => void;
  /** A new task can still use another agent. An existing task stays with its own. */
  others?: ModelAgentChoice[];
}

const MODEL_PANEL_HEIGHT_PX = 560;
const MODEL_PANEL_WIDTH_PX = 372;
const MODEL_PANEL_WIDTH_WITH_RAIL_PX = 420;
const MODEL_PANEL_BODY = 'flex min-h-0 overflow-hidden';

export function ModelSelect({ agent, prefs, models, usage, status, onRefresh, disabled, onChange, others = [] }: ModelSelectProps) {
  const model = selectedModel(prefs, models);
  const levels = model?.supportsEffort ? model.supportedEffortLevels : [];
  const effort = effectiveEffort(model, prefs.effort);
  const hasOther = others.length > 0;

  return (
    <ComposerMenu
      label={t('modelMenu')}
      align="right"
      side="above"
      allowFlip={false}
      width={hasOther ? MODEL_PANEL_WIDTH_WITH_RAIL_PX : MODEL_PANEL_WIDTH_PX}
      panelMaxHeight={MODEL_PANEL_HEIGHT_PX}
      bodyClassName={MODEL_PANEL_BODY}
      disabled={disabled}
      trigger={
        <>
          <AgentMark agent={agent} size={13} className="mr-0.5 shrink-0 text-[var(--model-trigger-text)]" />
          <span className="truncate text-[var(--model-trigger-text)]">{model ? triggerName(model, models, agent) : prefs.model ?? AGENT_NAMES[agent]}</span>
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
      {(close, owner) => (
        <Suspense fallback={<div className="h-[470px] max-h-full w-full p-3 text-12 text-[var(--text-secondary)]">{t('modelLoading')}</div>}>
          <ModelPickerPanel current={{ agent, prefs, models, usage, status, onRefresh, onChoose: onChange }} others={others} owner={owner} onClose={close} />
        </Suspense>
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
    <div className="mt-2 flex min-h-6 items-center justify-between gap-3 px-3">
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

