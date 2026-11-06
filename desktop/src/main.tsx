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

// The Rust initialization script supplies this synchronously, before the first paint.
applySettings(loadConfirmedSettings());

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
    </StrictMode>,
  );
}
void start();
