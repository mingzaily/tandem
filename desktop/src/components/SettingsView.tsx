import { ArrowLeft, Bot, ExternalLink, FolderOpen, FolderPlus, Info, Palette, RotateCcw, Settings, Smartphone, X, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useId, useReducer, useRef, useState, type ReactNode } from 'react';
import iconUrl from '../assets/tandem-icon.svg';
import {
  agentStatus,
  discoverProjects,
  installAgent,
  loginAgent,
  openExternal,
  pickProject,
  stopAgentJob,
  onRemoteChanged,
  remoteBeginPairing,
  remoteCancelPairing,
  remoteConfigure,
  remoteRevoke,
  remoteState,
  type AgentStatus,
  type RemoteLinkStatus,
  type RemoteState,
  type DiscoveredProject,
} from '../lib/api';
import { t, type StringKey } from '../lib/i18n';
import { projectName } from '../lib/items';
import { loadAgentStatus, saveAgentStatus } from '../lib/preferences';
import { INITIAL_REMOTE_FORM, remoteFormDirty, remoteFormReducer } from '../lib/remoteSettings';
import {
  DARK_THEMES,
  LIGHT_THEMES,
  MAX_UI_FONT_SIZE,
  MIN_UI_FONT_SIZE,
  type AppSettings,
  type LanguageSetting,
  type ThemeChoice,
  type ThemeSetting,
} from '../lib/settings';
import { AgentMark } from './AgentMark';
import { SettingsButton } from './SettingsButton';

const JOB_LINES = 8;

type TabId = 'general' | 'appearance' | 'agents' | 'projects' | 'remote' | 'about';

