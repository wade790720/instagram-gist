import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  build: {
    target: 'chrome116',
    rollupOptions: {
      input: { app: 'app.html', background: 'src/background.ts' },
      // manifest.json names the service worker by a fixed path.
      output: { entryFileNames: c => (c.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js') },
    },
  },
});
