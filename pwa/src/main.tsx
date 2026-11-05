import { createRoot } from 'react-dom/client';
import App from './App';
import './style.css';
createRoot(document.getElementById('root')!).render(<App />);
if (import.meta.env.PROD && 'serviceWorker' in navigator)
  void navigator.serviceWorker.register('/sw.js').catch(console.error);
