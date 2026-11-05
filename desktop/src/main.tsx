import '@fontsource-variable/inter';
import './styles/app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { TrayPanel } from './components/TrayPanel';
import { applySettings, loadSettings } from './lib/settings';

// Before the first render, so the window never paints with the wrong theme.
applySettings(loadSettings());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {new URLSearchParams(window.location.search).get('panel') === 'tray' ? <TrayPanel /> : <App />}
  </StrictMode>,
);
