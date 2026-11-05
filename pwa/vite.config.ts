import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
// 构建时固定外壳清单，WebSocket 和任意网络响应均不进入缓存。
export default defineConfig({
  plugins: [
    tailwindcss(),
    {
      // 只在构建时加：开发服务器的热更新需要内联脚本。任务内容不可信，这里还放着设备私钥。
      name: 'content-security-policy',
      apply: 'build',
      transformIndexHtml: () => [
        {
          tag: 'meta',
          attrs: {
            'http-equiv': 'Content-Security-Policy',
            content:
              "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' wss: ws://127.0.0.1:* ws://localhost:*; base-uri 'none'; form-action 'none'",
          },
          injectTo: 'head-prepend',
        },
      ],
    },
    {
      name: 'shell-worker',
      generateBundle(_, bundle) {
        const assets = [
          '/',
          '/index.html',
          '/manifest.webmanifest',
          '/icon.svg',
          ...Object.keys(bundle)
            .filter((x) => /\.(js|css)$/.test(x))
            .map((x) => '/' + x),
        ];
        const version = assets.join('|');
        this.emitFile({
          type: 'asset',
          fileName: 'sw.js',
          source: `const NAME='tandem-'+${JSON.stringify(version)};const SHELL=${JSON.stringify(assets)};self.addEventListener('install',e=>e.waitUntil(caches.open(NAME).then(c=>c.addAll(SHELL))));self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('tandem-')&&k!==NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method==='GET'&&u.origin===self.location.origin&&SHELL.includes(u.pathname))e.respondWith(caches.open(NAME).then(c=>c.match(u.pathname)).then(r=>r||fetch(e.request)));});`,
        });
      },
    },
  ],
});
