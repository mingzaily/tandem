import { Power, RefreshCw, Settings } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import iconUrl from '../assets/tandem-icon.svg';
import {
  onTraySummary,
  refreshTray,
  resizeTrayPanel,
  trayPanelAction,
  traySummary,
  type TrayTask,
  type TrayTaskStatus,
  type TraySource,
  type TrayWindow,
  type TraySummary,
} from '../lib/api';
import { t, type StringKey } from '../lib/i18n';
import { applySettings, loadSettings } from '../lib/settings';
import { preferencesSnapshot, subscribePreferences } from '../lib/storage';
import { AgentMark } from './AgentMark';

const STATUS_LABELS: Record<TrayTaskStatus, StringKey> = {
  running: 'trayStatusRunning',
  waiting: 'trayStatusWaiting',
  elsewhere: 'trayStatusElsewhere',
};
const ICON_BUTTON =
  'flex size-7 items-center justify-center rounded-full text-[var(--tray-ink-2)] transition-colors hover:bg-[var(--tray-ink-5)] hover:text-[var(--tray-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]';
const TUBE_INNER_HEIGHT = 98;

function windowName(window: TrayWindow): string {
  return window.name === 'week' ? t('trayWindowWeek') : t('trayWindowShort');
}

function Gauge({ source, isRisen }: { source: TraySource; isRisen: boolean }) {
  const tightest = source.windows.reduce((lowest, window) => (window.remaining < lowest.remaining ? window : lowest));
  const liquid = tightest.remaining > 0 ? Math.max(3, (tightest.remaining / 100) * TUBE_INNER_HEIGHT) : 0;
  const hint = source.windows.map((window) => `${windowName(window)}：${t('trayResetIn', { time: window.resetIn })}`).join('\n');
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-[7px] pb-0.5 pt-1" title={hint}>
      <div className={`flex h-[22px] items-baseline gap-px tabular-nums ${tightest.isLow ? 'text-[var(--tray-warn)]' : ''}`}>
        <span className="text-[18px] font-medium leading-[22px]">{tightest.remaining}</span>
        <span className={`text-[11px] ${tightest.isLow ? '' : 'text-[var(--tray-ink-3)]'}`}>%</span>
      </div>
      <div className="tray-well relative h-[104px] w-10 rounded-[13px]">
        <div className="absolute inset-[3px] overflow-hidden rounded-[10px]">
          <div
            className="tray-liquid absolute inset-x-0 bottom-0"
            style={{
              height: isRisen ? liquid : 0,
              backgroundColor: tightest.isLow ? 'var(--tray-warn)' : 'var(--tray-liquid)',
            }}
          />
        </div>
      </div>
      <AgentMark agent={source.agent} size={12} />
      <div className="-mt-0.5 flex flex-col items-center gap-0.5 text-[10.5px] leading-[13px] tabular-nums">
        {source.windows.map((window) => (
          <span key={window.name} className={`whitespace-nowrap ${window === tightest ? 'font-medium text-[var(--tray-ink-2)]' : 'text-[var(--tray-ink-3)]'}`}>
            {windowName(window)} {window.remaining}%
          </span>
        ))}
      </div>
    </div>
  );
}

