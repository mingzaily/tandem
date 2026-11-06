import { RefreshCw, SlidersHorizontal } from 'lucide-react';
import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Agent, ModelOption, UsageWindows } from '../lib/api';
import type { TurnPrefs } from '../lib/composerStatus';
import { t } from '../lib/i18n';
import { effectiveEffort, effortLabel, type ModelReadState } from '../lib/modelEffort';
import { AGENT_NAMES, modelPrefsFor, modelRowsOf } from '../lib/modelRows';
import { AgentMark } from './AgentMark';
import type { ComposerMenuOwner } from './ComposerMenu';
import { ModelConfigFlyout } from './ModelConfigFlyout';

export interface ModelAgentChoice {
  agent: Agent;
  prefs: TurnPrefs;
  models: ModelOption[];
  usage: UsageWindows | null;
  status: ModelReadState;
  onRefresh: () => void;
  onChoose: (prefs: TurnPrefs) => void;
}

function RailButton({ choice, active, onClick }: { choice: ModelAgentChoice; active: boolean; onClick: () => void }) {
  const used = (choice.usage?.sevenDay ?? choice.usage?.fiveHour)?.usedPercent;
  return (
    <button type="button" aria-label={AGENT_NAMES[choice.agent]} title={AGENT_NAMES[choice.agent]} aria-pressed={active} onClick={onClick}
      className={`relative flex h-[38px] w-[34px] shrink-0 flex-col items-center justify-center rounded-[9px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] ${active ? 'bg-[var(--accent-cta-bg)] text-[var(--accent-pure-cta-fg)]' : 'text-[var(--text-tertiary)] hover:bg-[var(--model-item-hover)] hover:text-[var(--text-secondary)]'}`}>
      <span className="flex h-6 items-center justify-center"><AgentMark agent={choice.agent} size={16} /></span>
      {used === undefined ? null : <span aria-hidden className="absolute bottom-[3px] h-[3px] w-[22px] overflow-hidden rounded-full" style={{ backgroundColor: 'color-mix(in srgb, currentColor 18%, transparent)' }}><span className="block h-full rounded-full bg-current" style={{ width: `${100 - Math.min(100, used)}%` }} /></span>}
    </button>
  );
}

/** One highlight slides between rows; the selected row retains its own static fill. */
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
    element.style.transition = element.style.opacity !== '1' ? 'none' : '';
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

export default function ModelPickerPanel({ current, others, owner, onClose }: { current: ModelAgentChoice; others: ModelAgentChoice[]; owner: ComposerMenuOwner; onClose: () => void }) {
  const [viewedAgent, setViewedAgent] = useState(current.agent);
  const choice = others.find(({ agent }) => agent === viewedAgent) ?? current;
  return (
    <div className="flex max-h-[min(560px,calc(100vh-120px))] min-h-0 w-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--model-dropdown-border)] px-3 py-2 text-12 text-[var(--text-secondary)]">
        <span>{choice.status.loading ? t('modelLoading') : AGENT_NAMES[choice.agent]}</span>
        <button type="button" aria-label={t('modelRefresh')} title={t('modelRefresh')} disabled={choice.status.loading} onClick={choice.onRefresh}
          className="flex size-6 shrink-0 items-center justify-center rounded-full enabled:hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:opacity-40">
          <RefreshCw size={13} aria-hidden className={choice.status.loading ? 'animate-spin' : ''} />
        </button>
      </div>
      {choice.status.error ? <p role="alert" className="max-h-24 shrink-0 overflow-y-auto px-3 py-2 text-12 text-[var(--text-danger)]">{t('modelReadFailed', { error: choice.status.error })}{choice.models.length ? ` ${t('modelCached')}` : ''}</p> : null}
      <div className="flex h-[428px] min-h-0 shrink">
        {others.length ? <div className="flex min-h-0 w-12 shrink-0 flex-col items-center gap-0.5 overflow-y-auto border-r border-[var(--model-dropdown-border)] px-1.5 py-2">
          {[current, ...others].map((candidate) => <RailButton key={candidate.agent} choice={candidate} active={candidate.agent === choice.agent} onClick={() => setViewedAgent(candidate.agent)} />)}
        </div> : null}
        <ModelList key={choice.agent} choice={choice} owner={owner} onClose={onClose} />
      </div>
    </div>
  );
}

