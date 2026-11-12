import '@fontsource-variable/inter';
import './styles/app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { TrayPanel } from './components/TrayPanel';
import { StorageNotice } from './components/StorageNotice';
import { applySettings, loadConfirmedSettings, watchSystemTheme } from './lib/settings';
import { connectPreferences, preferencesMemory, subscribePreferences } from './lib/storage';
import { t } from './lib/i18n';
import { limitNativeContextMenu } from './lib/contextMenu';
import { TooltipLayer } from './components/TooltipLayer';
import { logPageError } from './lib/api';

// Uncaught errors go to the local diagnostic log, the only place a report can show them.
const reportPageError = (message: string) => void logPageError(message).catch(() => undefined);
window.addEventListener('error', (event) => {
  const stack = event.error instanceof Error && event.error.stack ? `\n${event.error.stack}` : '';
  reportPageError(`${event.message} (${event.filename}:${event.lineno}:${event.colno})${stack}`);
});
window.addEventListener('unhandledrejection', (event) => {
  const reason: unknown = event.reason;
  // WebKit's stack leaves out the message, so both are kept.
  reportPageError(`unhandled rejection: ${reason instanceof Error ? `${reason.name}: ${reason.message}${reason.stack ? `\n${reason.stack}` : ''}` : String(reason)}`);
});

// The Rust initialization script supplies this synchronously, before the first paint.
applySettings(loadConfirmedSettings());
limitNativeContextMenu();

async function start() {
  const isTray = new URLSearchParams(window.location.search).get('panel') === 'tray';
  try { await connectPreferences(!isTray); } catch (error) { preferencesMemory.report(t('storageReadFailed', { error: String(error) })); }
  await applySettings(loadConfirmedSettings());
  let applied = JSON.stringify(loadConfirmedSettings());
  subscribePreferences(() => {
    const settings = loadConfirmedSettings();
    const next = JSON.stringify(settings);
    if (next !== applied) { applied = next; applySettings(settings); }
  });
  watchSystemTheme(loadConfirmedSettings);
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      {isTray ? <TrayPanel /> : <><App /><StorageNotice /></>}
      <TooltipLayer />
    </StrictMode>,
  );
}
void start();
