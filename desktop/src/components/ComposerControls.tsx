import {
  Check,
  ChevronDown,
  CodeXml,
  Folder,
  Gauge,
  Hand,
  Monitor,
  Sparkles,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ModelOption, UsageWindows } from '../lib/api';
import {
  contextPercent,
  describeUsage,
  formatTokens,
  type PermissionMode,
  type TurnPrefs,
} from '../lib/composerStatus';
import { t, type StringKey } from '../lib/i18n';
import { projectName } from '../lib/items';
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
  prefs: TurnPrefs;
  models: ModelOption[];
  disabled?: boolean;
  onChange: (prefs: TurnPrefs) => void;
}

const selectedModel = (prefs: TurnPrefs, models: ModelOption[]) =>
  models.find((option) => option.value === (prefs.model ?? 'default'));

export function PermissionSelect({ prefs, models, disabled, onChange }: SelectProps) {
  const [confirming, setConfirming] = useState(false);
  const autoUnavailable = selectedModel(prefs, models)?.supportsAutoMode === false;
  const activeId = prefs.permissionMode === 'auto' && autoUnavailable ? 'ask' : prefs.permissionMode;
  const active = MODES.find((mode) => mode.id === activeId) ?? MODES[0];
  const ActiveIcon = active.icon;

  return (
    <ComposerMenu
      label={t('permissionModes')}
      title={t(active.hint)}
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
            <p className="mt-1 text-12 leading-[1.5] text-[var(--text-secondary)]">{t('modeBypassHint')}</p>
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
            {MODES.map((mode) => {
              const Icon = mode.icon;
              const isSelected = mode.id === active.id;
              return (
                <li key={mode.id} role="option" aria-selected={isSelected}>
                  <button
                    type="button"
                    title={t(mode.hint)}
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

/** "default" has no name of its own, so it shows the model it stands for. */
function triggerName(model: ModelOption | undefined, models: ModelOption[]): string {
  if (!model) return 'Claude Code';
  if (model.value !== 'default') return model.displayName;
  const same = models.find((option) => option.value !== 'default' && option.resolvedModel === model.resolvedModel);
  return same?.displayName ?? t('modelDefault');
}

export function ModelSelect({ prefs, models, disabled, onChange }: SelectProps) {
  const model = selectedModel(prefs, models);
  const levels = model?.supportsEffort ? model.supportedEffortLevels : [];
  const effort = prefs.effort && levels.includes(prefs.effort) ? prefs.effort : null;
  const effortLabel = (level: string) => t(`effort_${level}` as StringKey) || level;

  return (
    <ComposerMenu
      label={t('modelMenu')}
      align="right"
      width={280}
      disabled={disabled || models.length === 0}
      trigger={
        <>
          <AgentMark size={13} className="mr-0.5 shrink-0 text-[var(--model-trigger-text)]" />
          <span className="truncate text-[var(--model-trigger-text)]">{triggerName(model, models)}</span>
          {effort ? (
            <span className="ml-1 inline-flex shrink-0 items-center gap-1 text-[var(--model-trigger-meta)]">
              <Gauge size={13} strokeWidth={1.8} aria-hidden />
              {effortLabel(effort)}
            </span>
          ) : null}
          <ChevronDown size={13} aria-hidden className="shrink-0 text-[var(--model-trigger-arrow)]" />
        </>
      }
    >
      {(close) => (
        <>
          <ul role="listbox" aria-label={t('modelMenu')} className="flex flex-col gap-0.5">
            {models.map((option) => {
              const isSelected = option === model;
              return (
                <li key={option.value} role="option" aria-selected={isSelected}>
                  <button
                    type="button"
                    title={option.description}
                    onClick={() => {
                      onChange({ ...prefs, model: option.value === 'default' ? null : option.value });
                      close();
                    }}
                    className={`${MENU_ROW} ${isSelected ? 'font-medium' : ''}`}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {option.value === 'default' ? t('modelDefault') : option.displayName}
                    </span>
                    {isSelected ? <Check size={13} aria-hidden className="shrink-0 text-[var(--model-item-check)]" /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
          {levels.length > 0 ? (
            <div className="mt-2 border-t border-[var(--border-default)] px-1 pt-2">
              <p className="px-2 pb-1.5 text-12 text-[var(--model-section-label)]">{t('effortMenu')}</p>
              <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={t('effortMenu')}>
                {[null, ...levels].map((level) => (
                  <button
                    key={level ?? 'default'}
                    type="button"
                    role="radio"
                    aria-checked={level === effort}
                    onClick={() => onChange({ ...prefs, effort: level })}
                    className={`h-7 rounded-full px-2.5 text-12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] ${
                      level === effort
                        ? 'bg-[var(--perm-item-selected-bg)] font-medium text-[var(--text-primary)]'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--cmd-palette-item-hover)]'
                    }`}
                  >
                    {level ? effortLabel(level) : t('effortDefault')}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}
    </ComposerMenu>
  );
}

export interface ProjectPicker {
  value: string | null;
  options: string[];
  onChange: (cwd: string) => void;
}

const PROJECT_PILL =
  'max-w-[220px] gap-1.5 !border-[var(--create-agent-control-border)] !bg-[var(--create-agent-control-bg)] !px-3 text-12 font-medium text-[var(--create-agent-control-text)] enabled:hover:!bg-[var(--create-agent-control-bg-hover)]';

export function ProjectSelect({ value, options, onChange }: ProjectPicker) {
  return (
    <ComposerMenu
      label={t('chooseProject')}
      title={value ?? undefined}
      width={280}
      align="right"
      side="below"
      disabled={options.length === 0}
      triggerClassName={PROJECT_PILL}
      trigger={
        <>
          <Folder size={12} strokeWidth={2} aria-hidden className="shrink-0 text-[var(--create-agent-control-icon)]" />
          <span className="truncate">{value ? projectName(value) : t('chooseProject')}</span>
          <ChevronDown size={12} strokeWidth={2} aria-hidden className="shrink-0 text-[var(--create-agent-control-icon)]" />
        </>
      }
    >
      {(close) => (
        <ul role="listbox" aria-label={t('chooseProject')} className="flex flex-col gap-0.5">
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
      )}
    </ComposerMenu>
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

function ContextRing({ usedTokens, windowTokens }: { usedTokens: number; windowTokens: number }) {
  const percent = contextPercent(usedTokens, windowTokens);
  const radius = (RING_SIZE - RING_STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  const color = percent > 90 ? 'var(--error-flat)' : percent > 70 ? 'var(--warning-fg)' : 'var(--msg-tool-card-chevron)';
  const center = RING_SIZE / 2;
  return (
    <span
      title={t('contextRing', {
        used: formatTokens(usedTokens),
        total: formatTokens(windowTokens),
        percent: String(percent),
      })}
      className="inline-flex h-6 shrink-0 items-center gap-1 text-12 font-medium leading-none tabular-nums text-[var(--msg-tool-card-chevron)]"
    >
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
    </span>
  );
}

interface ComposerFooterProps {
  /** The new task page picks its project above the input box, so it passes none. */
  cwd: string | null;
  usage: UsageWindows | null;
  context: { usedTokens: number; windowTokens: number } | null;
}

/** The line under the input box: where the task runs, plan usage and context. */
export function ComposerFooter({ cwd, usage, context }: ComposerFooterProps) {
  return (
    <div className="mt-2 flex min-h-6 items-center justify-between gap-3 px-1">
      <span title={cwd ?? undefined} className="flex min-w-0 items-center gap-1.5">
        {cwd ? (
          <>
            <Monitor size={12} aria-hidden className="shrink-0 text-[var(--workingdir-icon)]" />
            <span className="truncate text-12 font-medium leading-none text-[var(--workingdir-text)]">
              {projectName(cwd)}
            </span>
          </>
        ) : null}
      </span>
      <div className="flex shrink-0 items-center gap-3">
        <UsageChip usage={usage} />
        {context ? <ContextRing {...context} /> : null}
      </div>
    </div>
  );
}

