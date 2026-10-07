import path from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// Builds the unpacked extension into dist/: app.html (the UI) and background.js (service worker).
// public/ (manifest.json, _locales) is copied as is. Load dist/ in chrome://extensions.
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
