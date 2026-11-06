// Runs as a WebView initialization script, before styles or the React entry point can paint.
(() => {
  const config = window.__TANDEM_PREFERENCES__.config;
  const apply = () => {
    const root = document.documentElement;
    if (!root) return false;
    const dark = config.theme === 'dark' || (config.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    root.classList.toggle('dark', dark);
    root.dataset.theme = dark ? config.dark_theme : config.light_theme;
    return true;
  };
  // WebKit can run a document-start script before the HTML element has been constructed.
  if (!apply()) {
    const observer = new MutationObserver(() => { if (apply()) observer.disconnect(); });
    observer.observe(document, { childList: true });
  }
})();
