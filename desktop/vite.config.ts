import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const commit = process.env.TANDEM_BUILD_COMMIT;
if (commit && !/^[a-f0-9]{40}$/i.test(commit)) throw new Error('TANDEM_BUILD_COMMIT must be a full Git commit');

export default defineConfig({
  define: { __TANDEM_LOCAL_BUILD__: JSON.stringify(commit ? { commit, dirty: process.env.TANDEM_BUILD_DIRTY === '1' } : null) },
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ['**/src-tauri/**'] } },
  build: { target: 'safari16', sourcemap: false },
});
