import { ArrowLeft, Bot, FolderOpen, FolderPlus, Info, Palette, Settings, X, type LucideIcon } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import iconUrl from '../assets/tandem-icon.svg';
import { agentStatus, pickProject, type AgentStatus } from '../lib/api';
import { t, type StringKey } from '../lib/i18n';
import { projectName } from '../lib/items';
import { MAX_UI_FONT_SIZE, MIN_UI_FONT_SIZE, type AppSettings, type LanguageSetting, type ThemeSetting } from '../lib/settings';

type TabId = 'general' | 'appearance' | 'agents' | 'projects' | 'about';

const TABS: { id: TabId; label: StringKey; icon: LucideIcon }[] = [
  { id: 'general', label: 'settingsGeneral', icon: Settings },
  { id: 'appearance', label: 'settingsAppearance', icon: Palette },
  { id: 'agents', label: 'settingsAgents', icon: Bot },
  { id: 'projects', label: 'settingsProjects', icon: FolderOpen },
  { id: 'about', label: 'settingsAbout', icon: Info },
];
const NAV_ITEM =
  'flex h-9 items-center gap-2.5 rounded-full px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]';
const CARD = 'flex flex-col rounded-xl border border-[var(--settings-theme-card-border)] bg-[var(--settings-theme-card-bg)]';
const ROW = 'flex items-center justify-between gap-3 px-4 py-4';
const ROW_LABEL = 'text-13 font-medium text-[var(--settings-section-title)]';
const ROW_HINT = 'text-12 leading-[1.4] text-[var(--text-secondary)]';
const DIVIDER = 'mx-4 h-px bg-[var(--settings-theme-card-border)]';
const CHIP = 'h-7 rounded-full px-3 text-12 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-[14px] pb-9">
      <h3 className="text-16 font-medium leading-[1.2] text-[var(--settings-section-title)]">{title}</h3>
      <div className={CARD}>{children}</div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children?: ReactNode }) {
  return (
    <div className={ROW}>
      <span className="flex min-w-0 flex-col gap-1">
        <span className={ROW_LABEL}>{label}</span>
        {hint ? <span className={`${ROW_HINT} selectable [overflow-wrap:anywhere]`}>{hint}</span> : null}
      </span>
      {children ? <div className="shrink-0">{children}</div> : null}
    </div>
  );
}