const TABS: { id: TabId; label: StringKey; icon: LucideIcon }[] = [
  { id: 'general', label: 'settingsGeneral', icon: Settings },
  { id: 'appearance', label: 'settingsAppearance', icon: Palette },
  { id: 'agents', label: 'settingsAgents', icon: Bot },
  { id: 'projects', label: 'settingsProjects', icon: FolderOpen },
  { id: 'remote', label: 'settingsRemote', icon: Smartphone },
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

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-[14px] pb-9">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <h3 className="text-16 font-medium leading-[1.2] text-[var(--settings-section-title)]">{title}</h3>
        {action}
      </div>
      <div className={CARD}>{children}</div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children?: ReactNode }) {
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

function Switch({ label, checked, disabled = false, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:cursor-default disabled:opacity-60 ${
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

/** A small picture drawn with the theme's own colors, because the tokens work on any element. */
function ThemeSwatch({ theme }: { theme: ThemeChoice }) {
  return (
    <span
      aria-hidden
      data-theme={theme.id}
      className={`relative block h-[60px] w-[92px] overflow-hidden rounded-[8px] border border-[var(--settings-theme-card-border)] bg-[var(--surface)] ${theme.isDark ? 'dark' : ''}`}
    >
      <span className="absolute inset-y-0 left-0 w-[24px] border-r border-[var(--border-default)] bg-[hsl(var(--sidebar))]" />
      <span className="absolute left-[32px] top-[12px] h-[5px] w-[36px] rounded-full bg-[var(--text-primary)] opacity-70" />
      <span className="absolute left-[32px] top-[23px] h-[5px] w-[50px] rounded-full bg-[var(--text-secondary)] opacity-40" />
      <span className="absolute bottom-[7px] left-[30px] right-[6px] h-[13px] rounded-full border border-[var(--chat-input-border)] bg-[var(--chat-input-bg)]" />
      <span className="absolute bottom-[10px] right-[9px] size-[7px] rounded-full bg-[var(--send-btn-bg)]" />
    </span>
  );
}

function ThemeGroup({ title, themes, value, onChange }: { title: string; themes: ThemeChoice[]; value: string; onChange: (id: string) => void }) {
  return (
    <Section title={title}>
      <div role="radiogroup" aria-label={title} className="flex flex-wrap gap-3 px-4 py-4">
        {themes.map((theme) => (
          <button
            key={theme.id}
            type="button"
            role="radio"
            aria-checked={value === theme.id}
            onClick={() => onChange(theme.id)}
            className={`flex w-[104px] flex-col items-center gap-1.5 rounded-xl p-1.5 text-12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] ${
              value === theme.id
                ? 'bg-[var(--settings-menu-bg-selected)] font-medium text-[var(--text-primary)]'
                : 'text-[var(--text-secondary)] hover:bg-[var(--settings-menu-bg-hover)]'
            }`}
          >
            <ThemeSwatch theme={theme} />
            <span className="w-full truncate text-center">{theme.name === 'Plain' ? t('themePlain') : theme.name}</span>
          </button>
        ))}
      </div>
    </Section>
  );
}

function AppearanceTab({ settings, onChange }: TabProps) {
  return (
    <>
      <Section title={t('modeSection')}>
        <div role="radiogroup" aria-label={t('modeSection')} className="flex gap-3 px-4 py-4">
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
      <ThemeGroup title={t('lightThemes')} themes={LIGHT_THEMES} value={settings.lightTheme} onChange={(lightTheme) => onChange({ ...settings, lightTheme })} />
      <ThemeGroup title={t('darkThemes')} themes={DARK_THEMES} value={settings.darkTheme} onChange={(darkTheme) => onChange({ ...settings, darkTheme })} />
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
      <Section title={t('windowSection')}>
        <Row label={t('keepInMenuBarLabel')} hint={t('keepInMenuBarHint')}>
          <Switch label={t('keepInMenuBarLabel')} checked={settings.keepInMenuBar} onChange={(keepInMenuBar) => onChange({ ...settings, keepInMenuBar })} />
        </Row>
        <div className={DIVIDER} />
        <Row label={t('notifyLabel')} hint={t('notifyHint')}>
          <Switch label={t('notifyLabel')} checked={settings.notifyWhenDone} onChange={(notifyWhenDone) => onChange({ ...settings, notifyWhenDone })} />
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

const AGENT_NAMES: Record<AgentStatus['command'], string> = { claude: 'Claude Code', codex: 'Codex', pi: 'Pi' };
const LINK = /https?:\/\/\S+/;

interface AgentJob {
  command: AgentStatus['command'];
  lines: string[];
  isRunning: boolean;
  failed: boolean;
}

function agentHint(agent: AgentStatus): string {
  if (!agent.installed) return t('agentInstallHint');
  const parts: (string | null)[] = [agent.version];
  if (agent.login) {
    parts.push(agent.login.loggedIn ? t('agentLoggedIn') : t('agentNotLoggedIn'));
    if (agent.login.loggedIn) parts.push(agent.login.detail);
  } else {
    parts.push(t('agentPiHint'));
  }
  return parts.filter(Boolean).join(' · ');
}

function AgentsTab() {
  // Checking takes seconds, so the last result shows at once while a new one comes in.
  const [agents, setAgents] = useState<AgentStatus[] | null>(loadAgentStatus);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<AgentJob | null>(null);
  const isMounted = useRef(true);

  const refresh = useCallback(() => {
    agentStatus()
      .then((result) => {
        saveAgentStatus(result);
        if (isMounted.current) setAgents(result);
      })
      .catch((reason) => {
        if (isMounted.current) setError(String(reason));
      });
  }, []);

  useEffect(() => {
    isMounted.current = true;
    refresh();
    return () => {
      isMounted.current = false;
    };
  }, [refresh]);

  const run = (command: AgentStatus['command'], start: typeof installAgent) => {
    setJob({ command, lines: [], isRunning: true, failed: false });
    start(command, (event) => {
      if (event.type === 'line') {
        setJob((current) => current && { ...current, lines: [...current.lines, event.text].slice(-JOB_LINES) });
        return;
      }
      setJob((current) => current && { ...current, isRunning: false, failed: !event.ok });
      if (event.ok) setJob(null);
      refresh();
    }).catch((reason) => {
      setJob((current) => current && { ...current, lines: [...current.lines, String(reason)], isRunning: false, failed: true });
    });
  };

  return (
    <Section title={t('agentsSection')}>
      {agents === null ? (
        <p className="px-4 py-4 text-13 text-[var(--text-secondary)]">{error ?? t('agentsChecking')}</p>
      ) : (
        agents.map((agent, index) => {
          const jobHere = job?.command === agent.command ? job : null;
          const link = jobHere?.lines.join('\n').match(LINK)?.[0];
          return (
            <div key={agent.command}>
              {index > 0 ? <div className={DIVIDER} /> : null}
              <div className={ROW}>
                <span className="flex min-w-0 items-center gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-chip)] text-[var(--text-primary)]">
                    <AgentMark agent={agent.command} size={16} />
                  </span>
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className={ROW_LABEL}>{AGENT_NAMES[agent.command]}</span>
                    <span className={`${ROW_HINT} selectable [overflow-wrap:anywhere]`}>{agentHint(agent)}</span>
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {jobHere?.isRunning ? (
                    <>
                      {link ? (
                        <SettingsButton type="button" onClick={() => void openExternal(link)}>
                          {t('openLink')}
                        </SettingsButton>
                      ) : null}
                      <SettingsButton type="button" onClick={() => void stopAgentJob()}>
                        {t('agentStop')}
                      </SettingsButton>
                    </>
                  ) : !agent.installed ? (
                    <SettingsButton type="button" disabled={job?.isRunning} onClick={() => run(agent.command, installAgent)}>
                      {t('agentInstall')}
                    </SettingsButton>
                  ) : agent.login ? (
                    <SettingsButton type="button" disabled={job?.isRunning} onClick={() => run(agent.command, loginAgent)}>
                      {agent.login.loggedIn ? t('agentRelogin') : t('agentLogin')}
                    </SettingsButton>
                  ) : null}
                </span>
              </div>
              {jobHere && jobHere.lines.length + (jobHere.failed ? 1 : 0) > 0 ? (
                <div className="selectable px-4 pb-4 font-mono text-12 leading-[1.5] text-[var(--text-secondary)] [overflow-wrap:anywhere]">
                  {jobHere.lines.map((line, lineIndex) => (
                    <div key={lineIndex}>{line}</div>
                  ))}
                  {jobHere.failed ? <div className="mt-1 font-sans text-[var(--text-danger)]">{t('agentJobFailed')}</div> : null}
                </div>
              ) : null}
            </div>
          );
        })
      )}
    </Section>
  );
}

const RELAY_DOCS_URL = 'https://mingzaily.github.io/tandem/guide/quick-start';
const REMOTE_INPUT =
  'selectable h-8 w-[280px] rounded-lg border border-[var(--settings-theme-card-border)] bg-transparent px-2.5 text-13 text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:border-[var(--focus-ring)]';
const REMOTE_STATUS: Record<RemoteLinkStatus, StringKey> = {
  off: 'remoteStatusOff',
  connecting: 'remoteStatusConnecting',
  online: 'remoteStatusOnline',
  failed: 'remoteStatusFailed',
};

type RemoteOperation = 'save' | 'toggle' | 'pair' | 'cancelPair' | `revoke:${string}`;

function RemoteTab() {
  const relayFormId = useId();
  const [state, setState] = useState<RemoteState | null>(null);
  const [form, updateForm] = useReducer(remoteFormReducer, INITIAL_REMOTE_FORM);
  const [pending, setPending] = useState<RemoteOperation | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [configurationError, setConfigurationError] = useState<string | null>(null);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const operation = useRef<RemoteOperation | null>(null);
  const active = useRef(true);
  const revision = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++revision.current;
    try {
      const next = await remoteState();
      if (!active.current || request !== revision.current) return;
      setState(next);
      updateForm({ type: 'received', relayUrl: next.relayUrl });
      setLoadError(null);
    } catch (reason) {
      if (active.current && request === revision.current) setLoadError(String(reason));
    }
  }, []);

  useEffect(() => {
    active.current = true;
    void refresh();
    const unlisten = onRemoteChanged(() => void refresh());
    return () => {
      active.current = false;
      revision.current++;
      void unlisten.then((stop) => stop());
    };
  }, [refresh]);

  const pairing = state?.pairing;
  useEffect(() => {
    if (!pairing) return;
    const timer = window.setTimeout(() => void refresh(), Math.max(0, pairing.expiresAtMs - Date.now()) + 1);
    return () => window.clearTimeout(timer);
  }, [pairing?.expiresAtMs, refresh]);
  useEffect(() => setCopied(false), [pairing?.text]);

  const run = async (kind: RemoteOperation, action: () => Promise<void>, committed?: () => void) => {
    if (operation.current) return;
    operation.current = kind;
    setPending(kind);
    const setError = kind === 'save' || kind === 'toggle' ? setConfigurationError : setDeviceError;
    setError(null);
    try {
      await action();
      if (!active.current) return;
      committed?.();
      await refresh();
    } catch (reason) {
      if (active.current) setError(String(reason));
    } finally {
      operation.current = null;
      if (active.current) setPending(null);
    }
  };

  if (!state) {
    return <Section title={t('remoteSection')}>
      <div className="flex items-center justify-between gap-3 px-4 py-4">
        <p role={loadError ? 'alert' : 'status'} className={ROW_HINT}>{loadError ?? t('remoteLoading')}</p>
        {loadError ? <SettingsButton onClick={() => void refresh()}>{t('remoteRefresh')}</SettingsButton> : null}
      </div>
    </Section>;
  }

  const busy = pending !== null;
  const dirty = remoteFormDirty(form);
  const hasSavedConfiguration = !!state.relayUrl && state.hasHostToken;
  const canEnable = hasSavedConfiguration && !dirty;
  const canSave = !!form.relayUrl.trim() && (state.hasHostToken || !!form.hostToken.trim());
  const canPair = state.status === 'online' && !dirty && !loadError;
  const enableHint = !state.enabled && !canEnable
    ? t(dirty ? 'remoteSaveBeforeEnable' : 'remoteConfigureFirst')
    : t('remoteEnableHint');
  const pairHint = pending === 'pair' ? t('remotePairCreating') : dirty ? t('remoteSaveBeforePair')
    : state.status === 'online' ? t('remotePairReady') : t('remoteConnectBeforePair');
  const statusText = state.error ? `${t(REMOTE_STATUS[state.status])}：${state.error}` : t(REMOTE_STATUS[state.status]);
  const edit = (type: 'editUrl' | 'editToken', value: string) => {
    setConfigurationError(null);
    updateForm({ type, value });
  };
  const copyPairing = async (text: string) => {
    setDeviceError(null);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch (reason) {
      setDeviceError(String(reason));
    }
  };

  return (
    <>
      <Section title={t('remoteSection')} action={
        <button type="button" onClick={() => void openExternal(RELAY_DOCS_URL)} className="inline-flex shrink-0 items-center gap-1 rounded text-12 text-[var(--text-secondary)] underline underline-offset-4 transition-colors hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]">
          {t('remoteDocs')}<ExternalLink size={13} strokeWidth={1.7} aria-hidden />
        </button>
      }>
        <Row label={t('remoteEnable')} hint={
          state.enabled ? <span role="status">{statusText} · {enableHint}</span> : enableHint
        }>
          <Switch label={t('remoteEnable')} checked={state.enabled} disabled={busy || !!loadError || (!state.enabled && !canEnable)}
            onChange={(enabled) => void run('toggle', () => remoteConfigure(enabled, state.relayUrl, null))} />
        </Row>
      </Section>
      <Section title={t('remoteRelaySection')} action={
        <span className="flex shrink-0 items-center gap-2">
          {dirty ? <SettingsButton variant="quiet" disabled={busy} onClick={() => {
            setConfigurationError(null);
            updateForm({ type: 'discarded', relayUrl: state.relayUrl });
          }}>{t('remoteDiscard')}</SettingsButton> : null}
          <SettingsButton type="submit" form={relayFormId} variant="primary" busy={pending === 'save'}
            disabled={busy || !dirty || !canSave || !!loadError}>{t('remoteSave')}</SettingsButton>
        </span>
      }>
        <form id={relayFormId} onSubmit={(event) => {
          event.preventDefault();
          if (!dirty || !canSave || loadError) return;
          const relayUrl = form.relayUrl.trim();
          const hostToken = form.hostToken.trim() || null;
          void run('save', () => remoteConfigure(state.enabled, relayUrl, hostToken),
            () => updateForm({ type: 'saved', relayUrl }));
        }}>
          <Row label={t('remoteRelayUrl')}>
            <input type="url" required value={form.relayUrl} aria-label={t('remoteRelayUrl')}
              placeholder="wss://relay.example.com/ws" spellCheck={false} disabled={busy}
              onChange={(event) => edit('editUrl', event.target.value)} className={REMOTE_INPUT} />
          </Row>
          <div className={DIVIDER} />
          <Row label={t('remoteRelayToken')}>
            <input type="password" value={form.hostToken} aria-label={t('remoteRelayToken')} required={!state.hasHostToken}
              placeholder={state.hasHostToken ? t('remoteTokenSaved') : ''} disabled={busy}
              onChange={(event) => edit('editToken', event.target.value)} className={REMOTE_INPUT} />
          </Row>
          {configurationError ? <p role="alert" className="selectable px-4 pb-3 text-12 text-[var(--text-danger)] [overflow-wrap:anywhere]">{configurationError}</p> : null}
          {loadError ? <div className="flex items-center justify-between gap-3 px-4 pb-3">
            <p role="alert" className="selectable min-w-0 text-12 text-[var(--text-danger)] [overflow-wrap:anywhere]">{loadError}</p>
            <SettingsButton variant="quiet" disabled={busy} onClick={() => void refresh()}>{t('remoteRefresh')}</SettingsButton>
          </div> : null}
        </form>
      </Section>
      <Section title={t('remoteDevices')} action={pairing ?
        <SettingsButton busy={pending === 'cancelPair'} disabled={busy} onClick={() => void run('cancelPair', remoteCancelPairing)}>{t('remotePairCancel')}</SettingsButton> :
        <SettingsButton busy={pending === 'pair'} disabled={busy || !canPair} onClick={() => void run('pair', remoteBeginPairing)}>{t('remotePair')}</SettingsButton>
      }>
        {state.clients.length === 0 && !pairing ? <Row label={t('remoteNoDevices')} hint={pairHint} /> : null}
        {state.clients.map((client, index) => (
          <div key={client.clientId}>
            {index > 0 ? <div className={DIVIDER} /> : null}
            <Row label={client.name || client.clientId} hint={client.isOnline ? t('remoteDeviceOnline') : t('remoteDeviceOffline')}>
              <SettingsButton variant="quiet" danger busy={pending === `revoke:${client.clientId}`} disabled={busy}
                onClick={() => void run(`revoke:${client.clientId}`, () => remoteRevoke(client.clientId))}>{t('remoteRevoke')}</SettingsButton>
            </Row>
          </div>
        ))}
        {pairing ? <>
          {state.clients.length > 0 ? <div className={DIVIDER} /> : null}
          <div className="flex flex-wrap items-start gap-4 px-4 py-4">
            <img src={pairing.qr} alt={t('remotePairImage')} width={160} height={160} className="shrink-0 rounded-lg bg-white p-2" />
            <div className="flex min-w-0 flex-1 flex-col items-start gap-3">
              <span className={ROW_HINT}>{t('remotePairHint')}</span>
              <SettingsButton disabled={busy} onClick={() => void copyPairing(pairing.text)}>{t(copied ? 'remotePairCopied' : 'remotePairCopy')}</SettingsButton>
            </div>
          </div>
        </> : state.clients.length > 0 && !canPair ? <><div className={DIVIDER} /><p className={`${ROW_HINT} px-4 py-3`}>{pairHint}</p></> : null}
        {deviceError ? <p role="alert" className="selectable px-4 pb-3 text-12 text-[var(--text-danger)] [overflow-wrap:anywhere]">{deviceError}</p> : null}
      </Section>
    </>
  );
}

function ProjectsTab({ settings, onChange, extraProjects, onExtraProjectsChange, defaultConversationDir }: TabProps & ProjectsProps) {
  const [discovered, setDiscovered] = useState<DiscoveredProject[] | null>(null);
  const [picking, setPicking] = useState<'project' | 'directory' | null>(null);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  useEffect(() => {
    let isCurrent = true;
    discoverProjects()
      .then((result) => {
        if (isCurrent) setDiscovered(result);
      })
      .catch((error) => {
        console.error(error);
        if (isCurrent) setDiscovered([]);
      });
    return () => {
      isCurrent = false;
    };
  }, []);
  const remaining = (discovered ?? []).filter((project) => !extraProjects.includes(project.cwd));
  const changeConversationDir = (next: string | null) => {
    const previous = settings.conversationDir;
    const past = previous && previous !== next ? [...settings.pastConversationDirs, previous] : settings.pastConversationDirs;
    onChange({ ...settings, conversationDir: next, pastConversationDirs: [...new Set(past)].filter((dir) => dir !== next) });
  };
  const chooseFolder = async (kind: 'project' | 'directory') => {
    setPicking(kind);
    const setError = kind === 'project' ? setProjectError : setDirectoryError;
    setError(null);
    try {
      const selected = await pickProject();
      if (selected) {
        if (kind === 'project') {
          if (!extraProjects.includes(selected)) onExtraProjectsChange([...extraProjects, selected]);
        } else changeConversationDir(selected);
      }
    } catch (reason) {
      setError(String(reason));
    } finally {
      setPicking(null);
    }
  };
  return (
    <>
      <Section title={t('addedProjects')} action={
        <SettingsButton busy={picking === 'project'} disabled={picking !== null} onClick={() => void chooseFolder('project')}>
          <FolderPlus size={14} strokeWidth={1.8} aria-hidden />{t('settingsAddProject')}
        </SettingsButton>
      }>
        {extraProjects.length === 0 ? <Row label={t('noAddedProjects')} hint={t('addedProjectsHint')} /> : null}
        {extraProjects.map((cwd, index) => (
          <div key={cwd}>
            {index > 0 ? <div className={DIVIDER} /> : null}
            <Row label={projectName(cwd)} hint={cwd}>
              <SettingsButton variant="quiet" iconOnly aria-label={t('removeProject', { name: projectName(cwd) })}
                title={t('removeProject', { name: projectName(cwd) })} onClick={() => onExtraProjectsChange(extraProjects.filter((item) => item !== cwd))}>
                <X size={14} aria-hidden />
              </SettingsButton>
            </Row>
          </div>
        ))}
        {projectError ? <p role="alert" className="selectable px-4 pb-3 text-12 text-[var(--text-danger)] [overflow-wrap:anywhere]">{projectError}</p> : null}
      </Section>
      <Section title={t('discoveredProjects')}>
        {discovered === null ? <Row label={t('discoveredChecking')} /> : null}
        {discovered !== null && remaining.length === 0 ? <Row label={t('discoveredNone')} hint={t('discoveredProjectsHint')} /> : null}
        {remaining.map((project, index) => (
          <div key={project.cwd}>
            {index > 0 ? <div className={DIVIDER} /> : null}
            <Row label={projectName(project.cwd)} hint={project.cwd}>
              <SettingsButton onClick={() => onExtraProjectsChange([...extraProjects, project.cwd])}>{t('joinProject')}</SettingsButton>
            </Row>
          </div>
        ))}
      </Section>
      <Section title={t('conversationWorkspace')}>
        <Row label={t('conversationDirectory')} hint={settings.conversationDir ?? defaultConversationDir}>
          <span className="flex items-center gap-2">
            {settings.conversationDir ? <SettingsButton variant="quiet" iconOnly disabled={picking !== null}
              aria-label={t('conversationReset')} title={t('conversationReset')} onClick={() => changeConversationDir(null)}>
              <RotateCcw size={14} aria-hidden />
            </SettingsButton> : null}
            <SettingsButton busy={picking === 'directory'} disabled={picking !== null} onClick={() => void chooseFolder('directory')}>{t('conversationChange')}</SettingsButton>
          </span>
        </Row>
        <div className={DIVIDER} />
        <p className={`${ROW_HINT} px-4 py-3`}>{t('conversationWorkspaceHint')}</p>
        {directoryError ? <p role="alert" className="selectable px-4 pb-3 text-12 text-[var(--text-danger)] [overflow-wrap:anywhere]">{directoryError}</p> : null}
      </Section>
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
  defaultConversationDir: string;
}

interface SettingsViewProps extends TabProps, ProjectsProps {
  initialTab?: TabId;
  version: string;
  onBack: () => void;
}

export function SettingsView({ settings, onChange, extraProjects, onExtraProjectsChange, defaultConversationDir, version, onBack, initialTab = 'general' }: SettingsViewProps) {
  const [tab, setTab] = useState<TabId>(initialTab);
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
          {tab === 'remote' ? <RemoteTab /> : null}
          {tab === 'projects' ? (
            <ProjectsTab settings={settings} onChange={onChange} extraProjects={extraProjects} onExtraProjectsChange={onExtraProjectsChange} defaultConversationDir={defaultConversationDir} />
          ) : null}
          {tab === 'about' ? <AboutTab version={version} /> : null}
        </div>
      </div>
    </div>
  );
}
