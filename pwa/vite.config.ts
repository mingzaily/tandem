import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' wss: ws://127.0.0.1:* ws://localhost:*; base-uri 'none'; form-action 'none'";
const PUBLIC_SHELL = ['manifest.webmanifest', 'icon.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png'];

export default defineConfig(() => {
  let base: string;
  let root: string;
  let publicDir: string;
  return {
    build: { target: 'safari16' },
    plugins: [
      tailwindcss(),
      {
        // Development uses inline HMR scripts; production only executes the built client.
        name: 'content-security-policy',
        apply: 'build',
        transformIndexHtml: () => [
          {
            tag: 'meta',
            attrs: {
              'http-equiv': 'Content-Security-Policy',
              content: CSP,
            },
            injectTo: 'head-prepend',
          },
        ],
      },
      {
        name: 'shell-worker',
        configResolved(config) {
          base = config.base;
          root = config.root;
          publicDir = config.publicDir;
        },
        generateBundle(_, bundle) {
          const assets = [
            base,
            base + 'index.html',
            ...PUBLIC_SHELL.map((file) => base + file),
            ...Object.keys(bundle)
              .filter((x) => /\.(js|css)$/.test(x))
              .map((x) => base + x),
          ];
          // Include fixed-name assets so manifest and icon updates also replace the shell.
          const hash = createHash('sha256').update(assets.join('|')).update(CSP);
          hash.update(readFileSync(resolve(root, 'index.html')));
          for (const file of PUBLIC_SHELL) hash.update(readFileSync(resolve(publicDir, file)));
          const prefix = `tandem-shell:${base}:`;
          const name = prefix + hash.digest('hex');
          this.emitFile({
            type: 'asset',
            fileName: 'sw.js',
            source: `const PREFIX=${JSON.stringify(prefix)};const NAME=${JSON.stringify(name)};const SHELL=${JSON.stringify(assets)};self.addEventListener('install',e=>e.waitUntil(caches.open(NAME).then(c=>c.addAll(SHELL))));self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith(PREFIX)&&k!==NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method==='GET'&&u.origin===self.location.origin&&SHELL.includes(u.pathname))e.respondWith(caches.open(NAME).then(c=>c.match(u.pathname)).then(r=>r||fetch(e.request)));});`,
          });
        },
      },
    ],
  };
});