function ModelList({ choice, owner, onClose }: { choice: ModelAgentChoice; owner: ComposerMenuOwner; onClose: () => void }) {
  const { agent, prefs, models, status } = choice;
  const { rows, followsConfig } = modelRowsOf(models);
  const glide = useRowGlide();
  const [config, setConfig] = useState<{ value: string; anchor: HTMLElement; returnFocus: HTMLElement; focus: boolean } | null>(null);
  const configuredModel = config && rows.find(({ value }) => value === config.value);
  const apply = (model: ModelOption, effort = prefs.effort) => {
    choice.onChoose(modelPrefsFor(prefs, model, followsConfig(model), effort));
    onClose();
  };
  const reveal = (model: ModelOption, anchor: HTMLElement, focus: boolean, toggle = false, returnFocus = anchor.querySelector<HTMLElement>('[data-model-select]')!) => {
    setConfig((open) => toggle && open?.value === model.value ? null : { value: model.value, anchor, returnFocus, focus });
  };

  return (
    <>
      <div role="list" aria-label={AGENT_NAMES[agent]} {...glide.handlers}
        className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overscroll-contain p-2 pb-3 [scrollbar-gutter:stable]">
        <span ref={glide.layer} aria-hidden className="pointer-events-none absolute left-0 top-0 rounded-lg bg-[hsl(var(--sidebar-item-hover))] opacity-0 transition-[transform,opacity] duration-[var(--motion-instant)] ease-[var(--motion-ease-out)]" />
        {rows.map((model) => {
          const isDefault = followsConfig(model);
          const selected = prefs.model ? model.value === prefs.model : isDefault;
          const configurable = model.supportsEffort && model.supportedEffortLevels.length > 1;
          const active = config?.value === model.value;
          const name = model.value === 'default' ? t('modelFollowCli') : model.displayName;
          const effort = model.supportsEffort ? effectiveEffort(model, prefs.effort) : null;
          return (
            <div key={model.value} role="listitem" data-menu-row data-model-value={model.value}
              onContextMenu={(event) => { if (configurable) { event.preventDefault(); reveal(model, event.currentTarget, false); } }}
              className={`group/row relative w-full shrink-0 rounded-lg text-[var(--model-item-text)] transition-colors duration-[var(--motion-instant)] ${selected ? 'bg-[hsl(var(--sidebar-item-hover))] data-[menu-active]:bg-transparent' : ''}`}>
              <button type="button" data-model-select aria-pressed={selected} aria-keyshortcuts={configurable ? 'ArrowLeft' : undefined}
                onClick={() => apply(model)}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return;
                  if (event.key === 'ArrowLeft' && configurable) { event.preventDefault(); reveal(model, event.currentTarget.closest<HTMLElement>('[data-menu-row]')!, true); }
                }}
                className={`flex w-full min-w-0 flex-col rounded-lg px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] ${configurable ? 'pr-9' : ''}`}>
                <span className="flex w-full items-center gap-2">
                  <span className="flex size-[18px] shrink-0 items-center justify-center text-[var(--text-secondary)]"><AgentMark agent={agent} size={14} /></span>
                  <span title={name} className="min-w-0 truncate text-14 font-medium leading-5">{name}</span>
                  {isDefault ? <span aria-label={t('modelCliDefault')} title={t('modelCliDefaultHint')} className="shrink-0 rounded border border-[var(--model-dropdown-border)] px-1 py-0.5 text-10 font-medium leading-none text-[var(--text-secondary)]">{t('modelDefault')}</span> : null}
                  {effort ? <span className="ml-auto shrink-0 text-12 text-[var(--text-tertiary)]">{effortLabel(effort)}</span> : null}
                </span>
                {model.description ? <span title={model.description} className="block max-w-[30ch] truncate pl-[26px] pt-px text-12 leading-[1.4] text-[var(--model-item-desc)]">{model.description}</span> : null}
              </button>
              {configurable ? <button type="button" data-row-customize aria-label={t('modelConfigFor', { model: name })} title={t('modelConfig')} aria-haspopup="dialog" aria-expanded={active}
                onClick={(event) => reveal(model, event.currentTarget.closest<HTMLElement>('[data-menu-row]')!, event.detail === 0, true, event.currentTarget)}
                className={`absolute right-3 top-2 flex size-5 items-center justify-center rounded-[6px] transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] ${active ? 'text-[var(--text-secondary)]' : 'text-[var(--text-tertiary)] opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 hover:text-[var(--text-secondary)]'}`}><SlidersHorizontal size={14} aria-hidden /></button> : null}
            </div>
          );
        })}
        {!rows.length && !status.loading && !status.error ? <div className="px-3 py-4 text-12 text-[var(--text-tertiary)]">{t('modelEmpty')}</div> : null}
      </div>
      {config && configuredModel && configuredModel.supportsEffort && configuredModel.supportedEffortLevels.length > 1 ? (
        <ModelConfigFlyout key={config.value} model={configuredModel} name={configuredModel.value === 'default' ? t('modelFollowCli') : configuredModel.displayName} source={AGENT_NAMES[agent]}
          effort={modelPrefsFor(prefs, configuredModel, followsConfig(configuredModel)).effort} anchor={config.anchor} returnFocus={config.returnFocus} owner={owner} focusOnOpen={config.focus}
          onChange={(effort) => choice.onChoose(modelPrefsFor(prefs, configuredModel, followsConfig(configuredModel), effort))} onClose={() => setConfig(null)} />
      ) : null}
    </>
  );
}
