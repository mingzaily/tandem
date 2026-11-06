import { createRoot } from 'react-dom/client';
import App from './App';
import './style.css';
const appearance = matchMedia('(prefers-color-scheme: dark)');
const theme = () => {
  document.documentElement.classList.toggle('dark', appearance.matches);
  document.documentElement.dataset.theme = appearance.matches ? 'tandem-dark' : 'tandem-light';
  document.documentElement.style.colorScheme = appearance.matches ? 'dark' : 'light';
  document
    .querySelector('meta[name=theme-color]')
    ?.setAttribute(
      'content',
      getComputedStyle(document.documentElement).getPropertyValue('--surface').trim(),
    );
};
theme();
appearance.addEventListener('change', theme);
createRoot(document.getElementById('root')!).render(<App />);
if (import.meta.env.PROD && 'serviceWorker' in navigator)
  void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(console.error);