function TaskRow({ task }: { task: TrayTask }) {
  const isWaiting = task.status === 'waiting';
  return (
    <button
      type="button"
      onClick={() => void trayPanelAction('task', task.id)}
      className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left transition-colors hover:bg-[var(--tray-ink-5)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-[9px] border-[0.5px] border-[var(--tray-line)] bg-[var(--tray-tile)]">
        <AgentMark agent={task.agent} size={13} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className="truncate text-[12.5px] font-semibold leading-4 tracking-[-0.1px]">{task.title}</span>
        <span className="flex min-w-0 items-center gap-[5px] text-[10.5px] leading-[13px] text-[var(--tray-ink-3)]">
          {isWaiting ? null : <span aria-hidden className="task-running size-[5px] shrink-0 rounded-full bg-[var(--tray-ink-2)]" />}
          <span className={`shrink-0 font-semibold ${isWaiting ? 'text-[var(--tray-warn)]' : 'text-[var(--tray-ink-2)]'}`}>{t(STATUS_LABELS[task.status])}</span>
          {task.project ? <span className="truncate">· {task.project}</span> : null}
          {task.queuedCount > 0 ? <span className="shrink-0">· {t('queueCount', { count: String(task.queuedCount) })}</span> : null}
        </span>
      </span>
    </button>
  );
}

export function TrayPanel() {
  useSyncExternalStore(subscribePreferences, preferencesSnapshot);
  const [summary, setSummary] = useState<TraySummary | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [isRisen, setIsRisen] = useState(false);
  const [edges, setEdges] = useState({ top: false, bottom: false });
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);

  const measureEdges = useCallback(() => {
    const element = scroller.current;
    if (!element) return;
    const top = element.scrollTop > 2;
    const bottom = element.scrollTop + element.clientHeight < element.scrollHeight - 2;
    setEdges((current) => (current.top === top && current.bottom === bottom ? current : { top, bottom }));
  }, []);

  useEffect(() => {
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    // The tubes fill again each time the panel opens, the way they do in a popover that is drawn anew.
    const rise = () => {
      setIsRisen(false);
      requestAnimationFrame(() => requestAnimationFrame(() => setIsRisen(true)));
    };
    rise();
    traySummary().then(setSummary).catch(console.error);
    const unlisten = onTraySummary(setSummary);
    // The injected Rust snapshot and configuration events also update this independent window.
    const onFocus = () => {
      applySettings(loadSettings());
      traySummary().then(setSummary).catch(console.error);
      rise();
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('resize', measureEdges);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('resize', measureEdges);
      void unlisten.then((stop) => stop());
    };
  }, [measureEdges]);

  useLayoutEffect(() => {
    const chromeHeight = root.current!.offsetHeight - scroller.current!.clientHeight;
    resizeTrayPanel(chromeHeight + content.current!.offsetHeight).catch(console.error);
    measureEdges();
  }, [summary, refreshError, measureEdges]);

  const refresh = async () => {
    setIsRefreshing(true);
    setRefreshError(null);
    try {
      await refreshTray();
    } catch (error) {
      setRefreshError(String(error));
    } finally {
      setIsRefreshing(false);
    }
  };

  const tasks = summary?.tasks ?? [];
  const sources = summary?.sources ?? [];

  return (
    <div ref={root} className="tray-panel flex h-screen max-h-[560px] w-full select-none flex-col">
      <div className="flex shrink-0 items-center gap-2 pb-1 pl-[18px] pr-3 pt-3.5">
        <img src={iconUrl} alt="" draggable={false} className="size-4" />
        <span className="text-13 font-bold leading-4 tracking-[-0.01em]">Tandem</span>
        <button
          type="button"
          aria-label={t(isRefreshing ? 'trayRefreshing' : 'trayRefresh')}
          title={t(isRefreshing ? 'trayRefreshing' : 'trayRefresh')}
          aria-busy={isRefreshing}
          disabled={isRefreshing}
          onClick={() => void refresh()}
          className={`${ICON_BUTTON} -my-1.5 ml-auto disabled:opacity-50`}
        >
          <RefreshCw size={14} strokeWidth={1.8} aria-hidden className={isRefreshing ? 'motion-safe:animate-spin' : ''} />
        </button>
      </div>
      {refreshError ? (
        <p role="alert" className="max-h-20 shrink-0 overflow-y-auto whitespace-pre-line px-5 py-1 text-11 leading-4 text-[var(--tray-warn)]">
          {t('trayRefreshFailed', { error: refreshError })}
        </p>
      ) : null}
      <div className={`h-px shrink-0 bg-[var(--tray-line)] ${edges.top ? '' : 'opacity-0'}`} />
      <div ref={scroller} onScroll={measureEdges} className="min-h-0 flex-1 overflow-y-auto">
        <div ref={content}>
          {sources.length > 0 ? (
            <div className="flex items-start gap-2 px-4 pt-2.5">
              {sources.map((source) => (
                <Gauge key={source.agent} source={source} isRisen={isRisen} />
              ))}
            </div>
          ) : (
            <p className="px-5 pt-3 text-12 text-[var(--tray-ink-3)]">{t('trayNoUsage')}</p>
          )}
          <div className="pt-4">
            <h2 className="flex items-baseline gap-1.5 px-5 pb-1.5 text-12 font-semibold leading-4">
              {t('trayRunning')}
              {tasks.length > 0 ? <span className="font-medium tabular-nums text-[var(--tray-ink-3)]">{tasks.length}</span> : null}
            </h2>
            <div className="px-2.5 pb-1">
              {tasks.length > 0 ? (
                tasks.map((task) => <TaskRow key={task.id} task={task} />)
              ) : (
                <p className="px-2.5 pb-3 pt-2 text-12 text-[var(--tray-ink-3)]">{t('trayIdle')}</p>
              )}
            </div>
          </div>
        </div>
      </div>
      <div className={`h-px shrink-0 bg-[var(--tray-line)] ${edges.bottom ? '' : 'opacity-0'}`} />
      <div className="flex shrink-0 items-center gap-1.5 pb-3 pl-3 pr-2.5 pt-2">
        <button
          type="button"
          onClick={() => void trayPanelAction('open')}
          className="h-[30px] rounded-full bg-[var(--tray-cta)] px-3.5 text-12 font-semibold text-[var(--tray-on-cta)] transition-transform active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
        >
          {t('trayOpen')}
        </button>
        <span className="flex-1" />
        <button type="button" aria-label={t('settings')} title={t('settings')} onClick={() => void trayPanelAction('settings')} className={ICON_BUTTON}>
          <Settings size={14} strokeWidth={1.8} aria-hidden />
        </button>
        <button type="button" aria-label={t('trayQuit')} title={t('trayQuit')} onClick={() => void trayPanelAction('quit')} className={ICON_BUTTON}>
          <Power size={14} strokeWidth={1.8} aria-hidden />
        </button>
      </div>
    </div>
  );
}
