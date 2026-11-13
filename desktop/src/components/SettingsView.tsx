import { Archive, ArrowLeft, Bot, ExternalLink, FolderOpen, FolderPlus, Info, Keyboard, Palette, RotateCcw, Settings, Smartphone, X, type LucideIcon } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useId, useReducer, useRef, useState, type ReactNode } from 'react';
import iconUrl from '../assets/tandem-icon.svg';
import {
  type Agent,
  agentStatus,
  agentResources,
  type AgentInventory,
  discoverProjects,
  installAgent,
  loginAgent,
  openExternal,
  openLogFolder,
  clearLogs,
  notificationStatus,
  requestNotificationPermission,
  openNotificationSettings,
  type NotificationStatus,
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
import { APP_SHORTCUTS } from '../lib/keyboardShortcuts';
import { t, type StringKey } from '../lib/i18n';
import { projectName } from '../lib/items';
import type { SidebarOptions, SidebarSort } from '../lib/sidebarModel';
import { loadAgentStatus, saveAgentStatus } from '../lib/preferences';
import { INITIAL_REMOTE_FORM, remoteFormDirty, remoteFormReducer } from '../lib/remoteSettings';
import {
  DARK_THEMES,
  LIGHT_THEMES,
  MAX_UI_FONT_SIZE,
  MIN_UI_FONT_SIZE,
  type AppSettings,
  type LanguageSetting,
  type ThemeSetting,
} from '../lib/settings';
import { AgentMark } from './AgentMark';
import { SettingsSelect } from './SettingsSelect';
import { SettingsButton } from './SettingsButton';
import { UpdateAction, UpdateStatus, useAppUpdate } from './AppUpdateControl';

const AgentResources = lazy(() => import('./AgentResources'));
const ArchivedTasks = lazy(() => import('./ArchivedTasks'));
const JOB_LINES = 8;

type TabId = 'general' | 'appearance' | 'shortcuts' | 'agents' | 'projects' | 'archived' | 'remote' | 'about';

const TABS: { id: TabId; label: StringKey; icon: LucideIcon }[] = [
  { id: 'general', label: 'settingsGeneral', icon: Settings },
  { id: 'appearance', label: 'settingsAppearance', icon: Palette },
  { id: 'shortcuts', label: 'settingsShortcuts', icon: Keyboard },
  { id: 'agents', label: 'settingsAgents', icon: Bot },
  { id: 'projects', label: 'settingsProjects', icon: FolderOpen },
  { id: 'archived', label: 'settingsArchived', icon: Archive },
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

const THEMES: { id: ThemeSetting; label: StringKey }[] = [
  { id: 'system', label: 'themeSystem' },
  { id: 'light', label: 'themeLight' },
  { id: 'dark', label: 'themeDark' },
];

const KEY_NAMES: Record<string, string> = { '⌘': 'Command', '⌥': 'Option', '⇧': 'Shift', '↑': 'Arrow Up', '↓': 'Arrow Down', '→': 'Arrow Right' };

function ShortcutKeys({ combinations }: { combinations: string[][] }) {
  return <span className="flex flex-wrap items-center justify-end gap-1.5">
    {combinations.map((keys, index) => <span key={keys.join('+')} className="inline-flex items-center gap-1">
      {index > 0 ? <span aria-hidden className="mr-1 text-12 text-[var(--text-tertiary)]">/</span> : null}
      {keys.map((key) => <kbd key={key} aria-label={KEY_NAMES[key] ?? key}
        className="inline-flex h-6 min-w-6 items-center justify-center rounded-[4px] border border-[var(--border-default)] bg-[var(--surface-chip)] px-1.5 font-sans text-12 text-[var(--text-primary)]">{key}</kbd>)}
    </span>)}
  </span>;
}

export function ShortcutsTab({ settings, onChange }: TabProps) {
  const primary = settings.sendWithCmdEnter ? ['⌘', 'Enter'] : ['Enter'];
  const alternate = settings.sendWithCmdEnter ? ['⌘', '⇧', 'Enter'] : ['⌘', 'Enter'];
  const newline = settings.sendWithCmdEnter ? ['Enter'] : ['⇧', 'Enter'];
  const groups: { title: StringKey; rows: { label: StringKey; hint?: StringKey; keys: string[][] }[] }[] = [
    { title: 'shortcutAppSection', rows: APP_SHORTCUTS.map(({ label, key }) => ({ label, keys: [['⌘', key.toUpperCase()]] })) },
    { title: 'inputSection', rows: [
      { label: 'shortcutSend', hint: 'shortcutSendHint', keys: [primary] },
      { label: 'shortcutSteer', hint: 'shortcutSteerHint', keys: [alternate] },
      { label: 'shortcutNewline', keys: [newline] },
      { label: 'shortcutInputHistory', hint: 'shortcutInputHistoryHint', keys: [['↑'], ['↓']] },
    ] },
    { title: 'shortcutQueueSection', rows: [
      { label: 'shortcutContextMenu', hint: 'shortcutContextMenuHint', keys: [['⇧', 'F10']] },
      { label: 'shortcutMoveQueue', hint: 'shortcutQueueFocusHint', keys: [['↑'], ['↓']] },
      { label: 'shortcutQueueEnds', hint: 'shortcutQueueFocusHint', keys: [['Home'], ['End']] },
    ] },
    { title: 'shortcutProjectSection', rows: [
      { label: 'shortcutMoveProject', hint: 'shortcutProjectFocusHint', keys: [['⌥', '↑'], ['⌥', '↓']] },
      { label: 'shortcutProjectEnds', hint: 'shortcutProjectFocusHint', keys: [['⌥', 'Home'], ['⌥', 'End']] },
    ] },
    { title: 'shortcutCodeSection', rows: [
      { label: 'shortcutCodeIndent', hint: 'shortcutCodeFocusHint', keys: [['Tab']] },
      { label: 'shortcutCodeExit', hint: 'shortcutCodeLastLineHint', keys: [['↓']] },
      { label: 'shortcutCodeUndo', hint: 'shortcutCodeFocusHint', keys: [['⌘', 'Z']] },
      { label: 'shortcutCodeRedo', hint: 'shortcutCodeFocusHint', keys: [['⌘', '⇧', 'Z']] },
    ] },
    { title: 'shortcutResizeSection', rows: [
      { label: 'shortcutResizeInput', hint: 'shortcutResizeFocusHint', keys: [['↑'], ['↓']] },
      { label: 'shortcutResizeReset', hint: 'shortcutResizeFocusHint', keys: [['Home']] },
      { label: 'shortcutResizeMax', hint: 'shortcutResizeFocusHint', keys: [['End']] },
    ] },
    { title: 'shortcutConfirmSection', rows: [
      { label: 'permissionAllowOnce', hint: 'shortcutPermissionHint', keys: [['Enter']] },
      { label: 'shortcutAllowTask', hint: 'shortcutAllowTaskHint', keys: [['⌘', 'Enter']] },
      { label: 'permissionDeny', hint: 'shortcutPermissionHint', keys: [['Esc']] },
      { label: 'shortcutChooseAnswer', hint: 'shortcutChooseAnswerHint', keys: [['1–9']] },
      { label: 'shortcutCloseMenu', hint: 'shortcutCloseMenuHint', keys: [['Esc']] },
    ] },
  ];
  return <>
    <p className="mb-6 text-13 leading-relaxed text-[var(--text-secondary)]">{t('shortcutIntro')}</p>
    {groups.map(({ title, rows }) => <Section key={title} title={t(title)}>
      {title === 'inputSection' ? <>
        <Row label={t('cmdEnterLabel')} hint={t('cmdEnterHint')}>
          <Switch label={t('cmdEnterLabel')} checked={settings.sendWithCmdEnter} onChange={(sendWithCmdEnter) => onChange({ ...settings, sendWithCmdEnter })} />
        </Row>
        <div className={DIVIDER} />
      </> : null}
      {rows.map(({ label, hint, keys }, index) => <div key={label}>
        {index > 0 ? <div className={DIVIDER} /> : null}
        <Row label={t(label)} hint={hint ? t(hint) : undefined}><ShortcutKeys combinations={keys} /></Row>
      </div>)}
    </Section>)}
  </>;
}

function AppearanceTab({ settings, onChange }: TabProps) {
  return (
    <>
      <Section title={t('modeSection')}>
        <Row label={t('modeSection')}>
          <SettingsSelect label={t('modeSection')} value={settings.theme} options={THEMES.map(({ id, label }) => ({ id, text: t(label) }))} onChange={(theme) => onChange({ ...settings, theme })} />
        </Row>
        <div className={DIVIDER} />
        <Row label={t('lightThemes')}>
          <SettingsSelect label={t('lightThemes')} value={settings.lightTheme} options={LIGHT_THEMES.map(({ id, name }) => ({ id, text: name }))} onChange={(lightTheme) => onChange({ ...settings, lightTheme })} />
        </Row>
        <div className={DIVIDER} />
        <Row label={t('darkThemes')}>
          <SettingsSelect label={t('darkThemes')} value={settings.darkTheme} options={DARK_THEMES.map(({ id, name }) => ({ id, text: name }))} onChange={(darkTheme) => onChange({ ...settings, darkTheme })} />
        </Row>
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
  const [notification, setNotification] = useState<NotificationStatus | null>(null);
  const [notificationBusy, setNotificationBusy] = useState(false);
  const [notificationError, setNotificationError] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    const read = () => {
      void notificationStatus().then((status) => { if (current) { setNotification(status); setNotificationError(null); } })
        .catch((error) => { if (current) setNotificationError(String(error)); });
    };
    read();
    window.addEventListener('focus', read);
    return () => { current = false; window.removeEventListener('focus', read); };
  }, []);
  const allowNotifications = async () => {
    setNotificationBusy(true);
    setNotificationError(null);
    try { setNotification(await requestNotificationPermission()); }
    catch (error) { setNotificationError(String(error)); }
    finally { setNotificationBusy(false); }
  };
  const notificationLabels = {
    authorized: notification?.badgeEnabled ? 'notificationAllowed' : 'notificationBadgeOff',
    denied: 'notificationDenied', notDetermined: 'notificationNotDetermined', unsupported: 'notificationUnsupported',
  } as const;
  const notificationLabel = notification ? notificationLabels[notification.authorization] : 'notificationChecking';
  const languages: { id: LanguageSetting; text: string }[] = [
    { id: 'system', text: t('languageSystem') },
    { id: 'zh', text: '简体中文' },
    { id: 'en', text: 'English' },
  ];
  return (
    <>
      <Section title={t('languageSection')}>
        <Row label={t('languageLabel')} hint={t('languageHint')}>
          <SettingsSelect label={t('languageLabel')} value={settings.language} options={languages} onChange={(language) => onChange({ ...settings, language })} />
        </Row>
      </Section>
      <Section title={t('windowSection')}>
        <Row label={t('keepInMenuBarLabel')} hint={t('keepInMenuBarHint')}>
          <Switch label={t('keepInMenuBarLabel')} checked={settings.keepInMenuBar} onChange={(keepInMenuBar) => onChange({ ...settings, keepInMenuBar })} />
        </Row>
        <div className={DIVIDER} />
        <Row label={t('notifyLabel')} hint={t('notifyHint')}>
          <Switch label={t('notifyLabel')} checked={settings.notifyWhenDone} onChange={(notifyWhenDone) => {
            onChange({ ...settings, notifyWhenDone });
            if (notifyWhenDone && notification?.authorization === 'notDetermined') void allowNotifications();
          }} />
        </Row>
        <div className={DIVIDER} />
        <Row label={t('notificationSystemLabel')} hint={<>
          <span>{t(notificationLabel)}<br />{t('notificationSystemHint')}</span>
          {notificationError ? <span role="alert" className="mt-1 block text-[var(--text-danger)]">{notificationError}</span> : null}
        </>}>
          <div className="flex items-center gap-2">
            {notification?.authorization === 'notDetermined' ? <SettingsButton busy={notificationBusy} onClick={() => void allowNotifications()}>{t('notificationAllow')}</SettingsButton> : null}
            <SettingsButton disabled={notificationBusy || notification?.authorization === 'unsupported'} onClick={() => void openNotificationSettings().catch((error) => setNotificationError(String(error)))}>
              <ExternalLink size={14} aria-hidden />{t('notificationSystemSettings')}
            </SettingsButton>
          </div>
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

const AVATAR = 'flex shrink-0 items-center justify-center rounded-lg border border-[var(--settings-integration-avatar-border)] bg-[var(--settings-integration-avatar-bg)] text-[var(--settings-integration-avatar-icon)]';

/** Ready means it runs here as it is: installed, and logged in where the CLI has a login. */
const agentReady = (agent: AgentStatus | undefined) => !!agent?.installed && (!agent.login || agent.login.loggedIn);

/**
 * Laid out like the reference's provider settings: one card with the agents in a narrow rail
 * and the chosen one's detail beside it. The detail header stays put; its MCP servers and skills
 * scroll under a sticky toolbar.
 */
function AgentsTab({ currentProject, projects, hiddenAgents, onHiddenAgentsChange }: { currentProject: string | null; projects: string[] } & AgentListProps) {
  const [selected, setSelected] = useState<AgentStatus['command']>('claude');
  // Only a real folder has project config; the conversation space and drafts have none.
  const [cwd, setCwd] = useState(currentProject?.startsWith('/') ? currentProject : '');
  const [inventories, setInventories] = useState<AgentInventory[]>([]);
  const [resourceError, setResourceError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setInventories([]);
    setResourceError(null);
    agentResources(cwd || null).then((rows) => { if (active) setInventories(rows); }).catch((reason) => { if (active) setResourceError(String(reason)); });
    return () => { active = false; };
  }, [cwd]);
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

  const agent = agents?.find((item) => item.command === selected);
  const jobHere = job?.command === selected ? job : null;
  const link = jobHere?.lines.join('\n').match(LINK)?.[0];
  const projectOptions = [{ id: '', text: t('resourceGlobalOnly') }, ...[...new Set([currentProject, ...projects].filter((path): path is string => !!path?.startsWith('/')))].map((path) => ({ id: path, text: projectName(path) }))];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[14px]">
      <p className="text-13 leading-[1.5] text-[var(--settings-section-desc)]">{t('resourceReadOnly')}</p>
      {error ? <p role="alert" className="text-12 text-[var(--text-danger)]">{error}</p> : null}
      <div className="flex min-h-[420px] flex-1 overflow-hidden rounded-xl border border-[var(--settings-theme-card-border)] bg-[var(--settings-theme-card-bg)]">
        <div role="tablist" aria-orientation="vertical" aria-label={t('settingsAgents')} className="flex w-[224px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-[var(--settings-theme-card-border)] p-2">
          {(['claude', 'codex', 'pi'] as const).map((command) => {
            const item = agents?.find((entry) => entry.command === command);
            const isSelected = selected === command;
            return <button key={command} type="button" role="tab" aria-selected={isSelected} onClick={() => setSelected(command)}
              className={`flex w-full items-center gap-2.5 rounded-lg py-2 pl-3 pr-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] ${
                isSelected ? 'bg-[var(--settings-menu-bg-selected)]' : 'hover:bg-[var(--settings-menu-bg-hover)]'
              }`}>
              <span className={`${AVATAR} size-7`}><AgentMark agent={command} size={14} /></span>
              <span className={`min-w-0 flex-1 truncate text-13 font-medium ${item && !item.installed ? 'text-[var(--text-tertiary)]' : 'text-[var(--settings-section-title)]'}`}>{AGENT_NAMES[command]}</span>
              {item && !item.installed ? <span className="shrink-0 text-11 text-[var(--text-tertiary)]">{t('agentNotInstalled')}</span>
                : item?.login && !item.login.loggedIn ? <span className="shrink-0 text-11 text-[var(--settings-integration-warning)]">{t('agentNotLoggedIn')}</span>
                : hiddenAgents.includes(command) ? <span className="shrink-0 text-11 text-[var(--text-tertiary)]">{t('agentTasksHidden')}</span> : null}
              <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${agentReady(item) ? 'bg-[var(--remote-status-ready)]' : 'bg-[var(--border-default)]'}`} />
            </button>;
          })}
        </div>
        <div key={selected} role="tabpanel" aria-label={AGENT_NAMES[selected]} className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="shrink-0 px-5 py-4">
            <div className="flex flex-wrap items-center gap-3 gap-y-2">
              <span className="flex min-w-0 flex-auto basis-[220px] items-center gap-3">
                <span className={`${AVATAR} size-9`}><AgentMark agent={selected} size={18} /></span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-14 font-medium leading-tight text-[var(--settings-section-title)]">{AGENT_NAMES[selected]}</span>
                  <span data-tooltip={agent ? agentHint(agent) : undefined} className="selectable truncate text-13 leading-tight text-[var(--settings-integration-subtitle)]">{agent ? agentHint(agent) : t('agentsChecking')}</span>
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {jobHere?.isRunning ? (
                  <>
                    {link ? <SettingsButton type="button" onClick={() => void openExternal(link)}>{t('openLink')}</SettingsButton> : null}
                    <SettingsButton type="button" onClick={() => void stopAgentJob()}>{t('agentStop')}</SettingsButton>
                  </>
                ) : !agent ? null : !agent.installed ? (
                  <SettingsButton type="button" disabled={job?.isRunning} onClick={() => run(agent.command, installAgent)}>{t('agentInstall')}</SettingsButton>
                ) : agent.login ? (
                  <SettingsButton type="button" disabled={job?.isRunning} onClick={() => run(agent.command, loginAgent)}>
                    {agent.login.loggedIn ? t('agentRelogin') : t('agentLogin')}
                  </SettingsButton>
                ) : null}
              </span>
            </div>
            {jobHere && jobHere.lines.length + (jobHere.failed ? 1 : 0) > 0 ? (
              <div className="selectable mt-3 rounded-lg bg-[var(--surface-chip)] px-3 py-2 font-mono text-12 leading-[1.5] text-[var(--text-secondary)] [overflow-wrap:anywhere]">
                {jobHere.lines.map((line, lineIndex) => <div key={lineIndex}>{line}</div>)}
                {jobHere.failed ? <div className="mt-1 font-sans text-[var(--text-danger)]">{t('agentJobFailed')}</div> : null}
              </div>
            ) : null}
          </div>
          <div className={`flex items-center justify-between gap-3 border-t border-[var(--settings-theme-card-border)] px-5 py-3`}>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className={ROW_LABEL}>{t('agentListTasks')}</span>
              <span className={ROW_HINT}>{t('agentListTasksHint')}</span>
            </span>
            <Switch label={t('agentListTasks')} checked={!hiddenAgents.includes(selected)}
              // At least one CLI stays available for new tasks.
              disabled={!hiddenAgents.includes(selected) && hiddenAgents.length >= 2}
              onChange={(listed) => onHiddenAgentsChange(listed ? hiddenAgents.filter((agent) => agent !== selected) : [...hiddenAgents, selected])} />
          </div>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden overscroll-contain border-t border-[var(--settings-theme-card-border)] [&>*]:shrink-0">
            <Suspense fallback={null}>
              <AgentResources
                inventory={inventories.find((item) => item.agent === selected) ?? null}
                error={resourceError}
                projectPicker={<SettingsSelect compact label={t('resourceCurrentProject')} value={cwd} options={projectOptions} onChange={setCwd} />}
              />
            </Suspense>
          </div>
        </div>
      </div>
    </div>
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

export function RelayVersionRow({ state }: { state: Pick<RemoteState, 'status' | 'relayVersion'> }) {
  const version = state.status === 'online'
    ? state.relayVersion ?? t('remoteRelayVersionUnknown') : t('remoteRelayVersionOffline');
  return <Row label={t('remoteRelayVersion')}>
    <span className="inline-flex h-8 items-center text-13 text-[var(--text-secondary)]">{version}</span>
  </Row>;
}

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
          state.enabled ? <span role="status">{state.error ? statusText : <>{statusText} · {enableHint}</>}</span> : enableHint
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
            <input type="text" required value={form.relayUrl} aria-label={t('remoteRelayUrl')}
              placeholder="relay.example.com" spellCheck={false} autoCapitalize="off" autoCorrect="off" disabled={busy}
              onChange={(event) => edit('editUrl', event.target.value)} className={REMOTE_INPUT} />
          </Row>
          <div className={DIVIDER} />
          <Row label={t('remoteRelayToken')}>
            <input type="password" value={form.hostToken} aria-label={t('remoteRelayToken')} required={!state.hasHostToken}
              placeholder={state.hasHostToken ? t('remoteTokenSaved') : ''} disabled={busy}
              onChange={(event) => edit('editToken', event.target.value)} className={REMOTE_INPUT} />
          </Row>
          <div className={DIVIDER} />
          <RelayVersionRow state={state} />
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

function ProjectsTab({ settings, onChange, extraProjects, onExtraProjectsChange, defaultConversationDir, sidebarOptions, onSidebarOptionsChange }: TabProps & ProjectsProps) {
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
      <Section title={t('sidebarListSection')}>
        <Row label={t('sidebarGroupCli')} hint={t('sidebarGroupCliHint')}>
          <Switch label={t('sidebarGroupCli')} checked={sidebarOptions.groupByCli} onChange={(groupByCli) => onSidebarOptionsChange({ ...sidebarOptions, groupByCli })} />
        </Row>
        <div className={DIVIDER} />
        <Row label={t('sidebarSorting')} hint={t('sidebarSortHint')}>
          <SettingsSelect label={t('sidebarSorting')} value={sidebarOptions.sort} options={SIDEBAR_SORTS.map(({ id, label }) => ({ id, text: t(label) }))} onChange={(sort) => onSidebarOptionsChange({ ...sidebarOptions, sort })} />
        </Row>
      </Section>
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

export function AboutTab({ version, settings, onChange }: { version: string } & TabProps) {
  const update = useAppUpdate();
  return (
    <>
      <Section title="Tandem">
        <div className="flex items-center gap-3 px-4 py-4">
          <img src={iconUrl} alt="" draggable={false} className="size-11 shrink-0" />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className={ROW_LABEL + ' truncate'}>Tandem</span>
            <span className={ROW_HINT + ' truncate'}>{t('aboutVersion', { version })}</span>
          </span>
          <div className="ml-auto flex min-w-0 items-center gap-2">
            <UpdateStatus state={update.state} />
            <UpdateAction {...update} />
          </div>
        </div>
        <div className={DIVIDER} />
        <Row label={t('updateAutomatic')} hint={t('updateAutomaticHint')}>
          <Switch label={t('updateAutomatic')} checked={settings.autoUpdate} onChange={(autoUpdate) => onChange({ ...settings, autoUpdate })} />
        </Row>
        <div className={DIVIDER} />
        <Row label={t('updateInterval')} hint={settings.autoUpdate ? t('updateIntervalHint') : t('updateIntervalDisabled')}>
          <SettingsSelect compact label={t('updateInterval')} value={String(settings.updateCheckIntervalHours)}
            options={[1, 6, 12, 24].map((hours) => ({ id: String(hours), text: t('updateIntervalHours', { count: String(hours) }) }))}
            onChange={(hours) => onChange({ ...settings, updateCheckIntervalHours: Number(hours) })} />
        </Row>
        <div className={DIVIDER} />
        <Row label={t('aboutDataLabel')} hint={t('aboutDataHint')} />
        <div className={DIVIDER} />
        <Row label={t('aboutNetworkLabel')} hint={t('aboutNetworkHint')} />
        <div className={DIVIDER} />
        <Row label={t('aboutLicenseLabel')} hint="Apache-2.0" />
      </Section>
      <DiagnosticsSection settings={settings} onChange={onChange} />
    </>
  );
}

function DiagnosticsSection({ settings, onChange }: TabProps) {
  const [pending, setPending] = useState<'open' | 'clear' | null>(null);
  const [result, setResult] = useState<{ text: string; isError: boolean } | null>(null);
  const run = async (kind: 'open' | 'clear') => {
    setPending(kind);
    setResult(null);
    try {
      await (kind === 'open' ? openLogFolder() : clearLogs());
      if (kind === 'clear') setResult({ text: t('logCleared'), isError: false });
    } catch (error) {
      setResult({ text: t('logFailed', { error: String(error) }), isError: true });
    } finally {
      setPending(null);
    }
  };
  return (
    <Section title={t('diagnostics')}>
      <Row label={t('debugLog')} hint={t('debugLogHint')}>
        <Switch label={t('debugLog')} checked={settings.debugLog} onChange={(debugLog) => onChange({ ...settings, debugLog })} />
      </Row>
      <div className={DIVIDER} />
      <Row label={t('logFiles')} hint={t('logFilesHint')}>
        <span className="flex items-center gap-2">
          <SettingsButton busy={pending === 'clear'} disabled={pending !== null} onClick={() => void run('clear')}>{t('logClear')}</SettingsButton>
          <SettingsButton busy={pending === 'open'} disabled={pending !== null} onClick={() => void run('open')}>{t('logOpen')}</SettingsButton>
        </span>
      </Row>
      {result ? (
        <p role={result.isError ? 'alert' : 'status'}
          className={`selectable px-4 pb-3 text-12 [overflow-wrap:anywhere] ${result.isError ? 'text-[var(--text-danger)]' : 'text-[var(--text-secondary)]'}`}>
          {result.text}
        </p>
      ) : null}
    </Section>
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
  sidebarOptions: SidebarOptions;
  onSidebarOptionsChange: (options: SidebarOptions) => void;
}

const SIDEBAR_SORTS: { id: SidebarSort; label: StringKey }[] = [
  { id: 'time', label: 'sidebarSortTime' },
  { id: 'type', label: 'sidebarSortType' },
  { id: 'priority', label: 'sidebarSortPriority' },
];

export interface ArchivedTask {
  id: string;
  title: string;
  agent: Agent;
  updatedAtMs: number;
}

export interface ArchivedGroup {
  /** The project or the conversation space the tasks belong to. */
  name: string;
  tasks: ArchivedTask[];
}

interface AgentListProps {
  /** CLIs whose tasks stay out of the lists. */
  hiddenAgents: Agent[];
  onHiddenAgentsChange: (agents: Agent[]) => void;
}

interface ArchivedProps {
  archivedGroups: ArchivedGroup[];
  onUnarchive: (id: string) => void;
  archiving?: ReadonlySet<string>;
  archiveError?: string | null;
}

/** Archived tasks stay out of the sidebar; this is the one place to see them and bring them back. */
export function ArchivedTab({ archivedGroups, onUnarchive, archiving, archiveError }: ArchivedProps) {
  const error = archiveError ? <p role="alert" className="px-1 text-13 text-[var(--text-danger)]">{archiveError}</p> : null;
  if (archivedGroups.length === 0) {
    return <>{error}<Section title={t('settingsArchived')}><Row label={t('archivedNone')} hint={t('archivedHint')} /></Section></>;
  }
  return <>
    {error}
    <p className={`${ROW_HINT} px-1`}>{t('archivedHint')}</p>
    {archivedGroups.map(({ name, tasks }) => (
      <Section key={name} title={name} action={<span className="text-12 text-[var(--text-tertiary)]">{t('archivedTaskCount', { count: String(tasks.length) })}</span>}>
        <Suspense fallback={<Row label={t('archivedLoading')} />}><ArchivedTasks tasks={tasks} onUnarchive={onUnarchive} archiving={archiving} /></Suspense>
      </Section>
    ))}
  </>;
}

interface SettingsViewProps extends TabProps, ProjectsProps, ArchivedProps, AgentListProps {
  initialTab?: TabId;
  currentProject: string | null;
  version: string;
  onBack: () => void;
}

export function SettingsView({ settings, onChange, extraProjects, onExtraProjectsChange, defaultConversationDir, sidebarOptions, onSidebarOptionsChange, archivedGroups, onUnarchive, archiving, archiveError, hiddenAgents, onHiddenAgentsChange, version, onBack, currentProject, initialTab = 'general' }: SettingsViewProps) {
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
            data-tooltip={t('settingsBack')}
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
        <div role="tabpanel" aria-label={t(active.label)} className={`mx-auto w-full min-w-0 max-w-[920px] px-1 ${tab === 'agents' ? 'flex min-h-0 flex-1 flex-col pb-6' : 'pb-32'}`}>
          <h2 className="pb-6 text-20 font-medium leading-[1.3] text-[var(--settings-section-title)]">{t(active.label)}</h2>
          {tab === 'general' ? <GeneralTab settings={settings} onChange={onChange} /> : null}
          {tab === 'appearance' ? <AppearanceTab settings={settings} onChange={onChange} /> : null}
          {tab === 'shortcuts' ? <ShortcutsTab settings={settings} onChange={onChange} /> : null}
          {tab === 'agents' ? <AgentsTab currentProject={currentProject} projects={extraProjects} hiddenAgents={hiddenAgents} onHiddenAgentsChange={onHiddenAgentsChange} /> : null}
          {tab === 'remote' ? <RemoteTab /> : null}
          {tab === 'projects' ? (
            <ProjectsTab settings={settings} onChange={onChange} extraProjects={extraProjects} onExtraProjectsChange={onExtraProjectsChange} defaultConversationDir={defaultConversationDir} sidebarOptions={sidebarOptions} onSidebarOptionsChange={onSidebarOptionsChange} />
          ) : null}
          {tab === 'archived' ? <ArchivedTab archivedGroups={archivedGroups} onUnarchive={onUnarchive} archiving={archiving} archiveError={archiveError} /> : null}
          {tab === 'about' ? <AboutTab version={version} settings={settings} onChange={onChange} /> : null}
        </div>
      </div>
    </div>
  );
}
