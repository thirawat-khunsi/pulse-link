import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Built into web/dist and served by Fastify (src/shared/web.ts): index.html at "/",
// hashed files under "/assets/". During `npm run dev:web` the API runs on :3000.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsDir: 'assets',
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3000' },
  },
});