function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] ${
        checked ? 'bg-[var(--switch-track-on)]' : 'bg-[var(--switch-track-off)]'
      }`}
    >
      <span
        className={`absolute top-0.5 size-4 rounded-full transition-[left] ${
          checked ? 'left-[18px] bg-[var(--switch-thumb-on)]' : 'left-0.5 bg-[var(--switch-thumb-off)]'
        }`}
      />
    </button>
  );
}

function Chips<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { id: T; text: string }[]; onChange: (value: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={option.id === value}
          onClick={() => onChange(option.id)}
          className={`${CHIP} ${
            option.id === value
              ? 'bg-[var(--settings-menu-bg-selected)] font-medium text-[var(--text-primary)]'
              : 'text-[var(--text-secondary)] hover:bg-[var(--settings-menu-bg-hover)]'
          }`}
        >
          {option.text}
        </button>
      ))}
    </div>
  );
}

function ThemePreview({ theme }: { theme: ThemeSetting }) {
  const light = 'var(--settings-theme-auto-light)';
  const dark = 'var(--settings-theme-auto-dark)';
  const background =
    theme === 'system' ? `linear-gradient(90deg, ${light} 50%, ${dark} 50%)` : theme === 'light' ? light : dark;
  return <span aria-hidden style={{ background }} className="block h-[60px] w-[92px] rounded-[8px] border border-[var(--settings-theme-card-border)]" />;
}

const THEMES: { id: ThemeSetting; label: StringKey }[] = [
  { id: 'system', label: 'themeSystem' },
  { id: 'light', label: 'themeLight' },
  { id: 'dark', label: 'themeDark' },
];

function AppearanceTab({ settings, onChange }: TabProps) {
  return (
    <>
      <Section title={t('themeSection')}>
        <div role="radiogroup" aria-label={t('themeSection')} className="flex gap-3 px-4 py-4">
          {THEMES.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={settings.theme === id}
              onClick={() => onChange({ ...settings, theme: id })}
              className={`flex flex-col items-center gap-1.5 rounded-xl p-1.5 text-12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] ${
                settings.theme === id
                  ? 'bg-[var(--settings-menu-bg-selected)] font-medium text-[var(--text-primary)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--settings-menu-bg-hover)]'
              }`}
            >
              <ThemePreview theme={id} />
              {t(label)}
            </button>
          ))}
        </div>
      </Section>
      <Section title={t('displaySection')}>
        <Row label={t('fontSizeLabel')} hint={t('fontSizeHint')}>
          <span className="flex items-center gap-3">
            <input
              type="range"
              aria-label={t('fontSizeLabel')}
              min={MIN_UI_FONT_SIZE}
              max={MAX_UI_FONT_SIZE}
              step={1}
              value={settings.uiFontSize}
              onChange={(event) => onChange({ ...settings, uiFontSize: Number(event.target.value) })}
              className="w-32 accent-[var(--switch-track-on)]"
            />
            <span className="w-9 text-right text-12 tabular-nums text-[var(--text-secondary)]">{settings.uiFontSize}px</span>
          </span>
        </Row>
        <div className={DIVIDER} />
        <Row label={t('translucentLabel')} hint={t('translucentHint')}>
          <Switch
            label={t('translucentLabel')}
            checked={settings.translucentSidebar}
            onChange={(translucentSidebar) => onChange({ ...settings, translucentSidebar })}
          />
        </Row>
      </Section>
    </>
  );
}

function GeneralTab({ settings, onChange }: TabProps) {
  const languages: { id: LanguageSetting; text: string }[] = [
    { id: 'system', text: t('languageSystem') },
    { id: 'zh', text: '简体中文' },
    { id: 'en', text: 'English' },
  ];
  return (
    <>
      <Section title={t('languageSection')}>
        <Row label={t('languageLabel')} hint={t('languageHint')}>
          <Chips label={t('languageLabel')} value={settings.language} options={languages} onChange={(language) => onChange({ ...settings, language })} />
        </Row>
      </Section>
      <Section title={t('inputSection')}>
        <Row label={t('cmdEnterLabel')} hint={t('cmdEnterHint')}>
          <Switch
            label={t('cmdEnterLabel')}
            checked={settings.sendWithCmdEnter}
            onChange={(sendWithCmdEnter) => onChange({ ...settings, sendWithCmdEnter })}
          />
        </Row>
      </Section>
    </>
  );
}

const AGENT_NAMES: Record<string, string> = { claude: 'Claude Code', codex: 'Codex', pi: 'Pi' };

function AgentsTab() {
  const [agents, setAgents] = useState<AgentStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let isCurrent = true;
    agentStatus()
      .then((result) => {
        if (isCurrent) setAgents(result);
      })
      .catch((reason) => {
        if (isCurrent) setError(String(reason));
      });
    return () => {
      isCurrent = false;
    };
  }, []);
  return (
    <Section title={t('agentsSection')}>
      {agents === null ? (
        <p className="px-4 py-4 text-13 text-[var(--text-secondary)]">{error ?? t('agentsChecking')}</p>
      ) : (
        agents.map((agent, index) => (
          <div key={agent.command}>
            {index > 0 ? <div className={DIVIDER} /> : null}
            <Row
              label={AGENT_NAMES[agent.command] ?? agent.command}
              hint={agent.path ? [agent.version, agent.path].filter(Boolean).join(' · ') : t('agentNotFound', { command: agent.command })}
            >
              <span className="text-12 text-[var(--text-secondary)]">
                {agent.command === 'claude' ? t('agentConnected') : agent.path ? t('agentInstalledOnly') : t('agentMissing')}
              </span>
            </Row>
          </div>
        ))
      )}
    </Section>
  );
}

function ProjectsTab({ extraProjects, onExtraProjectsChange, taskProjects }: ProjectsProps) {
  return (
    <>
      <Section title={t('addedProjects')}>
        {extraProjects.length === 0 ? <Row label={t('noAddedProjects')} hint={t('addedProjectsHint')} /> : null}
        {extraProjects.map((cwd, index) => (
          <div key={cwd}>
            {index > 0 ? <div className={DIVIDER} /> : null}
            <Row label={projectName(cwd)} hint={cwd}>
              <button
                type="button"
                aria-label={t('removeProject', { name: projectName(cwd) })}
                title={t('removeProject', { name: projectName(cwd) })}
                onClick={() => onExtraProjectsChange(extraProjects.filter((item) => item !== cwd))}
                className="flex size-7 items-center justify-center rounded-full text-[var(--text-secondary)] hover:bg-[var(--settings-menu-bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
              >
                <X size={14} aria-hidden />
              </button>
            </Row>
          </div>
        ))}
        <div className={DIVIDER} />
        <div className="px-4 py-3">
          <button
            type="button"
            onClick={() => {
              pickProject()
                .then((cwd) => {
                  if (cwd && !extraProjects.includes(cwd)) onExtraProjectsChange([...extraProjects, cwd]);
                })
                .catch(console.error);
            }}
            className="inline-flex h-8 items-center gap-2 rounded-full border border-[var(--settings-theme-card-border)] px-3 text-13 text-[var(--text-primary)] hover:bg-[var(--settings-menu-bg-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
          >
            <FolderPlus size={14} strokeWidth={1.8} aria-hidden />
            {t('addProject')}
          </button>
        </div>
      </Section>
      {taskProjects.length > 0 ? (
        <Section title={t('taskProjects')}>
          {taskProjects.map((cwd, index) => (
            <div key={cwd}>
              {index > 0 ? <div className={DIVIDER} /> : null}
              <Row label={projectName(cwd)} hint={cwd} />
            </div>
          ))}
        </Section>
      ) : null}
    </>
  );
}

function AboutTab({ version }: { version: string }) {
  return (
    <>
      <Section title="Tandem">
        <div className="flex items-center gap-3 px-4 py-4">
          <img src={iconUrl} alt="" draggable={false} className="size-11 shrink-0" />
          <span className="flex flex-col gap-0.5">
            <span className={ROW_LABEL}>Tandem</span>
            <span className={ROW_HINT}>{t('aboutVersion', { version })}</span>
          </span>
        </div>
        <div className={DIVIDER} />
        <Row label={t('aboutDataLabel')} hint={t('aboutDataHint')} />
        <div className={DIVIDER} />
        <Row label={t('aboutNetworkLabel')} hint={t('aboutNetworkHint')} />
        <div className={DIVIDER} />
        <Row label={t('aboutLicenseLabel')} hint="Apache-2.0" />
      </Section>
    </>
  );
}

interface TabProps {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
}

interface ProjectsProps {
  extraProjects: string[];
  onExtraProjectsChange: (projects: string[]) => void;
  taskProjects: string[];
}

interface SettingsViewProps extends TabProps, ProjectsProps {
  version: string;
  onBack: () => void;
}

export function SettingsView({ settings, onChange, extraProjects, onExtraProjectsChange, taskProjects, version, onBack }: SettingsViewProps) {
  const [tab, setTab] = useState<TabId>('general');
  const active = TABS.find(({ id }) => id === tab) ?? TABS[0];
  return (
    <div role="main" aria-label={t('settings')} className="relative flex h-full w-full bg-[var(--settings-bg)] pb-5">
      <div data-tauri-drag-region className="absolute inset-x-0 top-0 h-[46px]" />
      <aside aria-label={t('settings')} className="z-10 flex h-full w-[260px] shrink-0 flex-col gap-2 overflow-y-auto pl-6 pr-4 pt-[46px]">
        <div className="flex items-center gap-2.5 px-3 pb-[18px]">
          <button
            type="button"
            onClick={onBack}
            aria-label={t('settingsBack')}
            title={t('settingsBack')}
            className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--settings-back-icon)] transition-colors hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
          >
            <ArrowLeft size={20} aria-hidden />
          </button>
          <h1 className="text-24 font-medium leading-[1.1] text-[var(--settings-back-text)]">{t('settings')}</h1>
        </div>
        <nav role="tablist" aria-orientation="vertical" className="flex flex-col gap-0.5">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`${NAV_ITEM} ${
                tab === id
                  ? 'bg-[var(--settings-menu-bg-selected)] font-medium text-[var(--text-primary)]'
                  : 'text-[var(--settings-menu-text)] hover:bg-[var(--settings-menu-bg-hover)]'
              }`}
            >
              <Icon size={16} strokeWidth={1.8} aria-hidden className="shrink-0" />
              {t(label)}
            </button>
          ))}
        </nav>
      </aside>
      <div className="z-10 flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto pl-4 pr-6 pt-[46px] [scrollbar-gutter:stable]">
        <div role="tabpanel" aria-label={t(active.label)} className="mx-auto w-full min-w-0 max-w-[920px] px-1 pb-32">
          <h2 className="pb-6 text-20 font-medium leading-[1.3] text-[var(--settings-section-title)]">{t(active.label)}</h2>
          {tab === 'general' ? <GeneralTab settings={settings} onChange={onChange} /> : null}
          {tab === 'appearance' ? <AppearanceTab settings={settings} onChange={onChange} /> : null}
          {tab === 'agents' ? <AgentsTab /> : null}
          {tab === 'projects' ? (
            <ProjectsTab extraProjects={extraProjects} onExtraProjectsChange={onExtraProjectsChange} taskProjects={taskProjects} />
          ) : null}
          {tab === 'about' ? <AboutTab version={version} /> : null}
        </div>
      </div>
    </div>
  );
}
