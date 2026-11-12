import { useState } from 'react';
import { Check, ChevronDown, CodeXml, Folder, Gauge, Hand, ShieldCheck, TriangleAlert } from 'lucide-react';
import type { Agent, ModelOption } from './lib/types';
import { t } from './lib/i18n';
import { Sheet } from './Sheet';
import { AgentMark } from './AgentMark';
import { agentName } from './TaskList';
import { selectedModel } from './lib/composer';

export function ComposerControls({
  agent,
  agents,
  creating,
  choices,
  failures,
  model,
  effort,
  permission,
  projects,
  cwd,
  disabled,
  onModel,
  onEffort,
  onPermission,
  onProject,
}: {
  agent: Agent;
  agents: Agent[];
  creating: boolean;
  choices: Partial<Record<Agent, ModelOption[]>>;
  failures: Partial<Record<Agent, string>>;
  model: string;
  effort: string;
  permission: string;
  projects: { cwd: string; name: string }[];
  cwd: string;
  disabled: boolean;
  onModel: (agent: Agent, model: ModelOption) => void;
  onEffort: (value: string) => void;
  onPermission: (value: string) => void;
  onProject: (value: string) => void;
}) {
  const [sheet, setSheet] = useState<'model' | 'effort' | 'permission' | 'project' | null>(null);
  const [confirming, setConfirming] = useState(false);
  const chosen = selectedModel(model, choices[agent] ?? []);
  const chosenName =
    chosen?.value === 'default'
      ? (choices[agent]?.find(
          (option) => option.value !== 'default' && option.resolvedModel === chosen.resolvedModel,
        )?.displayName ?? chosen.displayName)
      : (chosen?.displayName ?? (model || agentName(agent)));
  const level = effort || chosen?.defaultEffort || '';
  const close = () => {
    setSheet(null);
    setConfirming(false);
  };
  const permissionLabel =
    {
      default: t('default'),
      acceptEdits: t('acceptEdits'),
      auto: t('auto'),
      bypassPermissions: t('fullAccess'),
    }[permission] ?? t('default');
  const PermissionIcon =
    permission === 'bypassPermissions'
      ? TriangleAlert
      : permission === 'auto'
        ? ShieldCheck
        : permission === 'acceptEdits'
          ? CodeXml
          : Hand;
  return (
    <>
      <div className="composer-controls">
        <button
          disabled={disabled}
          className="control model-control"
          aria-label={t('modelMenu')}
          aria-haspopup="dialog"
          aria-expanded={sheet === 'model'}
          onClick={() => setSheet('model')}
        >
          <AgentMark agent={agent} size={15} />
          <span>{chosenName}</span>
          <ChevronDown size={12} />
        </button>
        {chosen?.supportsEffort && (
          <button
            disabled={disabled}
            className="control"
            aria-label={t('effortMenu')}
            aria-haspopup="dialog"
            aria-expanded={sheet === 'effort'}
            onClick={() => setSheet('effort')}
          >
            <Gauge size={14} />
            <span>{effortLabel(level)}</span>
            <ChevronDown size={12} />
          </button>
        )}
        <button
          disabled={disabled || agent === 'pi'}
          title={agent === 'pi' ? t('piPermission') : undefined}
          className={
            'control permission-control ' + (permission === 'bypassPermissions' ? 'full-access' : '')
          }
          aria-label={t('permissionMenu')}
          aria-haspopup="dialog"
          aria-expanded={sheet === 'permission'}
          onClick={() => setSheet('permission')}
        >
          <PermissionIcon size={15} />
          <span>{agent === 'pi' ? t('piManaged') : permissionLabel}</span>
          <ChevronDown size={12} />
        </button>
      </div>
      {creating && (
        <button
          disabled={disabled}
          className="project-control"
          aria-haspopup="dialog"
          aria-expanded={sheet === 'project'}
          onClick={() => setSheet('project')}
        >
          <Folder size={13} />
          <span>{projects.find((p) => p.cwd === cwd)?.name ?? t('projectMenu')}</span>
          <ChevronDown size={12} />
        </button>
      )}
      {sheet && (
        <Sheet
          title={t(
            sheet === 'model'
              ? 'modelMenu'
              : sheet === 'effort'
                ? 'effortMenu'
                : sheet === 'permission'
                  ? 'permissionMenu'
                  : 'projectMenu',
          )}
          onClose={close}
        >
          {sheet === 'model' && (
            <div role="listbox" aria-label={t('modelMenu')}>
              {(creating ? agents : [agent]).map((a) => (
                <section className="model-group" key={a}>
                  <h3>
                    <AgentMark agent={a} size={17} />
                    {agentName(a)}
                  </h3>
                  {!choices[a]?.length && (
                    <p className="sheet-hint" role={failures[a] ? 'alert' : undefined}>
                      {failures[a] ?? t('loadingModels')}
                    </p>
                  )}
                  {choices[a]?.map((m) => (
                    <button
                      role="option"
                      aria-selected={a === agent && m === chosen}
                      className="sheet-option"
                      key={m.value}
                      onClick={() => {
                        onModel(a, m);
                        close();
                      }}
                    >
                      <span>
                        <strong>{m.displayName}</strong>
                        {m.description && <small>{m.description}</small>}
                      </span>
                      {m.value === 'default' && <span className="model-default">{t('effortDefault')}</span>}
                      {a === agent && m === chosen && <Check size={14} aria-hidden />}
                    </button>
                  ))}
                </section>
              ))}
            </div>
          )}
          {sheet === 'effort' && (
            <div role="listbox" aria-label={t('effortMenu')}>
              {(chosen?.defaultEffort
                ? chosen.supportedEffortLevels
                : ['', ...(chosen?.supportedEffortLevels ?? [])]
              ).map((value) => (
                <button
                  role="option"
                  aria-selected={value === level}
                  key={value}
                  className="sheet-option"
                  onClick={() => {
                    onEffort(value === chosen?.defaultEffort ? '' : value);
                    close();
                  }}
                >
                  <Gauge size={17} />
                  <span>
                    <strong>{effortLabel(value)}</strong>
                    {value === chosen?.defaultEffort && <small>{t('effortDefault')}</small>}
                  </span>
                  {value === level && <Check size={14} aria-hidden />}
                </button>
              ))}
            </div>
          )}
          {sheet === 'permission' &&
            (confirming ? (
              <div className="full-confirm">
                <TriangleAlert size={24} />
                <h3>{t('fullConfirm')}</h3>
                <p>{t('fullHint')}</p>
                <div className="actions">
                  <button onClick={() => setConfirming(false)}>{t('cancel')}</button>
                  <button
                    className="primary"
                    onClick={() => {
                      onPermission('bypassPermissions');
                      close();
                    }}
                  >
                    {t('enableFull')}
                  </button>
                </div>
              </div>
            ) : (
              <div role="listbox" aria-label={t('permissionMenu')}>
                {[
                  { value: 'default', label: t('default'), hint: t('defaultHint'), icon: Hand },
                  ...(agent === 'claude'
                    ? [{ value: 'acceptEdits', label: t('acceptEdits'), hint: t('editHint'), icon: Folder }]
                    : []),
                  ...(chosen?.supportsAutoMode
                    ? [{ value: 'auto', label: t('auto'), hint: t('autoHint'), icon: ShieldCheck }]
                    : []),
                  {
                    value: 'bypassPermissions',
                    label: t('fullAccess'),
                    hint: t('fullHint'),
                    icon: TriangleAlert,
                  },
                ].map((p) => (
                  <button
                    role="option"
                    aria-selected={permission === p.value}
                    className="sheet-option"
                    key={p.value}
                    onClick={() => {
                      if (p.value === 'bypassPermissions' && permission !== p.value) {
                        setConfirming(true);
                        return;
                      }
                      onPermission(p.value);
                      close();
                    }}
                  >
                    <p.icon size={18} />
                    <span>
                      <strong>{p.label}</strong>
                      <small>{p.hint}</small>
                    </span>
                    {permission === p.value && <Check size={14} aria-hidden />}
                  </button>
                ))}
              </div>
            ))}
          {sheet === 'project' && (
            <div role="listbox" aria-label={t('projectMenu')}>
              {projects.map((p) => (
                <button
                  role="option"
                  aria-selected={cwd === p.cwd}
                  className="sheet-option"
                  key={p.cwd}
                  onClick={() => {
                    onProject(p.cwd);
                    close();
                  }}
                >
                  <Folder size={18} />
                  <span>
                    <strong>{p.name}</strong>
                  </span>
                  {cwd === p.cwd && <Check size={14} aria-hidden />}
                </button>
              ))}
            </div>
          )}
        </Sheet>
      )}
    </>
  );
}
export function effortLabel(level: string) {
  const known = {
    low: t('effort_low'),
    medium: t('effort_medium'),
    high: t('effort_high'),
    xhigh: t('effort_xhigh'),
    max: t('effort_max'),
    minimal: t('effort_minimal'),
    none: t('effort_none'),
  };
  return known[level as keyof typeof known] ?? (level || t('effortDefault'));
}
